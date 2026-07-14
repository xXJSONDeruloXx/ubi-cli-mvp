import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  open,
  opendir,
  rename,
  rm,
  stat,
  statfs
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { UserFacingError } from '../util/errors';
import {
  ensureSafeManifestOutputParent,
  resolveManifestOutputPath
} from '../util/manifest-paths';

const execFileAsync = promisify(execFile);

export interface ConnectSeedPlan {
  sourceDir: string;
  registeredInstallDir: string;
  stagingDir: string;
  productId: string;
}

export interface ConnectSeedResult extends ConnectSeedPlan {
  totalFiles: number;
  skippedMatchingFiles: number;
  seededFiles: number;
  seededBytes: number;
}

interface SourceFile {
  absolutePath: string;
  relativePath: string;
  size: number;
  mode: number;
}

async function collectSourceFiles(
  root: string,
  current = root
): Promise<SourceFile[]> {
  const directory = await opendir(current);
  const files: SourceFile[] = [];

  for await (const entry of directory) {
    const entryPath = path.join(current, entry.name);
    const entryStats = await lstat(entryPath);
    if (entryStats.isSymbolicLink()) {
      throw new UserFacingError(
        `Refusing to seed Connect from a source tree containing a symlink: ${entryPath}`
      );
    }
    if (entryStats.isDirectory()) {
      files.push(...(await collectSourceFiles(root, entryPath)));
    } else if (entryStats.isFile()) {
      files.push({
        absolutePath: entryPath,
        relativePath: path.relative(root, entryPath),
        size: entryStats.size,
        mode: entryStats.mode & 0o777
      });
    }
  }

  return files;
}

async function sha256File(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r');
  const hash = createHash('sha256');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

export function wineInstallPathToHostPath(
  prefix: string,
  windowsPath: string
): string {
  const normalized = windowsPath.trim().replaceAll('\\', '/');
  const match = /^c:\/(.*)$/i.exec(normalized);
  if (!match) {
    throw new UserFacingError(
      `Connect registered an unsupported install path. Only C: paths in the selected prefix are supported: ${windowsPath}`
    );
  }

  const driveRoot = path.resolve(prefix, 'drive_c');
  const resolved = path.resolve(driveRoot, ...match[1].split('/'));
  const relative = path.relative(driveRoot, resolved);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new UserFacingError(
      'Connect registered an install path outside the selected Wine prefix.'
    );
  }
  return resolved;
}

function parseInstallDir(output: string): string {
  const match = /^\s*InstallDir\s+REG_SZ\s+(.+)$/im.exec(output);
  if (!match?.[1]) {
    throw new UserFacingError(
      'Connect has not registered an install directory for this product. Start and pause the official download first.'
    );
  }
  return match[1].trim();
}

export async function discoverConnectSeedPlan(
  sourceDir: string,
  prefix: string,
  productId: string,
  runner = 'wine'
): Promise<ConnectSeedPlan> {
  if (!/^\d+$/.test(productId)) {
    throw new UserFacingError('Connect product ID must contain digits only.');
  }

  const source = path.resolve(sourceDir);
  const sourceStats = await lstat(source).catch(() => undefined);
  if (!sourceStats?.isDirectory() || sourceStats.isSymbolicLink()) {
    throw new UserFacingError(
      `Source game directory must be a real directory: ${source}`
    );
  }
  const resolvedPrefix = path.resolve(prefix);
  const prefixStats = await lstat(resolvedPrefix).catch(() => undefined);
  const currentUid = process.getuid?.();
  if (
    !prefixStats?.isDirectory() ||
    prefixStats.isSymbolicLink() ||
    (currentUid !== undefined && prefixStats.uid !== currentUid)
  ) {
    throw new UserFacingError(
      `Wine prefix must be an existing, user-owned real directory: ${resolvedPrefix}`
    );
  }
  const environment = {
    ...process.env,
    WINEPREFIX: resolvedPrefix,
    WINEDEBUG: '-all'
  };

  let taskList: { stdout: string };
  try {
    taskList = await execFileAsync(runner, ['tasklist'], {
      env: environment,
      encoding: 'utf8'
    });
  } catch (error) {
    throw new UserFacingError(
      `Could not verify that Ubisoft Connect is stopped: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (/\bupc\.exe\b/i.test(taskList.stdout)) {
    throw new UserFacingError(
      'Ubisoft Connect is still running in this prefix. Pause the download and fully exit Connect before seeding its staging directory.'
    );
  }

  const key = `HKLM\\Software\\Wow6432Node\\Ubisoft\\Launcher\\Installs\\${productId}`;
  let registryOutput: string;
  try {
    const result = await execFileAsync(
      runner,
      ['reg', 'query', key, '/v', 'InstallDir'],
      { env: environment, encoding: 'utf8' }
    );
    registryOutput = result.stdout;
  } catch {
    throw new UserFacingError(
      `Connect has not registered product ${productId}. Start its official download, wait for transfer to begin, pause it, and fully exit Connect before retrying.`
    );
  }

  const registeredInstallDir = wineInstallPathToHostPath(
    resolvedPrefix,
    parseInstallDir(registryOutput)
  );
  const stagingDir = path.join(
    registeredInstallDir,
    'uplay_download',
    productId
  );
  const [registeredStats, stagingStats, installStateStats] = await Promise.all([
    lstat(registeredInstallDir).catch(() => undefined),
    lstat(stagingDir).catch(() => undefined),
    stat(path.join(registeredInstallDir, 'uplay_install.state')).catch(
      () => undefined
    )
  ]);
  if (
    !registeredStats?.isDirectory() ||
    registeredStats.isSymbolicLink() ||
    !stagingStats?.isDirectory() ||
    stagingStats.isSymbolicLink() ||
    !installStateStats?.isFile()
  ) {
    throw new UserFacingError(
      'The official Connect download staging markers are incomplete. Start the download, wait for transfer to begin, pause it, and fully exit Connect before retrying.'
    );
  }

  return {
    sourceDir: source,
    registeredInstallDir,
    stagingDir,
    productId
  };
}

async function assertNoSymlinkInExistingParents(
  root: string,
  outputPath: string
): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const relativeParent = path.relative(resolvedRoot, path.dirname(outputPath));
  if (
    relativeParent === '..' ||
    relativeParent.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeParent)
  ) {
    throw new UserFacingError('Connect staging path escaped its root.');
  }

  const rootStats = await lstat(resolvedRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new UserFacingError(
      'Connect staging root must remain a real directory.'
    );
  }

  let current = resolvedRoot;
  for (const segment of relativeParent ? relativeParent.split(path.sep) : []) {
    current = path.join(current, segment);
    const currentStats = await lstat(current).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    });
    if (!currentStats) {
      return;
    }
    if (!currentStats.isDirectory() || currentStats.isSymbolicLink()) {
      throw new UserFacingError(
        `Refusing Connect staging through unsafe directory "${segment}".`
      );
    }
  }
}

async function copyFileAtomically(
  source: SourceFile,
  stagingDir: string
): Promise<void> {
  const destination = resolveManifestOutputPath(
    stagingDir,
    source.relativePath
  );
  await ensureSafeManifestOutputParent(stagingDir, destination);
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${randomUUID()}.partial`
  );

  try {
    await copyFile(source.absolutePath, temporary, constants.COPYFILE_FICLONE);
    await chmod(temporary, source.mode);
    const handle = await open(temporary, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function waitForConnectFinalization(
  plan: ConnectSeedPlan,
  timeoutMs = 2 * 60_000
): Promise<void> {
  const installManifest = path.join(
    plan.registeredInstallDir,
    'uplay_install.manifest'
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [stagingStats, manifestStats] = await Promise.all([
      stat(plan.stagingDir).catch(() => undefined),
      stat(installManifest).catch(() => undefined)
    ]);
    if (!stagingStats && manifestStats?.isFile()) {
      return;
    }
    await delay(250);
  }

  throw new UserFacingError(
    'Ubisoft Connect did not finalize the seeded download within two minutes. Leave the client open to inspect or retry its Resume action.'
  );
}

export async function seedConnectDownload(
  plan: ConnectSeedPlan,
  options: {
    dryRun?: boolean;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<ConnectSeedResult> {
  const sourceFiles = await collectSourceFiles(plan.sourceDir);
  const filesToSeed: SourceFile[] = [];
  let skippedMatchingFiles = 0;

  for (const [index, source] of sourceFiles.entries()) {
    const destination = resolveManifestOutputPath(
      plan.stagingDir,
      source.relativePath
    );
    await assertNoSymlinkInExistingParents(plan.stagingDir, destination);
    const destinationStats = await lstat(destination).catch(
      (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return undefined;
        }
        throw error;
      }
    );
    if (destinationStats?.isSymbolicLink()) {
      throw new UserFacingError(
        `Refusing symbolic-link file in Connect staging: ${destination}`
      );
    }
    if (destinationStats && !destinationStats.isFile()) {
      throw new UserFacingError(
        `Connect staging entry is not a regular file: ${destination}`
      );
    }
    if (destinationStats?.isFile() && destinationStats.size === source.size) {
      const [sourceHash, destinationHash] = await Promise.all([
        sha256File(source.absolutePath),
        sha256File(destination)
      ]);
      if (sourceHash === destinationHash) {
        skippedMatchingFiles += 1;
        options.onProgress?.(index + 1, sourceFiles.length);
        continue;
      }
    }
    filesToSeed.push(source);
    options.onProgress?.(index + 1, sourceFiles.length);
  }

  const seededBytes = filesToSeed.reduce((total, file) => total + file.size, 0);
  if (!options.dryRun && filesToSeed.length > 0) {
    const filesystem = await statfs(plan.stagingDir);
    const availableBytes = filesystem.bavail * filesystem.bsize;
    const requiredBytes = seededBytes + 256 * 1024 * 1024;
    if (availableBytes < requiredBytes) {
      throw new UserFacingError(
        `Insufficient free space for Connect staging. Need at least ${requiredBytes} bytes available.`
      );
    }

    for (const [index, source] of filesToSeed.entries()) {
      await copyFileAtomically(source, plan.stagingDir);
      options.onProgress?.(
        sourceFiles.length + index + 1,
        sourceFiles.length + filesToSeed.length
      );
    }
  }

  return {
    ...plan,
    totalFiles: sourceFiles.length,
    skippedMatchingFiles,
    seededFiles: filesToSeed.length,
    seededBytes
  };
}

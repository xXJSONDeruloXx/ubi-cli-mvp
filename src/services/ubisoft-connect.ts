import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rm,
  stat
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { sanitizedChildEnvironment } from '../util/child-env';
import { UserFacingError } from '../util/errors';

const execFileAsync = promisify(execFile);

export const UBISOFT_CONNECT_INSTALLER_URL =
  'https://static3.cdn.ubi.com/orbit/launcher_installer/UbisoftConnectInstaller.exe';
export const UBISOFT_CONNECT_INSTALLER_SHA256 =
  'da5de90b0655de136f4b33624da2e77c25b758c30708e2ec2e446c8fd3d68e33';

const CONNECT_INSTALL_MARKER_RELATIVE_PATH = path.join(
  '.ubi-cli',
  'verified-connect-install.json'
);

const CONNECT_RELATIVE_PATHS = [
  path.join(
    'drive_c',
    'Program Files (x86)',
    'Ubisoft',
    'Ubisoft Game Launcher',
    'UbisoftConnect.exe'
  ),
  path.join(
    'drive_c',
    'Program Files',
    'Ubisoft',
    'Ubisoft Game Launcher',
    'UbisoftConnect.exe'
  )
];

export interface ProcessSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio?: 'inherit' | 'ignore';
}

export interface InstallerVerification {
  sha256: string;
  size: number;
  hasAuthenticodeCertificate: boolean;
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

function readUInt32(buffer: Buffer, offset: number): number | undefined {
  if (offset < 0 || offset + 4 > buffer.length) {
    return undefined;
  }
  return buffer.readUInt32LE(offset);
}

async function hasAuthenticodeCertificate(filePath: string): Promise<boolean> {
  const fileStats = await stat(filePath);
  const handle = await open(filePath, 'r');
  const header = Buffer.alloc(4096);

  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const view = header.subarray(0, bytesRead);
    if (view.length < 0x40 || view.subarray(0, 2).toString('ascii') !== 'MZ') {
      return false;
    }

    const peOffset = readUInt32(view, 0x3c);
    if (
      peOffset === undefined ||
      peOffset + 24 > view.length ||
      view.subarray(peOffset, peOffset + 4).toString('binary') !== 'PE\0\0'
    ) {
      return false;
    }

    const optionalHeader = peOffset + 24;
    if (optionalHeader + 2 > view.length) {
      return false;
    }
    const magic = view.readUInt16LE(optionalHeader);
    const dataDirectory =
      optionalHeader + (magic === 0x10b ? 96 : magic === 0x20b ? 112 : -1);
    if (dataDirectory < optionalHeader) {
      return false;
    }

    const securityDirectory = dataDirectory + 4 * 8;
    const certificateOffset = readUInt32(view, securityDirectory);
    const certificateSize = readUInt32(view, securityDirectory + 4);
    if (
      certificateOffset === undefined ||
      certificateSize === undefined ||
      certificateOffset === 0 ||
      certificateSize < 8 ||
      certificateOffset + certificateSize > fileStats.size
    ) {
      return false;
    }

    const certificateHeader = Buffer.alloc(8);
    const result = await handle.read(
      certificateHeader,
      0,
      certificateHeader.length,
      certificateOffset
    );
    if (result.bytesRead !== certificateHeader.length) {
      return false;
    }

    const certificateLength = certificateHeader.readUInt32LE(0);
    const certificateType = certificateHeader.readUInt16LE(6);
    return (
      certificateLength >= 8 &&
      certificateLength <= certificateSize &&
      certificateType === 2
    );
  } finally {
    await handle.close();
  }
}

export async function verifyUbisoftConnectInstaller(
  installerPath: string,
  expectedSha256 = UBISOFT_CONNECT_INSTALLER_SHA256
): Promise<InstallerVerification> {
  const installerStats = await stat(installerPath).catch(() => undefined);
  if (!installerStats?.isFile()) {
    throw new UserFacingError(
      `Ubisoft Connect installer does not exist: ${installerPath}`
    );
  }

  const [sha256, hasCertificate] = await Promise.all([
    sha256File(installerPath),
    hasAuthenticodeCertificate(installerPath)
  ]);
  if (sha256 !== expectedSha256.toLowerCase()) {
    throw new UserFacingError(
      `Ubisoft Connect installer SHA-256 mismatch. Expected ${expectedSha256}, received ${sha256}. Refusing to execute it.`
    );
  }
  if (!hasCertificate) {
    throw new UserFacingError(
      'Ubisoft Connect installer has no valid PE Authenticode certificate table. Refusing to execute it.'
    );
  }

  return {
    sha256,
    size: installerStats.size,
    hasAuthenticodeCertificate: hasCertificate
  };
}

export async function isEmptyDirectory(directory: string): Promise<boolean> {
  const entries = await opendir(directory);
  for await (const _entry of entries) {
    return false;
  }
  return true;
}

export async function isRecognizableWinePrefix(
  directory: string
): Promise<boolean> {
  const [drive, systemRegistry, userRegistry] = await Promise.all([
    lstat(path.join(directory, 'drive_c')).catch(() => undefined),
    lstat(path.join(directory, 'system.reg')).catch(() => undefined),
    lstat(path.join(directory, 'user.reg')).catch(() => undefined)
  ]);
  return Boolean(
    drive?.isDirectory() &&
    !drive.isSymbolicLink() &&
    systemRegistry?.isFile() &&
    !systemRegistry.isSymbolicLink() &&
    userRegistry?.isFile() &&
    !userRegistry.isSymbolicLink()
  );
}

async function assertSafeInstallDirectoryTree(
  directory: string
): Promise<void> {
  const entries = await opendir(directory);
  for await (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) {
      throw new UserFacingError(
        `Refusing Ubisoft Connect installation through a symlinked existing entry: ${entryPath}`
      );
    }
    if (stats.isDirectory()) {
      const canonical = await realpath(entryPath).catch(() => undefined);
      if (canonical !== entryPath) {
        throw new UserFacingError(
          `Refusing Ubisoft Connect installation through an aliased directory: ${entryPath}`
        );
      }
      await assertSafeInstallDirectoryTree(entryPath);
      continue;
    }
    if (!stats.isFile() || stats.nlink !== 1) {
      throw new UserFacingError(
        `Refusing Ubisoft Connect installation through an unsafe existing file: ${entryPath}`
      );
    }
  }
}

export async function assertSafeUbisoftConnectInstallDestinations(
  prefix: string
): Promise<void> {
  const resolvedPrefix = path.resolve(prefix);
  for (const relativePath of CONNECT_RELATIVE_PATHS) {
    const parentSegments = path.dirname(relativePath).split(path.sep);
    let current = resolvedPrefix;
    for (const segment of parentSegments) {
      current = path.join(current, segment);
      const stats = await lstat(current).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return undefined;
        }
        throw error;
      });
      if (!stats) {
        break;
      }
      const canonical = await realpath(current).catch(() => undefined);
      if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        canonical !== current
      ) {
        throw new UserFacingError(
          `Refusing Ubisoft Connect installation through an unsafe prefix path component: ${current}`
        );
      }
    }

    const installDirectory = path.join(
      resolvedPrefix,
      path.dirname(relativePath)
    );
    const installDirectoryStats = await lstat(installDirectory).catch(
      () => undefined
    );
    if (installDirectoryStats?.isDirectory()) {
      await assertSafeInstallDirectoryTree(installDirectory);
    }

    const destination = path.join(resolvedPrefix, relativePath);
    const destinationStats = await lstat(destination).catch(
      (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return undefined;
        }
        throw error;
      }
    );
    if (destinationStats) {
      const canonicalDestination = await realpath(destination).catch(
        () => undefined
      );
      if (
        !destinationStats.isFile() ||
        destinationStats.isSymbolicLink() ||
        destinationStats.nlink !== 1 ||
        canonicalDestination !== destination
      ) {
        throw new UserFacingError(
          `Refusing Ubisoft Connect installation through an unsafe destination file: ${destination}`
        );
      }
    }
  }
}

export async function prepareWinePrefix(prefix: string): Promise<string> {
  const resolved = path.resolve(prefix);
  const existingPrefix = await lstat(resolved).catch(() => undefined);
  let existingAncestor = resolved;
  while (!(await lstat(existingAncestor).catch(() => undefined))) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) {
      break;
    }
    existingAncestor = parent;
  }
  const [ancestorStats, canonicalAncestor] = await Promise.all([
    lstat(existingAncestor).catch(() => undefined),
    realpath(existingAncestor).catch(() => undefined)
  ]);
  if (
    !ancestorStats?.isDirectory() ||
    ancestorStats.isSymbolicLink() ||
    canonicalAncestor !== existingAncestor
  ) {
    throw new UserFacingError(
      `Wine prefix path must not traverse a symlink: ${resolved}`
    );
  }

  const trustedExistingClient = existingPrefix?.isDirectory()
    ? Boolean(await getUbisoftConnectInstallationProvenance(resolved))
    : false;
  if (
    existingPrefix?.isDirectory() &&
    !existingPrefix.isSymbolicLink() &&
    !(await isEmptyDirectory(resolved)) &&
    !(await isRecognizableWinePrefix(resolved)) &&
    !trustedExistingClient
  ) {
    throw new UserFacingError(
      `Refusing to initialize a nonempty directory that is not a recognizable Wine prefix: ${resolved}`
    );
  }

  await mkdir(resolved, { recursive: true, mode: 0o700 });
  const [prefixStats, canonicalPrefix] = await Promise.all([
    lstat(resolved),
    realpath(resolved)
  ]);
  if (
    !prefixStats.isDirectory() ||
    prefixStats.isSymbolicLink() ||
    canonicalPrefix !== resolved
  ) {
    throw new UserFacingError(
      `Wine prefix must be a real directory, not a symlink: ${resolved}`
    );
  }

  const currentUid = process.getuid?.();
  if (currentUid !== undefined && prefixStats.uid !== currentUid) {
    throw new UserFacingError(
      `Wine prefix is not owned by the current user: ${resolved}`
    );
  }
  await chmod(resolved, 0o700);

  return resolved;
}

export async function findUbisoftConnectExecutable(
  prefix: string
): Promise<string | undefined> {
  const resolvedPrefix = path.resolve(prefix);
  for (const relativePath of CONNECT_RELATIVE_PATHS) {
    const candidate = path.join(resolvedPrefix, relativePath);
    const [candidateStats, canonicalCandidate] = await Promise.all([
      lstat(candidate).catch(() => undefined),
      realpath(candidate).catch(() => undefined)
    ]);
    if (
      candidateStats?.isFile() &&
      !candidateStats.isSymbolicLink() &&
      candidateStats.size > 0 &&
      canonicalCandidate === candidate
    ) {
      return candidate;
    }
  }
  return undefined;
}

export type ConnectInstallationProvenance =
  | 'pinned-installer'
  | 'explicit-trust';

export async function getUbisoftConnectInstallationProvenance(
  prefix: string,
  executable?: string
): Promise<ConnectInstallationProvenance | undefined> {
  const resolvedPrefix = path.resolve(prefix);
  const clientExecutable =
    executable ?? (await findUbisoftConnectExecutable(resolvedPrefix));
  if (!clientExecutable) {
    return undefined;
  }
  const markerPath = path.join(
    resolvedPrefix,
    CONNECT_INSTALL_MARKER_RELATIVE_PATH
  );
  const markerDirectory = path.dirname(markerPath);
  const [directoryStats, canonicalDirectory, markerStats] = await Promise.all([
    lstat(markerDirectory).catch(() => undefined),
    realpath(markerDirectory).catch(() => undefined),
    lstat(markerPath).catch(() => undefined)
  ]);
  const currentUid = process.getuid?.();
  if (
    !directoryStats?.isDirectory() ||
    directoryStats.isSymbolicLink() ||
    canonicalDirectory !== markerDirectory ||
    (directoryStats.mode & 0o077) !== 0 ||
    (currentUid !== undefined && directoryStats.uid !== currentUid) ||
    !markerStats?.isFile() ||
    markerStats.isSymbolicLink() ||
    markerStats.size === 0 ||
    markerStats.size > 4096 ||
    (markerStats.mode & 0o077) !== 0 ||
    (currentUid !== undefined && markerStats.uid !== currentUid)
  ) {
    return undefined;
  }
  let handle;
  try {
    handle = await open(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const marker = JSON.parse(await handle.readFile('utf8')) as Record<
      string,
      unknown
    >;
    if (
      marker.version !== 1 ||
      marker.clientRelativePath !==
        path.relative(resolvedPrefix, clientExecutable)
    ) {
      return undefined;
    }
    if (
      marker.provenance === 'pinned-installer' &&
      marker.installerSha256 === UBISOFT_CONNECT_INSTALLER_SHA256
    ) {
      return 'pinned-installer';
    }
    if (marker.provenance === 'explicit-trust') {
      return 'explicit-trust';
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

export async function isUbisoftConnectInstallationVerified(
  prefix: string,
  executable?: string
): Promise<boolean> {
  return Boolean(
    await getUbisoftConnectInstallationProvenance(prefix, executable)
  );
}

export async function trustUbisoftConnectInstallation(
  prefix: string,
  executable?: string,
  provenance: ConnectInstallationProvenance = 'explicit-trust'
): Promise<void> {
  const resolvedPrefix = path.resolve(prefix);
  const discoveredExecutable =
    await findUbisoftConnectExecutable(resolvedPrefix);
  const clientExecutable = executable
    ? path.resolve(executable)
    : discoveredExecutable;
  if (
    !discoveredExecutable ||
    !clientExecutable ||
    clientExecutable !== discoveredExecutable
  ) {
    throw new UserFacingError(
      'A safe existing Ubisoft Connect executable was not found to trust.'
    );
  }
  const markerPath = path.join(
    resolvedPrefix,
    CONNECT_INSTALL_MARKER_RELATIVE_PATH
  );
  const markerDirectory = path.dirname(markerPath);
  const existingDirectory = await lstat(markerDirectory).catch(() => undefined);
  if (existingDirectory?.isSymbolicLink()) {
    throw new UserFacingError(
      'Refusing a symlinked Connect installation provenance directory.'
    );
  }
  await mkdir(markerDirectory, { recursive: true, mode: 0o700 });
  const [directoryStats, canonicalDirectory] = await Promise.all([
    lstat(markerDirectory),
    realpath(markerDirectory)
  ]);
  const currentUid = process.getuid?.();
  if (
    !directoryStats.isDirectory() ||
    directoryStats.isSymbolicLink() ||
    canonicalDirectory !== markerDirectory ||
    (currentUid !== undefined && directoryStats.uid !== currentUid)
  ) {
    throw new UserFacingError(
      'Connect installation provenance directory must be a user-owned real directory.'
    );
  }
  await chmod(markerDirectory, 0o700);
  const temporary = `${markerPath}.${randomUUID()}.partial`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(
        `${JSON.stringify(
          {
            version: 1,
            provenance,
            ...(provenance === 'pinned-installer'
              ? { installerSha256: UBISOFT_CONNECT_INSTALLER_SHA256 }
              : {}),
            clientRelativePath: path.relative(resolvedPrefix, clientExecutable)
          },
          null,
          2
        )}\n`
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, markerPath);
    await chmod(markerPath, 0o600);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function downloadPinnedInstaller(destination: string): Promise<void> {
  const temporary = `${destination}.${process.pid}.partial`;
  await rm(temporary, { force: true });

  try {
    const response = await fetch(UBISOFT_CONNECT_INSTALLER_URL, {
      redirect: 'follow',
      signal: AbortSignal.timeout(5 * 60_000)
    });
    const finalUrl = new URL(response.url);
    if (
      !response.ok ||
      !response.body ||
      finalUrl.protocol !== 'https:' ||
      finalUrl.hostname !== 'static3.cdn.ubi.com' ||
      finalUrl.pathname !==
        '/orbit/launcher_installer/UbisoftConnectInstaller.exe'
    ) {
      throw new UserFacingError(
        `Official Ubisoft Connect installer download failed with HTTP ${response.status}.`
      );
    }

    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
    );
    const handle = await open(temporary, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await verifyUbisoftConnectInstaller(temporary);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    if (error instanceof UserFacingError) {
      throw error;
    }
    throw new UserFacingError(
      `Could not download the official Ubisoft Connect installer: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function getVerifiedUbisoftConnectInstaller(
  cacheDir: string,
  suppliedInstaller?: string
): Promise<string> {
  const cachePath = path.join(
    cacheDir,
    'ubisoft-connect',
    `UbisoftConnectInstaller-${UBISOFT_CONNECT_INSTALLER_SHA256.slice(0, 12)}.exe`
  );

  if (suppliedInstaller) {
    const source = path.resolve(suppliedInstaller);
    await verifyUbisoftConnectInstaller(source);
    await mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 });
    if (source !== cachePath) {
      const temporary = `${cachePath}.${process.pid}.partial`;
      await rm(temporary, { force: true });
      try {
        await copyFile(source, temporary);
        await chmod(temporary, 0o600);
        await verifyUbisoftConnectInstaller(temporary);
        await rename(temporary, cachePath);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    }
    await chmod(cachePath, 0o600);
    return cachePath;
  }

  const cachedStats = await stat(cachePath).catch(() => undefined);
  if (cachedStats?.isFile()) {
    await verifyUbisoftConnectInstaller(cachePath);
    await chmod(cachePath, 0o600);
    return cachePath;
  }

  await downloadPinnedInstaller(cachePath);
  return cachePath;
}

export function buildWineProcessSpec(
  runner: string,
  executable: string,
  prefix: string | undefined,
  runnerArgs: string[] = [],
  extraEnv: NodeJS.ProcessEnv = {}
): ProcessSpec {
  return {
    command: runner,
    args: [...runnerArgs, executable],
    cwd: path.dirname(executable),
    env: sanitizedChildEnvironment({
      ...extraEnv,
      ...(prefix ? { WINEPREFIX: prefix } : {})
    })
  };
}

export async function runProcess(
  spec: ProcessSpec,
  description: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: spec.stdio ?? 'inherit'
    });
    child.once('error', (error) => {
      reject(
        new UserFacingError(
          `Could not start ${description} with ${spec.command}: ${error.message}`
        )
      );
    });
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new UserFacingError(
          `${description} exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}.`
        )
      );
    });
  });
}

async function wineTaskIsRunning(
  runner: string,
  runnerArgs: string[],
  prefix: string,
  imageName: string
): Promise<boolean> {
  try {
    const result = await execFileAsync(runner, [...runnerArgs, 'tasklist'], {
      env: sanitizedChildEnvironment({
        WINEPREFIX: prefix,
        WINEDEBUG: '-all'
      }),
      encoding: 'utf8'
    });
    return result.stdout.toLowerCase().includes(imageName.toLowerCase());
  } catch (error) {
    throw new UserFacingError(
      `Could not inspect Wine processes: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function waitForWineProcessLifecycle(
  runner: string,
  runnerArgs: string[],
  prefix: string,
  imageName: string,
  options: {
    startTimeoutMs?: number;
    absentSettleMs?: number;
    pollIntervalMs?: number;
  } = {}
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const startDeadline = Date.now() + (options.startTimeoutMs ?? 2 * 60_000);
  let started = false;
  while (Date.now() < startDeadline) {
    if (await wineTaskIsRunning(runner, runnerArgs, prefix, imageName)) {
      started = true;
      break;
    }
    await delay(pollIntervalMs);
  }
  if (!started) {
    throw new UserFacingError(
      `${imageName} did not start within two minutes. Ubisoft Connect was left open for inspection.`
    );
  }

  const settleMs = options.absentSettleMs ?? 5_000;
  let absentSince: number | undefined;
  while (true) {
    if (await wineTaskIsRunning(runner, runnerArgs, prefix, imageName)) {
      absentSince = undefined;
    } else {
      absentSince ??= Date.now();
      if (Date.now() - absentSince >= settleMs) {
        return;
      }
    }
    await delay(pollIntervalMs);
  }
}

export async function stopUbisoftConnect(
  runner: string,
  runnerArgs: string[],
  prefix: string
): Promise<void> {
  try {
    await execFileAsync(runner, [...runnerArgs, 'taskkill', '/IM', 'upc.exe'], {
      env: sanitizedChildEnvironment({
        WINEPREFIX: prefix,
        WINEDEBUG: '-all'
      }),
      encoding: 'utf8'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/not found|no running instance|128/i.test(message)) {
      throw new UserFacingError(`Could not stop Ubisoft Connect: ${message}`);
    }
  }
}

export async function installUbisoftConnect(
  runner: string,
  runnerArgs: string[],
  prefix: string,
  installerPath: string,
  stdio: 'inherit' | 'ignore' = 'inherit'
): Promise<string> {
  await assertSafeUbisoftConnectInstallDestinations(prefix);
  const spec = buildWineProcessSpec(runner, installerPath, prefix, runnerArgs, {
    WINEDLLOVERRIDES: 'mscoree,mshtml='
  });
  spec.args.push('/S');
  spec.stdio = stdio;
  await runProcess(spec, 'Ubisoft Connect installer');

  const executable = await findUbisoftConnectExecutable(prefix);
  if (!executable) {
    throw new UserFacingError(
      'Ubisoft Connect installer exited successfully, but UbisoftConnect.exe was not found in the Wine prefix.'
    );
  }
  await trustUbisoftConnectInstallation(prefix, executable, 'pinned-installer');
  return executable;
}

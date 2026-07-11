import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { AppPaths } from '../models/config';
import { UserFacingError } from '../util/errors';

const DOWNLOAD_STATE_VERSION = 1;

interface CompletedFileState {
  bytes: number;
  sha256: string;
}

interface DownloadState {
  version: number;
  demuxProductId: number;
  manifestHash: string;
  manifestSha256: string;
  outputRoot: string;
  completedFiles: Record<string, CompletedFileState>;
}

export interface DownloadStateContext {
  demuxProductId: number;
  manifestHash: string;
  manifestBody: Buffer;
  outputRoot: string;
}

function getStateDirectory(paths: AppPaths): string {
  return path.join(
    paths.dataDir ?? path.dirname(paths.sessionFile),
    'download-state'
  );
}

function getStatePath(paths: AppPaths, outputRoot: string): string {
  const rootHash = createHash('sha256').update(outputRoot).digest('hex');
  return path.join(getStateDirectory(paths), `${rootHash}.json`);
}

function getManifestSha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

async function writeJsonAtomically(
  filePath: string,
  value: unknown
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, 'wx', 0o600);

  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, filePath);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function sha256File(filePath: string): Promise<string> {
  const body = await readFile(filePath);
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Tracks files that were atomically published from a specific live manifest.
 * It deliberately stores neither session values nor signed URLs.
 */
export class DownloadStateStore {
  private readonly outputRoot: string;
  private readonly statePath: string;
  private state: DownloadState;
  private writeQueue = Promise.resolve();

  private constructor(
    paths: AppPaths,
    context: DownloadStateContext,
    state: DownloadState
  ) {
    this.outputRoot = path.resolve(context.outputRoot);
    this.statePath = getStatePath(paths, this.outputRoot);
    this.state = state;
  }

  public static async open(
    paths: AppPaths,
    context: DownloadStateContext,
    options: { restart?: boolean } = {}
  ): Promise<DownloadStateStore> {
    const outputRoot = path.resolve(context.outputRoot);
    const manifestSha256 = getManifestSha256(context.manifestBody);
    const statePath = getStatePath(paths, outputRoot);
    let existing: DownloadState | undefined;

    try {
      existing = JSON.parse(await readFile(statePath, 'utf8')) as DownloadState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new UserFacingError(
          `Could not read download resume state at ${statePath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const matching =
      existing &&
      existing.version === DOWNLOAD_STATE_VERSION &&
      existing.demuxProductId === context.demuxProductId &&
      existing.manifestHash === context.manifestHash &&
      existing.manifestSha256 === manifestSha256 &&
      existing.outputRoot === outputRoot;

    if (existing && !matching && !options.restart) {
      throw new UserFacingError(
        'Existing download resume state belongs to a different product or manifest. Re-run download-game with --restart to replace it deliberately.'
      );
    }

    return new DownloadStateStore(
      paths,
      { ...context, outputRoot },
      {
        version: DOWNLOAD_STATE_VERSION,
        demuxProductId: context.demuxProductId,
        manifestHash: context.manifestHash,
        manifestSha256,
        outputRoot,
        completedFiles: matching && existing ? existing.completedFiles : {}
      }
    );
  }

  public async isComplete(
    manifestPath: string,
    outputPath: string,
    expectedBytes: number
  ): Promise<boolean> {
    const completed = this.state.completedFiles[manifestPath];
    if (!completed || completed.bytes !== expectedBytes) {
      return false;
    }

    try {
      return (await sha256File(outputPath)) === completed.sha256;
    } catch {
      return false;
    }
  }

  public async recordCompleted(
    manifestPath: string,
    outputPath: string,
    bytes: number
  ): Promise<void> {
    const sha256 = await sha256File(outputPath);
    this.state.completedFiles[manifestPath] = { bytes, sha256 };
    this.writeQueue = this.writeQueue.then(() =>
      writeJsonAtomically(this.statePath, this.state)
    );
    await this.writeQueue;
  }

  public get filePath(): string {
    return this.statePath;
  }
}

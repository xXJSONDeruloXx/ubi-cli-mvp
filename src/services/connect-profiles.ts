import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { UserFacingError } from '../util/errors';

export interface ConnectGameProfile {
  productId: string;
  installDir: string;
  winePrefix?: string;
  executable?: string;
}

export interface ConnectProfileStore {
  version: 1;
  defaultWinePrefix?: string;
  games: Record<string, ConnectGameProfile>;
}

export function emptyConnectProfileStore(): ConnectProfileStore {
  return { version: 1, games: {} };
}

function validateAbsolutePath(value: unknown, field: string): string {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new UserFacingError(
      `Connect profile ${field} must be an absolute path.`
    );
  }
  return path.resolve(value);
}

function validateStore(value: unknown): ConnectProfileStore {
  if (typeof value !== 'object' || value === null) {
    throw new UserFacingError('Connect profile store must contain an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new UserFacingError('Unsupported Connect profile store version.');
  }
  if (typeof record.games !== 'object' || record.games === null) {
    throw new UserFacingError('Connect profile store has no games object.');
  }

  const games: Record<string, ConnectGameProfile> = {};
  for (const [key, rawProfile] of Object.entries(
    record.games as Record<string, unknown>
  )) {
    if (!/^\d+$/.test(key) || typeof rawProfile !== 'object' || !rawProfile) {
      throw new UserFacingError(
        'Connect profile store contains an invalid game.'
      );
    }
    const profile = rawProfile as Record<string, unknown>;
    if (profile.productId !== key) {
      throw new UserFacingError(
        `Connect profile product ID mismatch for ${key}.`
      );
    }
    const executable = profile.executable;
    if (
      executable !== undefined &&
      (typeof executable !== 'string' ||
        !executable ||
        path.posix.isAbsolute(executable) ||
        path.win32.isAbsolute(executable) ||
        executable.split(/[\\/]/).some((segment) => segment === '..'))
    ) {
      throw new UserFacingError(
        `Connect profile executable for ${key} must be a safe relative path.`
      );
    }
    games[key] = {
      productId: key,
      installDir: validateAbsolutePath(profile.installDir, 'installDir'),
      ...(profile.winePrefix
        ? {
            winePrefix: validateAbsolutePath(profile.winePrefix, 'winePrefix')
          }
        : {}),
      ...(typeof executable === 'string' ? { executable } : {})
    };
  }

  return {
    version: 1,
    ...(record.defaultWinePrefix
      ? {
          defaultWinePrefix: validateAbsolutePath(
            record.defaultWinePrefix,
            'defaultWinePrefix'
          )
        }
      : {}),
    games
  };
}

export async function loadConnectProfiles(
  storePath: string
): Promise<ConnectProfileStore> {
  const storeStats = await lstat(storePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  });
  if (!storeStats) {
    return emptyConnectProfileStore();
  }
  if (!storeStats.isFile() || storeStats.isSymbolicLink()) {
    throw new UserFacingError(
      `Connect profile store must be a regular file: ${storePath}`
    );
  }
  if (storeStats.size > 1024 * 1024) {
    throw new UserFacingError('Connect profile store is unexpectedly large.');
  }

  try {
    return validateStore(JSON.parse(await readFile(storePath, 'utf8')));
  } catch (error) {
    if (error instanceof UserFacingError) {
      throw error;
    }
    throw new UserFacingError(
      `Could not parse Connect profile store: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function saveConnectProfiles(
  storePath: string,
  store: ConnectProfileStore
): Promise<void> {
  const validated = validateStore(store);
  const directory = path.dirname(storePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStats = await lstat(directory);
  const currentUid = process.getuid?.();
  if (
    !directoryStats.isDirectory() ||
    directoryStats.isSymbolicLink() ||
    (currentUid !== undefined && directoryStats.uid !== currentUid)
  ) {
    throw new UserFacingError(
      'Connect profile directory must be a user-owned real directory.'
    );
  }

  const temporary = path.join(
    directory,
    `.${path.basename(storePath)}.${randomUUID()}.partial`
  );
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, storePath);
    await chmod(storePath, 0o600);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export function resolveProfileWinePrefix(
  store: ConnectProfileStore,
  productId: string
): string {
  const profile = store.games[productId];
  if (!profile) {
    throw new UserFacingError(
      `No Connect profile exists for product ${productId}.`
    );
  }
  const prefix = profile.winePrefix ?? store.defaultWinePrefix;
  if (!prefix) {
    throw new UserFacingError(
      `Connect profile ${productId} has no Wine prefix and no default is configured.`
    );
  }
  return prefix;
}

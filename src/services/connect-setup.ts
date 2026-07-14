import { lstat, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  findUbisoftConnectExecutable,
  getUbisoftConnectInstallationProvenance,
  isEmptyDirectory,
  isRecognizableWinePrefix,
  type ConnectInstallationProvenance
} from './ubisoft-connect';

export type RememberedConnectAuthStatus = 'present' | 'partial' | 'absent';

export interface ConnectSetupInspection {
  winePrefix: string;
  prefixExists: boolean;
  pathSafe: boolean;
  prefixSafe: boolean;
  prefixEmpty: boolean;
  prefixRecognizable: boolean;
  clientInstalled: boolean;
  clientTrusted: boolean;
  clientProvenance?: ConnectInstallationProvenance;
  clientExecutable?: string;
  rememberedAuth: RememberedConnectAuthStatus;
  authEvidence: {
    secureStorage: boolean;
    userState: boolean;
    ownershipCache: boolean;
  };
}

async function isNonEmptyRegularFile(filePath: string): Promise<boolean> {
  const stats = await lstat(filePath).catch(() => undefined);
  return Boolean(stats?.isFile() && !stats.isSymbolicLink() && stats.size > 0);
}

async function resolveRealDirectoryChain(
  root: string,
  segments: string[]
): Promise<string | undefined> {
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const [stats, canonical] = await Promise.all([
      lstat(current).catch(() => undefined),
      realpath(current).catch(() => undefined)
    ]);
    if (
      !stats?.isDirectory() ||
      stats.isSymbolicLink() ||
      canonical !== current
    ) {
      return undefined;
    }
  }
  return current;
}

async function hasOwnershipCache(cacheDirectory: string): Promise<boolean> {
  const cacheStats = await lstat(cacheDirectory).catch(() => undefined);
  if (!cacheStats?.isDirectory() || cacheStats.isSymbolicLink()) {
    return false;
  }

  const directory = await opendir(cacheDirectory);
  for await (const entry of directory) {
    if (
      entry.isFile() &&
      (await isNonEmptyRegularFile(path.join(cacheDirectory, entry.name)))
    ) {
      return true;
    }
  }
  return false;
}

async function resolveAuthCandidate(
  usersDirectory: string,
  userName: string
): Promise<string | undefined> {
  return resolveRealDirectoryChain(usersDirectory, [
    userName,
    'AppData',
    'Local',
    'Ubisoft Game Launcher'
  ]);
}

async function inspectAuthCandidate(candidate: string): Promise<{
  secureStorage: boolean;
  userState: boolean;
  ownershipCache: boolean;
}> {
  const candidateStats = await lstat(candidate).catch(() => undefined);
  if (!candidateStats?.isDirectory() || candidateStats.isSymbolicLink()) {
    return {
      secureStorage: false,
      userState: false,
      ownershipCache: false
    };
  }

  const ownershipDirectory = await resolveRealDirectoryChain(candidate, [
    'cache',
    'ownership'
  ]);
  const [secureStorage, userState, ownershipCache] = await Promise.all([
    isNonEmptyRegularFile(path.join(candidate, 'ConnectSecureStorage.dat')),
    isNonEmptyRegularFile(path.join(candidate, 'user.dat')),
    ownershipDirectory
      ? hasOwnershipCache(ownershipDirectory)
      : Promise.resolve(false)
  ]);
  return { secureStorage, userState, ownershipCache };
}

function evidenceScore(evidence: {
  secureStorage: boolean;
  userState: boolean;
  ownershipCache: boolean;
}): number {
  return (
    Number(evidence.secureStorage) +
    Number(evidence.userState) +
    Number(evidence.ownershipCache)
  );
}

async function inspectRememberedAuth(prefix: string): Promise<{
  status: RememberedConnectAuthStatus;
  evidence: {
    secureStorage: boolean;
    userState: boolean;
    ownershipCache: boolean;
  };
}> {
  const usersDirectory = path.join(prefix, 'drive_c', 'users');
  const [usersStats, canonicalUsers] = await Promise.all([
    lstat(usersDirectory).catch(() => undefined),
    realpath(usersDirectory).catch(() => undefined)
  ]);
  if (
    !usersStats?.isDirectory() ||
    usersStats.isSymbolicLink() ||
    canonicalUsers !== usersDirectory
  ) {
    return {
      status: 'absent',
      evidence: {
        secureStorage: false,
        userState: false,
        ownershipCache: false
      }
    };
  }

  let best = {
    secureStorage: false,
    userState: false,
    ownershipCache: false
  };
  const users = await opendir(usersDirectory);
  for await (const entry of users) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = await resolveAuthCandidate(usersDirectory, entry.name);
    if (!candidate) {
      continue;
    }
    const evidence = await inspectAuthCandidate(candidate);
    if (evidenceScore(evidence) > evidenceScore(best)) {
      best = evidence;
    }
  }

  const score = evidenceScore(best);
  return {
    status: score === 3 ? 'present' : score > 0 ? 'partial' : 'absent',
    evidence: best
  };
}

export async function inspectConnectSetup(
  winePrefix: string
): Promise<ConnectSetupInspection> {
  const resolved = path.resolve(winePrefix);
  const [prefixStats, canonical] = await Promise.all([
    lstat(resolved).catch(() => undefined),
    realpath(resolved).catch(() => undefined)
  ]);
  if (!prefixStats) {
    let existingAncestor = path.dirname(resolved);
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
    const pathSafe = Boolean(
      ancestorStats?.isDirectory() &&
      !ancestorStats.isSymbolicLink() &&
      canonicalAncestor === existingAncestor
    );
    return {
      winePrefix: resolved,
      prefixExists: false,
      pathSafe,
      prefixSafe: false,
      prefixEmpty: false,
      prefixRecognizable: false,
      clientInstalled: false,
      clientTrusted: false,
      rememberedAuth: 'absent',
      authEvidence: {
        secureStorage: false,
        userState: false,
        ownershipCache: false
      }
    };
  }

  const currentUid = process.getuid?.();
  const pathSafe = Boolean(
    prefixStats.isDirectory() &&
    !prefixStats.isSymbolicLink() &&
    canonical === resolved &&
    (currentUid === undefined || prefixStats.uid === currentUid)
  );
  const prefixSafe = pathSafe && (prefixStats.mode & 0o077) === 0;
  if (!prefixSafe) {
    return {
      winePrefix: resolved,
      prefixExists: true,
      pathSafe,
      prefixSafe: false,
      prefixEmpty: false,
      prefixRecognizable: false,
      clientInstalled: false,
      clientTrusted: false,
      rememberedAuth: 'absent',
      authEvidence: {
        secureStorage: false,
        userState: false,
        ownershipCache: false
      }
    };
  }

  const [prefixEmpty, prefixRecognizable, clientExecutable] = await Promise.all(
    [
      isEmptyDirectory(resolved),
      isRecognizableWinePrefix(resolved),
      findUbisoftConnectExecutable(resolved)
    ]
  );
  const [clientStats, canonicalClient] = clientExecutable
    ? await Promise.all([
        lstat(clientExecutable).catch(() => undefined),
        realpath(clientExecutable).catch(() => undefined)
      ])
    : [undefined, undefined];
  const clientInstalled = Boolean(
    clientExecutable &&
    clientStats?.isFile() &&
    !clientStats.isSymbolicLink() &&
    canonicalClient === clientExecutable
  );
  const clientProvenance = clientInstalled
    ? await getUbisoftConnectInstallationProvenance(resolved, clientExecutable)
    : undefined;
  const auth = clientInstalled
    ? await inspectRememberedAuth(resolved)
    : {
        status: 'absent' as const,
        evidence: {
          secureStorage: false,
          userState: false,
          ownershipCache: false
        }
      };

  return {
    winePrefix: resolved,
    prefixExists: true,
    pathSafe: true,
    prefixSafe: true,
    prefixEmpty,
    prefixRecognizable,
    clientInstalled,
    clientTrusted: Boolean(clientProvenance),
    ...(clientProvenance ? { clientProvenance } : {}),
    ...(clientInstalled && clientExecutable ? { clientExecutable } : {}),
    rememberedAuth: auth.status,
    authEvidence: auth.evidence
  };
}

import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { UserFacingError } from './errors';

export function normalizeManifestPathForMatch(value: string): string {
  return value.replaceAll('\\', '/').replaceAll('//', '/').toLowerCase();
}

export function manifestPathMatches(
  manifestPath: string,
  filter: string,
  prefixMatch = false
): boolean {
  const normalizedPath = normalizeManifestPathForMatch(manifestPath);
  const normalizedFilter = normalizeManifestPathForMatch(filter);

  return prefixMatch
    ? normalizedPath.startsWith(normalizedFilter)
    : normalizedPath.includes(normalizedFilter);
}

/**
 * Resolves a manifest-provided relative path beneath an operator-selected root.
 * Manifest paths are untrusted network data and must never choose an output
 * location outside that root.
 */
export function resolveManifestOutputPath(
  outputRoot: string,
  manifestPath: string
): string {
  if (!manifestPath || manifestPath.includes('\0')) {
    throw new UserFacingError(
      'Manifest path must be a non-empty relative path.'
    );
  }

  if (
    path.posix.isAbsolute(manifestPath) ||
    path.win32.isAbsolute(manifestPath) ||
    manifestPath.startsWith('\\\\')
  ) {
    throw new UserFacingError(
      `Refusing absolute manifest output path "${manifestPath}".`
    );
  }

  const segments = manifestPath.replaceAll('\\', '/').split('/');
  if (
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new UserFacingError(
      `Refusing unsafe manifest output path "${manifestPath}".`
    );
  }

  const root = path.resolve(outputRoot);
  const resolved = path.resolve(root, ...segments);
  const relative = path.relative(root, resolved);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new UserFacingError(
      `Refusing manifest output path outside the selected directory: "${manifestPath}".`
    );
  }

  return resolved;
}

/** Ensures no manifest-controlled directory component is a symbolic link. */
export async function ensureSafeManifestOutputParent(
  outputRoot: string,
  outputPath: string
): Promise<void> {
  const root = path.resolve(outputRoot);
  const parent = path.dirname(outputPath);
  const relativeParent = path.relative(root, parent);
  if (
    relativeParent === '..' ||
    relativeParent.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeParent)
  ) {
    throw new UserFacingError(
      'Manifest output parent escaped the selected directory.'
    );
  }

  await mkdir(root, { recursive: true });
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new UserFacingError(
      'Selected output directory must be a real directory.'
    );
  }

  let current = root;
  for (const segment of relativeParent ? relativeParent.split(path.sep) : []) {
    current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new UserFacingError(
          `Refusing manifest output through unsafe directory "${segment}".`
        );
      }
    } catch (error) {
      if (error instanceof UserFacingError) {
        throw error;
      }
      await mkdir(current);
    }
  }
}

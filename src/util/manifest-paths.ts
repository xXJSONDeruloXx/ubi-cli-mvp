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

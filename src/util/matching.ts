export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isLikelyNumericId(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

export function scoreTitleMatch(query: string, candidate: string): number {
  const q = normalizeForMatch(query);
  const c = normalizeForMatch(candidate);

  if (q === c) {
    return 100;
  }

  if (c.startsWith(q)) {
    return 80;
  }

  if (c.includes(q)) {
    return 60;
  }

  return 0;
}

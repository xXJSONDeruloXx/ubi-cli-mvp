const SLICE_PATH_PREFIX_CHARS = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v'
] as const;

interface ParsedManifestLike {
  chunks?: Array<{
    files?: Array<{
      slices?: Array<string | Buffer>;
      sliceList?: Array<{
        downloadSha1?: string | Buffer;
      }>;
    }>;
  }>;
}

function collectRawSliceTokens(
  parsed: ParsedManifestLike
): Array<string | Buffer> {
  return (parsed.chunks ?? []).flatMap((chunk) =>
    (chunk.files ?? []).flatMap((file) => {
      const downloadSha1Values = (file.sliceList ?? [])
        .map((slice) => slice.downloadSha1)
        .filter((value): value is string | Buffer => Boolean(value));

      return downloadSha1Values.length > 0
        ? downloadSha1Values
        : (file.slices ?? []);
    })
  );
}

export function fileHashToPathChar(hash: string): string {
  const [firstChar, secondChar] = hash;
  const reversedValue = Buffer.from(
    `${secondChar}${firstChar}`,
    'hex'
  ).readUInt8();
  const isEven = reversedValue % 2 === 0;
  const offset = Math.floor(reversedValue / 16);
  const halfOffset = isEven ? 0 : 16;
  return SLICE_PATH_PREFIX_CHARS[offset + halfOffset] ?? '0';
}

export function sliceTokenToHex(sliceToken: string | Buffer): string {
  return (
    typeof sliceToken === 'string'
      ? Buffer.from(sliceToken, 'base64')
      : Buffer.from(sliceToken)
  )
    .toString('hex')
    .toUpperCase();
}

export function sliceHexToCandidateRelativePaths(hexHash: string): string[] {
  return SLICE_PATH_PREFIX_CHARS.map(
    (prefix) => `slices_v3/${prefix}/${hexHash}`
  );
}

export function sliceTokenToCandidateRelativePaths(
  sliceToken: string | Buffer
): string[] {
  return sliceHexToCandidateRelativePaths(sliceTokenToHex(sliceToken));
}

export function sliceTokenToRelativePath(sliceToken: string | Buffer): string {
  const hexHash = sliceTokenToHex(sliceToken);
  return `slices_v3/${fileHashToPathChar(hexHash)}/${hexHash}`;
}

export function collectUniqueSliceHexHashes(
  parsed: ParsedManifestLike,
  limit?: number
): string[] {
  const unique = [
    ...new Set(
      collectRawSliceTokens(parsed).map((slice) => sliceTokenToHex(slice))
    )
  ];

  return unique.slice(0, limit ?? unique.length);
}

export function collectUniqueSlicePaths(
  parsed: ParsedManifestLike,
  limit?: number
): string[] {
  const unique = [
    ...new Set(
      collectRawSliceTokens(parsed).map((slice) =>
        sliceTokenToRelativePath(slice)
      )
    )
  ];

  return unique.slice(0, limit ?? unique.length);
}

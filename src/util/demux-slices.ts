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
        .filter(
          (value): value is string | Buffer =>
            value !== undefined && decodeSliceToken(value).length === 20
        );

      return downloadSha1Values.length > 0
        ? downloadSha1Values
        : (file.slices ?? []).filter(
            (value) => decodeSliceToken(value).length === 20
          );
    })
  );
}

function decodeSliceToken(sliceToken: string | Buffer): Buffer {
  return typeof sliceToken === 'string'
    ? Buffer.from(sliceToken, 'base64')
    : Buffer.from(sliceToken);
}

export function isValidSliceToken(
  sliceToken: string | Buffer | undefined
): sliceToken is string | Buffer {
  return sliceToken !== undefined && decodeSliceToken(sliceToken).length === 20;
}

export function normalizeManifestSliceList<
  T extends { downloadSha1?: string | Buffer }
>(
  sliceList: T[] | undefined,
  fileSlices: Array<string | Buffer> | undefined
): Array<T | { downloadSha1: string | Buffer }> {
  const fallbackHashes = (fileSlices ?? []).filter(isValidSliceToken);
  if (!sliceList || sliceList.length === 0) {
    return fallbackHashes.map((downloadSha1) => ({ downloadSha1 }));
  }
  return sliceList.map((slice, index) => ({
    ...slice,
    downloadSha1: isValidSliceToken(slice.downloadSha1)
      ? slice.downloadSha1
      : isValidSliceToken(fileSlices?.[index])
        ? fileSlices[index]
        : slice.downloadSha1
  }));
}

export function fileHashToPathChar(hash: string): string {
  if (!/^[a-f0-9]{40}$/i.test(hash)) {
    throw new Error(`Invalid SHA-1 slice hash: ${JSON.stringify(hash)}`);
  }
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
  const decoded = decodeSliceToken(sliceToken);
  if (decoded.length !== 20) {
    throw new Error(
      `Invalid SHA-1 slice token length: expected 20 bytes, got ${decoded.length}`
    );
  }
  return decoded.toString('hex').toUpperCase();
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

export function sliceHexToRelativePath(hexHash: string): string {
  return `slices_v3/${fileHashToPathChar(hexHash)}/${hexHash}`;
}

export function sliceHexToDownloadRelativePaths(hexHash: string): string[] {
  return [sliceHexToRelativePath(hexHash), `slices/${hexHash}`];
}

export function sliceTokenToRelativePath(sliceToken: string | Buffer): string {
  return sliceHexToRelativePath(sliceTokenToHex(sliceToken));
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

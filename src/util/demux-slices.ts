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

export function fileHashToPathChar(hash: string): string {
  const base32Def = [
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
  ];
  const [firstChar, secondChar] = hash;
  const reversedValue = Buffer.from(
    `${secondChar}${firstChar}`,
    'hex'
  ).readUInt8();
  const isEven = reversedValue % 2 === 0;
  const offset = Math.floor(reversedValue / 16);
  const halfOffset = isEven ? 0 : 16;
  return base32Def[offset + halfOffset] ?? '0';
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

export function sliceTokenToRelativePath(sliceToken: string | Buffer): string {
  const hexHash = sliceTokenToHex(sliceToken);
  return `slices_v3/${fileHashToPathChar(hexHash)}/${hexHash}`;
}

export function collectUniqueSlicePaths(
  parsed: ParsedManifestLike,
  limit?: number
): string[] {
  const sliceHashes = (parsed.chunks ?? []).flatMap((chunk) =>
    (chunk.files ?? []).flatMap((file) => {
      const downloadSha1Values = (file.sliceList ?? [])
        .map((slice) => slice.downloadSha1)
        .filter((value): value is string | Buffer => Boolean(value));

      return downloadSha1Values.length > 0
        ? downloadSha1Values
        : (file.slices ?? []);
    })
  );
  const unique = [
    ...new Set(
      sliceHashes.map((sliceToken) => sliceTokenToRelativePath(sliceToken))
    )
  ];

  return unique.slice(0, limit ?? unique.length);
}

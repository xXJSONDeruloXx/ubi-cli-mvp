# Validation

## Environment

- Date: 2026-03-23
- OS: macOS 15.6.1 (24G90)
- Node.js: v24.2.0
- npm: 11.3.0
- Repository: `xXJSONDeruloXx/ubi-cli-mvp`
- Authentication method used for live validation: direct session login against Ubisoft's public session API with credentials supplied locally via `.env`; credentials and session artifacts were not committed and are redacted from this document.[2][9]

## Validation summary

| Capability                           | Status                                  | Evidence                                                                                                                                                                                                                                                 | How to reproduce                                                                              | Notes                                                                                                                                                                                                                                                  |
| ------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ubi doctor`                         | validated live                          | Command returned resolved config/data/cache/debug paths and session presence locally.                                                                                                                                                                    | `node dist/index.js doctor --json`                                                            | Local-only check; no Ubisoft network dependency.                                                                                                                                                                                                       |
| `ubi config show`                    | validated live                          | Command printed the resolved app IDs and filesystem paths used by the CLI.                                                                                                                                                                               | `node dist/index.js config show`                                                              | Local-only check.                                                                                                                                                                                                                                      |
| `ubi login`                          | validated live                          | Direct login succeeded with the HTTP session flow from public reverse-engineering references.[2][9]                                                                                                                                                      | `node dist/index.js login`                                                                    | **Experimentally observed in this repo:** the default direct-login `Ubi-AppId` needed to be `f68a4bb5-608a-4ff2-8123-be8ef797e0a6`; blank `.env` overrides caused a misleading “Ubi-AppId header is missing” error until blank env handling was fixed. |
| `ubi logout`                         | validated live                          | Local session file was removed and login was re-run successfully afterwards.                                                                                                                                                                             | `node dist/index.js logout` then `node dist/index.js login`                                   | Logout is local state deletion only.                                                                                                                                                                                                                   |
| `ubi me`                             | validated live                          | Command returned a live account identity (`source: live`) from `GET /v3/users/{userId}`.[6]                                                                                                                                                              | `node dist/index.js me` or `node dist/index.js me --json`                                     | Personally identifying fields are omitted from this document but were returned by the command during validation.                                                                                                                                       |
| `ubi list`                           | validated live                          | Live GraphQL library query returned 27 raw titles for the validated account; the default deduped summary view collapsed that to 23 rows with 4 multi-variant groups.[6][9][19]                                                                           | `node dist/index.js list` or `node dist/index.js list --json`                                 | 12 of 23 deduped rows mapped to known public product IDs after title-based metadata propagation; the rest remained `productId=unknown`, which reflects gaps in the public mapping dataset rather than command failure.[14][15][19]                     |
| `ubi search "Far Cry 3"`             | validated live / public dataset mix     | Returned multiple public catalog candidates, including product IDs 46 and 101, which makes the plain title query intentionally ambiguous.[12][15][19]                                                                                                    | `node dist/index.js search "Far Cry 3" --json`                                                | This command exists to disambiguate public title matches before running `ubi info <productId>` or `ubi addons <productId>`.                                                                                                                            |
| `ubi info 720`                       | validated live / public dataset mix     | Returned `Assassin's Creed® Unity` with `sources.library=true` and `sources.publicCatalog=true`.                                                                                                                                                         | `node dist/index.js info 720 --json`                                                          | Uses live library resolution plus public catalog/config data.[14][15]                                                                                                                                                                                  |
| `ubi info 46`                        | validated with public dataset           | Returned public metadata for product 46 (`Far Cry® 3`) including one known manifest hash and parsed config summary.                                                                                                                                      | `node dist/index.js info 46 --json`                                                           | Does not require ownership when resolving by public product ID.                                                                                                                                                                                        |
| `ubi manifest 720`                   | validated with public fixture           | Returned `status: parsed-public-fixture` and parsed manifest summary (`chunkCount: 39`, `fileCount: 482`) using a public raw fixture from `UplayManifests`.[11][17]                                                                                      | `node dist/index.js manifest 720 --json`                                                      | Resolution used a live owned title, but manifest bytes came from the public GitHub fixture rather than a live Ubisoft download-service session.                                                                                                        |
| `ubi manifest 46`                    | validated with public fixture           | Returned `status: parsed-public-fixture` for product 46 and parsed a public raw fixture with manifest version 3, `fileCount: 271`, and install/download byte totals.[11][17][19]                                                                         | `node dist/index.js manifest 46 --json`                                                       | Demonstrates reproducible manifest parsing even without ownership.                                                                                                                                                                                     |
| `ubi files 46`                       | validated with public fixture           | Returned the largest manifest file entries for product 46, headed by `data_win32/worlds/fc3_main/fc3_main.dat`.[17][19]                                                                                                                                  | `node dist/index.js files 46 --limit 3`                                                       | Uses the selected public raw manifest fixture, not live download-service URLs.                                                                                                                                                                         |
| `ubi download-plan 46`               | validated with public fixture           | Returned a dry-run plan for product 46 with `installBytes: 11633969174`, `downloadBytes: 9704042273`, and the top 10 largest files.[5][17][19]                                                                                                           | `node dist/index.js download-plan 46`                                                         | This is an inspection/planning feature only; it does not fetch Ubisoft CDN chunks.                                                                                                                                                                     |
| `ubi demux-list --search origins`    | validated live                          | Returned live Demux-owned Origins products, including installable product `3539` with a live manifest and multiple entitlement/DLC rows.[4][19][20]                                                                                                      | `node dist/index.js demux-list --search origins`                                              | This command exposes rawer Demux ownership data than the GraphQL-first `ubi list` path.                                                                                                                                                                |
| `ubi demux-info 3539`                | validated live                          | Returned live Demux metadata for product `3539`, including `latestManifest`, active branch `8751`, `gameCode: ACE`, and many product associations.[4][19][20]                                                                                            | `node dist/index.js demux-info 3539`                                                          | Demonstrates live ownership/config/branch metadata retrieval from Demux.                                                                                                                                                                               |
| `ubi download-urls 3539`             | validated live                          | Returned a live ownership-token expiration and a signed download-service URL for the current `.manifest` asset for owned Demux product `3539`.[4][5][19]                                                                                                 | `node dist/index.js download-urls 3539`                                                       | Some tested products did not expose `.metadata`/`.licenses` URLs in practice even though the protocol supports those request shapes.[5][19]                                                                                                            |
| `ubi manifest 3539 --live`           | validated live                          | Returned `status: parsed-live-demux` for owned product `3539` and parsed a live current-build manifest from a signed Demux download-service URL.[3][5][19]                                                                                               | `node dist/index.js manifest 3539 --live`                                                     | Demonstrates end-to-end ownership-token -> download-service -> manifest fetch -> parser flow for an owned title.                                                                                                                                       |
| `ubi files 3539 --live`              | validated live                          | Returned the largest file entries from the live current-build manifest for owned product `3539`.[3][5][19]                                                                                                                                               | `node dist/index.js files 3539 --live --limit 3`                                              | Uses the current owned build rather than a public fixture snapshot.                                                                                                                                                                                    |
| `ubi download-plan 3539 --live`      | validated live                          | Returned a live dry-run plan for owned product `3539` with `installBytes: 79647476759`, `downloadBytes: 69428160597`, and the top 10 largest files.[3][5][19]                                                                                            | `node dist/index.js download-plan 3539 --live`                                                | This is the closest implemented path to a real downloader today before slice reconstruction.                                                                                                                                                           |
| `ubi slice-urls 3539 --limit 1`      | validated live                          | Returned a signed raw-slice URL derived from the parsed live manifest for owned product `3539`, reporting `totalUniqueSliceCount: 25541` for the current build.[3][5][19]                                                                                | `node dist/index.js slice-urls 3539 --limit 1`                                                | Slice paths were derived from manifest `sliceList[].downloadSha1` values before querying `download_service`.                                                                                                                                           |
| `ubi download-slices 3539 --limit 1` | validated live                          | Downloaded one raw slice blob to local disk at `/tmp/ubi-slice-download-test/...slice` for owned product `3539`.[3][5][19]                                                                                                                               | `node dist/index.js download-slices 3539 --limit 1 --output-dir /tmp/ubi-slice-download-test` | This downloads raw slice payloads only; it still does not reconstruct final installed game files.                                                                                                                                                      |
| `ubi addons 720`                     | validated with public association graph | Returned 20 associated products for product 720, starting with product IDs 1018-1020 and Unity add-on titles from the public catalog datasets.[12][15][19]                                                                                               | `node dist/index.js addons 720 --json`                                                        | Association graph data is useful for DLC exploration, but it is not proof of ownership for the authenticated account.                                                                                                                                  |
| Manifest parser tests                | validated with tests                    | `tests/manifest-parser.test.ts`, `tests/manifest-summary.test.ts`, `tests/manifest-service-live.test.ts`, and `tests/demux-slices.test.ts` assert fixture parsing, size summarization, live-manifest plumbing, and slice-path derivation.[3][17][18][19] | `npm test -- --run tests/manifest-parser.test.ts`                                             | Stable regression coverage for public and live manifest processing helpers.                                                                                                                                                                            |
| Auth/session logic tests             | validated with tests                    | `tests/auth-service.test.ts` covers challenge retry, 2FA response handling, and remember-me refresh.                                                                                                                                                     | `npm test -- --run tests/auth-service.test.ts`                                                | Uses mocked HTTP responses, not live Ubisoft sessions.                                                                                                                                                                                                 |
| Demux transport/auth handshake       | validated live and in tests             | Live `getPatchInfoReq` succeeded, the server reported `latestVersion: 13099`, auth succeeded after pushing that version as `clientVersion`, and `tests/demux-client.test.ts` covers the same sequence.[19][20]                                           | See Demux validation commands below.                                                          | The key finding is that the current service expects patch/version negotiation before auth; the stale default Node package client version times out.                                                                                                    |
| Demux ownership/download client      | validated with tests                    | `tests/demux-client.test.ts` covers ownership initialization and live asset URL request sequencing; `tests/demux-service.test.ts` covers normalization and public-ID reconciliation.                                                                     | `npm test -- --run tests/demux-client.test.ts`                                                | These are unit tests with fake Demux modules/connections, not live service calls.                                                                                                                                                                      |

## Commands run during validation

### Tooling and tests

```bash
npm run ci
npm run build
```

Outcome:

- `format:check`, `lint`, `typecheck`, and all tests passed.
- Current automated test count: 29 tests across 16 test files.

### Auth / account

```bash
node dist/index.js logout
node dist/index.js login
node dist/index.js me
```

Outcome:

- logout succeeded
- login succeeded live
- `me` returned a live identity (`source: live`)

### Library and catalog search

```bash
node dist/index.js list
node dist/index.js list --all --json
node dist/index.js list --search unity
node dist/index.js search "Far Cry 3" --json
```

Outcome:

- the validated account returned 27 raw library entries and 23 deduped summary rows
- 12 deduped rows mapped to known public product IDs via the public product-service/config datasets
- `list --search unity` correctly isolated the deduped `Assassin's Creed® Unity` row with `variantCount: 2`
- `search "Far Cry 3"` returned multiple public catalog candidates, confirming why plain title resolution remains ambiguous for that query

### Product metadata and associated products

```bash
node dist/index.js info 720 --json
node dist/index.js info 46 --json
node dist/index.js addons 720 --json
```

Outcome:

- product `720` resolved to `Assassin's Creed® Unity`
- product `46` resolved to `Far Cry® 3`
- both `info` commands returned manifest-hash and config-summary data when available from public datasets
- `addons 720` returned 20 associated public products, including Unity add-on titles such as product IDs `1018`, `1019`, and `1020`

### Public-fixture manifest inspection and planning

```bash
node dist/index.js manifest 720 --json
node dist/index.js manifest 46 --json
node dist/index.js files 46 --limit 3
node dist/index.js download-plan 46
```

Outcome:

- both public-fixture `manifest` commands returned `status: parsed-public-fixture`
- product `720`: parsed summary included `chunkCount: 39`, `fileCount: 482`
- product `46`: parsed summary included manifest `version: 3`, `fileCount: 271`, `installBytes: 11633969174`, and `downloadBytes: 9704042273`
- `files 46 --limit 3` surfaced the largest files in the fixture, led by `data_win32/worlds/fc3_main/fc3_main.dat`
- `download-plan 46` returned the same byte totals plus the top 10 largest files for dry-run planning

### Live Demux ownership and download-service commands

```bash
node dist/index.js demux-list --search origins
node dist/index.js demux-info 3539
node dist/index.js download-urls 3539
node dist/index.js manifest 3539 --live
node dist/index.js files 3539 --live --limit 3
node dist/index.js download-plan 3539 --live
```

Outcome:

- `demux-list --search origins` returned the installable Origins row (`3539`) plus related entitlement/DLC rows
- `demux-info 3539` returned live Demux metadata including `latestManifest`, `gameCode: ACE`, branch `8751`, and many product associations
- `download-urls 3539` returned live signed URLs for `.manifest`, `.metadata`, and `.licenses`, plus an ownership-token expiration timestamp
- `manifest 3539 --live` returned `status: parsed-live-demux`
- `files 3539 --live --limit 3` surfaced the largest live build files, led by `DataPC_ACE_Egypt_ext.forge`
- `download-plan 3539 --live` returned `installBytes: 79647476759` and `downloadBytes: 69428160597` for the current owned build

### Demux validation commands

```bash
openssl s_client -tls1_2 -connect dmx.upc.ubisoft.com:443 -servername dmx.upc.ubisoft.com -brief </dev/null
```

Outcome:

- TLS 1.2 negotiation succeeded and returned the live `dmx.upc.ubisoft.com` certificate.

Additional repo-local Node experiments validated the following sequence:

1. `getPatchInfoReq`
2. push `clientVersion = latestVersion`
3. `authenticateReq`
4. `ownership_service.initializeReq`
5. `ownershipTokenReq`
6. `download_service.initializeReq`
7. `download_service.urlReq`

Observed results:

- `getPatchInfoReq` returned `latestVersion: 13099`
- authentication succeeded after sending that version as `clientVersion`
- `ownership_service.initializeReq` returned 379 owned-game rows for the validated account
- a live `ownershipTokenReq` succeeded for Demux product `3539`
- `download_service.initializeReq` succeeded for that token
- `urlReq` returned signed CDN URLs for live manifest assets; in the current CLI validation path, a signed `.manifest` URL was observed directly and some products may not expose `.metadata`/`.licenses` URLs in practice.[19]

Interpretation:

- **Confirmed from source:** the Demux handshake includes patch/version and auth primitives, and ownership/download-service request shapes match the reverse-engineered clients.[1][4][5][20]
- **Experimentally observed in this repo:** the current Node package defaults need patch/version negotiation and TLS 1.2 to work reliably against the current live Demux service.[19]
- **Remaining implementation issue:** GraphQL/public-catalog product IDs do not always align 1:1 with Demux ownership product IDs, so reconciliation remains a major implementation concern.[4][14][19]

## Known limitations

1. `ubi list` still relies on the public GraphQL library endpoint rather than replacing it wholesale with Demux ownership output.[6][9][19]
2. Public-catalog product IDs do not always align 1:1 with Demux ownership product IDs, so cross-surface reconciliation still needs implementation work.[4][14][19]
3. Live Demux manifest inspection works for owned products that expose a useful `latestManifest`, but not every entitlement row exposes one.[4][19]
4. The CLI can fetch live signed manifest/metadata/licenses URLs, but it still does **not** download slice/chunk payloads and reconstruct full installed game files.[3][5][19]
5. `ubi addons` currently exposes public associated products from the catalog graph; it does not prove add-on ownership for the authenticated account without Demux-backed ownership reconciliation.[4][12]
6. A local `.env` file is supported for operator convenience, but blank override variables can interfere with runtime defaults if not normalized; this repo now trims blank values before applying overrides.

## Validation interpretation

This repo currently demonstrates a **usable MVP** for:

- session login/logout
- account identity lookup
- live library listing via GraphQL with deduped summary output and search
- source-backed product metadata lookup and public catalog disambiguation
- public association-graph exploration for DLC-like products
- reproducible manifest inspection, file listing, and dry-run download planning via public fixtures
- validated and now exposed Demux transport/auth, ownership inspection, ownership-token retrieval, download-service URL retrieval, and live-manifest parsing for owned titles

It does **not** yet implement chunk downloading/reconstruction or a full installer/update engine, but the remaining blocker is now post-manifest download orchestration rather than basic Demux connectivity.
ining blocker is now post-manifest download orchestration rather than basic Demux connectivity.

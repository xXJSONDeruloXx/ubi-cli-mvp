# Validation

## Environment

- Date: 2026-03-23
- OS: macOS 15.6.1 (24G90)
- Node.js: v24.2.0
- npm: 11.3.0
- Repository: `xXJSONDeruloXx/ubi-cli-mvp`
- Authentication method used for live validation: direct session login against Ubisoft's public session API with credentials supplied locally via `.env`; credentials and session artifacts were not committed and are redacted from this document.[2][9]

## Validation summary

| Capability                               | Status                                  | Evidence                                                                                                                                                                                                                         | How to reproduce                                                                                | Notes                                                                                                                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ubi doctor`                             | validated live                          | Command returned resolved config/data/cache/debug paths and session presence locally.                                                                                                                                            | `node dist/index.js doctor --json`                                                              | Local-only check; no Ubisoft network dependency.                                                                                                                                                                                                       |
| `ubi config show`                        | validated live                          | Command printed the resolved app IDs and filesystem paths used by the CLI.                                                                                                                                                       | `node dist/index.js config show`                                                                | Local-only check.                                                                                                                                                                                                                                      |
| `ubi login`                              | validated live                          | Direct login succeeded with the HTTP session flow from public reverse-engineering references.[2][9]                                                                                                                              | `node dist/index.js login`                                                                      | **Experimentally observed in this repo:** the default direct-login `Ubi-AppId` needed to be `f68a4bb5-608a-4ff2-8123-be8ef797e0a6`; blank `.env` overrides caused a misleading “Ubi-AppId header is missing” error until blank env handling was fixed. |
| `ubi logout`                             | validated live                          | Local session file was removed and login was re-run successfully afterwards.                                                                                                                                                     | `node dist/index.js logout` then `node dist/index.js login`                                     | Logout is local state deletion only.                                                                                                                                                                                                                   |
| `ubi me`                                 | validated live                          | Command returned a live account identity (`source: live`) from `GET /v3/users/{userId}`.[6]                                                                                                                                      | `node dist/index.js me` or `node dist/index.js me --json`                                       | Personally identifying fields are omitted from this document but were returned by the command during validation.                                                                                                                                       |
| `ubi list`                               | validated live                          | Live GraphQL library query returned 27 raw titles for the validated account; the default deduped summary view collapsed that to 23 rows with 4 multi-variant groups.[6][9][19]                                                   | `node dist/index.js list`, `node dist/index.js list --all`, or `node dist/index.js list --json` | 12 of 23 deduped rows mapped to known public product IDs after title-based metadata propagation; the rest remained `productId=unknown`, which reflects gaps in the public mapping dataset rather than command failure.[14][15][19]                     |
| `ubi search "Far Cry 3"`                 | validated live / public dataset mix     | Returned multiple public catalog candidates, including product IDs 46 and 101, which makes the plain title query intentionally ambiguous.[12][15][19]                                                                            | `node dist/index.js search "Far Cry 3" --json`                                                  | This command exists to disambiguate public title matches before running `ubi info <productId>` or `ubi addons <productId>`.                                                                                                                            |
| `ubi info 720`                           | validated live / public dataset mix     | Returned `Assassin's Creed® Unity` with `sources.library=true` and `sources.publicCatalog=true`.                                                                                                                                 | `node dist/index.js info 720 --json`                                                            | Uses live library resolution plus public catalog/config data.[14][15]                                                                                                                                                                                  |
| `ubi info 46`                            | validated with public dataset           | Returned public metadata for product 46 (`Far Cry® 3`) including one known manifest hash and parsed config summary.                                                                                                              | `node dist/index.js info 46 --json`                                                             | Does not require ownership when resolving by public product ID.                                                                                                                                                                                        |
| `ubi manifest 720`                       | validated with public fixture           | Returned `status: parsed-public-fixture` and parsed manifest summary (`chunkCount: 39`, `fileCount: 482`) using a public raw fixture from `UplayManifests`.[11][17]                                                              | `node dist/index.js manifest 720 --json`                                                        | Resolution used a live owned title, but manifest bytes came from the public GitHub fixture rather than a live Ubisoft download-service session.                                                                                                        |
| `ubi manifest 46`                        | validated with public fixture           | Returned `status: parsed-public-fixture` for product 46 and parsed a public raw fixture with manifest version 3, `fileCount: 271`, and install/download byte totals.[11][17][19]                                                 | `node dist/index.js manifest 46 --json`                                                         | Demonstrates reproducible manifest parsing even without ownership.                                                                                                                                                                                     |
| `ubi files 46`                           | validated with public fixture           | Returned the largest manifest file entries for product 46, headed by `data_win32/worlds/fc3_main/fc3_main.dat`.[17][19]                                                                                                          | `node dist/index.js files 46 --limit 3`                                                         | Uses the selected public raw manifest fixture, not live download-service URLs.                                                                                                                                                                         |
| `ubi download-plan 46`                   | validated with public fixture           | Returned a dry-run plan for product 46 with `installBytes: 11633969174`, `downloadBytes: 9704042273`, and the top 10 largest files.[5][17][19]                                                                                   | `node dist/index.js download-plan 46`                                                           | This is an inspection/planning feature only; it does not fetch Ubisoft CDN chunks.                                                                                                                                                                     |
| `ubi addons 720`                         | validated with public association graph | Returned 20 associated products for product 720, starting with product IDs 1018-1020 and Unity add-on titles from the public catalog datasets.[12][15][19]                                                                       | `node dist/index.js addons 720 --json`                                                          | Association graph data is useful for DLC exploration, but it is not proof of ownership for the authenticated account.                                                                                                                                  |
| Manifest parser fixture test             | validated with fixture                  | `tests/manifest-parser.test.ts` and `tests/manifest-summary.test.ts` parsed committed public raw fixtures and asserted version/compression/chunk/file/size details.[3][17][18][19]                                               | `npm test -- --run tests/manifest-parser.test.ts`                                               | Stable regression coverage for manifest parsing and size planning helpers.                                                                                                                                                                             |
| Auth/session logic tests                 | validated with tests                    | `tests/auth-service.test.ts` covers challenge retry, 2FA response handling, and remember-me refresh.                                                                                                                             | `npm test -- --run tests/auth-service.test.ts`                                                  | Uses mocked HTTP responses, not live Ubisoft sessions.                                                                                                                                                                                                 |
| Demux transport/auth handshake           | validated in repo experiment            | Live `getPatchInfoReq` succeeded, the server reported `latestVersion: 13099`, and auth succeeded after pushing that version as `clientVersion` over a TLS 1.2 Demux socket.[19][20]                                              | See Demux validation commands below.                                                            | The key finding is that the current service expects patch/version negotiation before auth; the stale default Node package client version times out.                                                                                                    |
| Demux ownership enumeration              | validated in repo experiment            | After the negotiated handshake, live `ownership_service.initializeReq` succeeded and returned 379 owned-game rows for the validated account.[4][19][20]                                                                          | See Demux validation commands below.                                                            | This capability is validated manually in repo experiments, but not yet fully exposed as a polished CLI command at this commit point.                                                                                                                   |
| Live download-service manifest retrieval | validated in repo experiment            | For a Demux-owned product with a live manifest, the repo successfully requested an ownership token, initialized `download_service`, and received signed CDN URLs for `.manifest`, `.metadata`, and `.licenses` assets.[4][5][19] | See Demux validation commands below.                                                            | Product-ID reconciliation between GraphQL/public catalog and Demux remains an implementation problem, but the live Demux download path itself works.                                                                                                   |

## Commands run during validation

### Tooling and tests

```bash
npm run ci
npm run build
```

Outcome:

- `format:check`, `lint`, `typecheck`, and all tests passed.
- Current automated test count: 20 tests across 12 test files.

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

### Manifest inspection and download planning

```bash
node dist/index.js manifest 720 --json
node dist/index.js manifest 46 --json
node dist/index.js files 46 --limit 3
node dist/index.js download-plan 46
```

Outcome:

- both `manifest` commands returned `status: parsed-public-fixture`
- product `720`: parsed summary included `chunkCount: 39`, `fileCount: 482`
- product `46`: parsed summary included manifest `version: 3`, `fileCount: 271`, `installBytes: 11633969174`, and `downloadBytes: 9704042273`
- `files 46 --limit 3` surfaced the largest files in the fixture, led by `data_win32/worlds/fc3_main/fc3_main.dat`
- `download-plan 46` returned the same byte totals plus the top 10 largest files for dry-run planning

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
- `urlReq` returned signed CDN URLs for `.manifest`, `.metadata`, and `.licenses`

Interpretation:

- **Confirmed from source:** the Demux handshake includes patch/version and auth primitives, and ownership/download-service request shapes match the reverse-engineered clients.[1][4][5][20]
- **Experimentally observed in this repo:** the current Node package defaults need patch/version negotiation and TLS 1.2 to work reliably against the current live Demux service.[19]
- **Remaining implementation issue:** GraphQL/public-catalog product IDs do not always align 1:1 with Demux ownership product IDs, so reconciliation remains the main blocker to replacing the current GraphQL-first CLI paths.[4][14][19]

## Known limitations

1. The CLI still relies primarily on the public GraphQL library endpoint for `ubi list`; the newly validated Demux path has not yet been fully wired into the command surface.[6][9][19]
2. Product-ID mapping is only as complete as the public `UplayManifests` datasets, and those public IDs do not always align 1:1 with Demux ownership product IDs.[4][14][19]
3. `ubi manifest`, `ubi files`, and `ubi download-plan` currently parse public raw fixtures when available instead of fetching live `.manifest/.metadata/.licenses` files from Ubisoft's download service.[5][11][17]
4. `ubi addons` currently exposes public associated products from the catalog graph; it does not prove add-on ownership for the authenticated account without Demux-backed ownership reconciliation.[4][12]
5. A local `.env` file is supported for operator convenience, but blank override variables can interfere with runtime defaults if not normalized; this repo now trims blank values before applying overrides.

## Validation interpretation

This repo currently demonstrates a **usable MVP** for:

- session login/logout
- account identity lookup
- live library listing via GraphQL with deduped summary output and search
- source-backed product metadata lookup and public catalog disambiguation
- public association-graph exploration for DLC-like products
- reproducible manifest inspection, file listing, and dry-run download planning via public fixtures
- validated Demux transport/auth, ownership initialization, ownership-token retrieval, and download-service URL retrieval in repo-local experiments

It does **not** yet expose full live Demux ownership/download-service integration as polished CLI features, and the remaining blocker is product reconciliation plus implementation work rather than basic connectivity.

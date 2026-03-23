# Architecture

## Stack choice

This MVP uses **TypeScript on Node.js LTS** with a thin CLI layer and explicit service boundaries.

### Rationale

- Public reverse-engineered Ubisoft resources already exist in Node/TypeScript form (`ubisoft-demux-node`), which reduces time-to-validation for Demux and manifest parsing.[1][2][3]
- The problem naturally splits into HTTP auth/session work and Demux socket/protobuf work, so strong TypeScript typing is useful to keep those boundaries explicit.[1][2][4][5]
- Community product/manifest datasets are JSON and YAML-like text, which are easy to consume from Node.[11][12][13][14][15]

## Module boundaries

### `src/cli/`

Thin commander-based command definitions.

Responsibilities:

- parse flags and arguments
- select output mode (human vs JSON)
- map errors to exit codes
- keep business logic out of command handlers

### `src/core/`

Cross-cutting runtime and protocol primitives.

Planned modules:

- `config.ts`: resolve config/cache paths
- `session-store.ts`: read/write/redact session state
- `http.ts`: HTTP client, retries, timeouts, JSON helpers
- `auth-service.ts`: login, refresh, logout, me
- `demux-client.ts`: authenticated Demux interactions

Rationale: public sources show that HTTP sessions and Demux tickets are related but distinct concerns, so the MVP keeps them in separate core components.[1][2][4][9]

### `src/services/`

Use-case-oriented workflows on top of the core layer.

Planned modules:

- `library-service.ts`: owned titles via Demux first, GraphQL fallback second.[4][6][9]
- `product-service.ts`: resolve a product by ID/name and hydrate metadata from live or public sources.[4][14][15]
- `manifest-service.ts`: fetch/parse manifests live when possible; otherwise inspect public fixture/public manifest metadata.[3][5][13][17][18]
- `public-catalog-service.ts`: fetch/cache `UplayManifests` datasets.[11][12][13][14][15]

### `src/models/`

Normalized domain types independent of raw upstream payloads.

Planned types:

- `Session`
- `AccountIdentity`
- `LibraryItem`
- `ProductInfo`
- `ManifestInfo`
- `ValidationStatus`

Rationale: raw reverse-engineered payloads are unstable, so commands should speak in stable internal models.[1][4][6]

### `src/util/`

Helpers that do not belong to transport or domain logic.

Planned modules:

- `logger.ts`
- `redaction.ts`
- `output.ts`
- `errors.ts`
- `yaml.ts`
- `matching.ts`

## Data flow

### Login flow

1. CLI collects credentials or uses environment/config input.
2. `AuthService` creates a session through `POST /v3/profiles/sessions`.[2]
3. On success, `SessionStore` persists the session ticket, session ID, expiry, remember-me ticket, and user ID.[2][9]
4. Later commands call `ensureValidSession()`, which tries `PUT /v3/profiles/sessions` refresh first and remember-me refresh second.[9]

### `ubi me`

1. Load/refresh session.
2. Request `GET /v3/users/{userId}` when possible.[6]
3. Normalize the result into `AccountIdentity`.
4. Output JSON or human text.

### `ubi list`

1. Load/refresh session.
2. Try Demux authenticate + ownership-service initialize.[1][4]
3. If that succeeds, normalize `OwnedGame` entries into `LibraryItem` records.
4. If Demux fails, try GraphQL `viewer.games` as an explicitly weaker fallback.[6][9]

### `ubi info <title-or-id>`

Resolution order:

1. library cache/live library lookup if authenticated
2. numeric product ID lookup in public datasets
3. optional fuzzy name resolution among authenticated library items

Hydration order:

1. live `OwnedGame.configuration` / live product-config request if available.[4]
2. public `productservice.json` + `productconfig.json` fallback.[14][15]

### `ubi manifest <title-or-id>`

Preferred path:

1. resolve product ID and manifest hash from live ownership data.[4]
2. request an ownership token.[4]
3. initialize download service and request manifest/metadata/license URLs.[5]
4. download payloads and parse them with the documented parser format.[3]

Fallback path:

1. resolve known manifest hashes from `manifestlist.json`.[13]
2. if a public raw fixture exists, parse it locally for fixture-based validation.[17][18]
3. otherwise report that only manifest-hash inspection is currently available.

## Error handling model

The repo uses typed, user-facing error classes.

### Error categories

- `ConfigError`: broken config/session files
- `AuthError`: login, refresh, 2FA, or missing-session issues
- `TransportError`: HTTP timeout/network failure/Demux timeout
- `ProtocolError`: unexpected upstream response shape
- `ResolutionError`: product/title could not be matched
- `ValidationError`: command completed partially but cannot claim full success

### Policy

- Human output goes to stdout; logs and diagnostics go to stderr.
- Sensitive fields (`ticket`, `rememberMeTicket`, `sessionId`, passwords, raw auth headers) are always redacted.
- Commands return partial data only when clearly labeled as partial.
- Demux timeouts are translated into actionable guidance because public Demux references explicitly note that protocol mistakes often surface as timeouts rather than structured errors.[1]

## Storage model

### Config directory

Default path: platform-specific user config directory via `env-paths`, under `ubi-cli-mvp/`.

Files:

- `config.json`: non-secret settings such as app IDs, verbosity defaults, and cache settings
- `session.json`: persisted session metadata and tickets (redacted in logs)
- `cache/*.json`: cached public dataset snapshots from `UplayManifests`
- `debug/*`: optional raw response dumps when verbose/debug flags are enabled

### Security stance

Public sources show workable remember-me and refresh flows, but not a simple cross-platform keychain strategy for this specific MVP.[2][9] Therefore:

- the initial implementation stores sessions locally in the config directory;
- the README and validation docs explicitly warn about local ticket storage; and
- future keychain integration is deferred unless it can be added without destabilizing the MVP.

## Why this architecture fits the milestone plan

- **Milestone 0:** docs already map cleanly to module boundaries.
- **Milestone 1:** config, logger, doctor, and CLI can be built independently of Ubisoft auth.
- **Milestone 2:** auth/session lives entirely in `src/core/` with isolated tests.[2][9]
- **Milestone 3:** library enumeration can compare Demux and GraphQL without changing CLI surface area.[4][6][9]
- **Milestone 4:** manifest parsing can be validated first with public fixtures, then with live downloads if auth works.[3][5][17][18]
- **Milestone 5:** validation docs can state per-capability evidence because each service has a narrow source-backed responsibility.

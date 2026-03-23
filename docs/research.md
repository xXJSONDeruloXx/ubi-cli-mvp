# Research

## Scope and method

This MVP targets the smallest publicly supportable subset of a “Legendary for Ubisoft Connect”: authenticate, identify the account, enumerate owned titles if possible, inspect title metadata, and inspect manifest/build metadata if possible. All protocol decisions below are grounded in public reverse-engineering references and are labeled as **confirmed from source**, **inferred from source**, or **to be experimentally validated in this repo**. See `docs/references.md` for full citations.

## Confirmed from source

### 1. Ubisoft Connect uses two important back ends for launcher work

**Confirmed from source:** community reverse-engineering points to a split between a public HTTP API (`public-ubiservices.ubi.com`) and a socket/protobuf “Demux” API used by the launcher for core workflows.[1]

Practical implication for this repo:
- the MVP should keep HTTP session management separate from Demux transport; and
- account/library/manifest features may need to mix both transports depending on what is available.[1]

### 2. Direct HTTP session creation is publicly documented by reverse-engineered clients

**Confirmed from source:** one public TypeScript client creates sessions by `POST`ing to `https://public-ubiservices.ubi.com/v3/profiles/sessions` with:
- `Authorization: Basic <base64(email:password)>`
- `Ubi-AppId: <app id>`
- `Ubi-RequestedPlatformType: uplay`
- JSON body `{ "rememberMe": true }`.[2]

The same source also shows:
- 2FA completion via `Authorization: ubi_2fa_v1 t=<twoFactorAuthenticationTicket>` and a `Ubi-2faCode` header; and
- remember-me login via `Authorization: rm_v1 t=<rememberMeTicket>`.[2]

**Confirmed from source:** Lutris additionally refreshes an existing session with `PUT /v3/profiles/sessions` using `Authorization: Ubi_v1 t=<ticket>` and falls back to remember-me refresh if needed.[9]

### 3. Multiple public app IDs/genome IDs are used by existing community clients

**Confirmed from source:** public reverse-engineered clients use more than one Ubisoft web app ID/genome ID pair, including:
- `314d4fef-e568-454a-ae06-43e3bece12a6` / `85c31714-0941-4876-a18d-2c7e9dce8d40` in `ubi-cli`.[7]
- `82b650c0-6cb3-40c0-9f41-25a53b62b206` / `42d07c95-9914-4450-8b38-267c4e462b21` in Lutris.[10]
- `f68a4bb5-608a-4ff2-8123-be8ef797e0a6` in `ubisoft-demux-node`’s HTTP helper.[2]

**Inferred from source:** app IDs appear to be client/application identifiers rather than user secrets, so the MVP should make them configurable and document the default chosen for each flow.[2][7][10]

### 4. Demux authentication and ownership enumeration are publicly described

**Confirmed from source:** Demux authentication can be done with a `ubiTicket` token after obtaining an HTTP session ticket.[1]

**Confirmed from source:** a public C# implementation initializes the `ownership_service` with:
- `InitializeReq { getAssociations = true, protoVersion = 7, useStaging = false }`
- `UbiSessionId = <sessionId>`
- `UbiTicket = <ticket>`
and treats the response as the owned-games list.[4]

**Confirmed from source:** the generated ownership model in `ubisoft-demux-node` includes fields useful for an MVP, such as:
- `productId`
- `latestManifest`
- `gameCode`
- `ubiservicesSpaceId`
- `ubiservicesAppId`
- `configuration`
- product-type/state/branch data.[1][4]

### 5. Public HTTP account/library endpoints exist too

**Confirmed from source:** one public Rust client calls `GET https://public-ubiservices.ubi.com/v3/users/{userId}` for account identity.[6]

**Confirmed from source:** the same client queries `POST https://public-ubiservices.ubi.com/v1/profiles/me/uplay/graphql` and reads `viewer.games.nodes` to list owned/visible games.[6]

**Confirmed from source:** Lutris uses the same GraphQL endpoint with a richer owned-games query including `spaceId`, `name`, and image URLs.[9]

**Inferred from source:** GraphQL is a good fallback library path if Demux ownership initialization fails, but Demux remains better for product IDs and manifest IDs.[4][6][9]

### 6. Manifest retrieval is publicly documented at the request-shape level

**Confirmed from source:** a public Demux download-service client initializes with an `ownershipToken` and then requests URLs for relative paths shaped like `manifests/<manifest>.manifest`, `manifests/<manifest>.metadata`, and `manifests/<manifest>.licenses`.[5]

**Confirmed from source:** the ownership service also exposes an `OwnershipTokenReq` and `GetProductConfigReq`, which are sufficient building blocks for live manifest inspection when authentication is working.[4]

### 7. Local and downloaded Ubisoft manifest formats are publicly parsed

**Confirmed from source:** public parser code trims a 356-byte header and inflates the remaining bytes with zlib before decoding `.manifest`, `.metadata`, and `.licenses` protobuf payloads.[3]

**Confirmed from source:** the same parser documents offsets for other relevant cache files (`user.dat`, ownership cache, download cache, install state), which is useful for fixtures and future offline import flows.[3]

### 8. There is a public community dataset for product/manifests/configuration

**Confirmed from source:** the `UplayManifests` repository explicitly describes itself as a community-maintained collection of Ubisoft manifests and related product data.[11]

**Confirmed from source:** its published JSON files provide:
- `gamelist.json`: product IDs and product types.[12]
- `manifestlist.json`: product ID to manifest-hash mappings.[13]
- `productservice.json`: product ID to `SpaceId`/`AppId` mappings.[14]
- `productconfig.json`: product ID to launcher configuration blobs.[15]

**Confirmed from source:** the repo also publishes raw `.manifest` fixtures and human-readable `.txt` renderings that are suitable for parser tests in this project.[17][18]

## Less-certain but useful source notes

### 9. Direct login may now involve a `Ubi-Challenge` retry

**Confirmed from source (single newer client, not yet validated here):** `unifideck` reports that direct email/password login may first return a `Ubi-Challenge` response header and require retrying the same request with a `Ubi-Challenge` request header before a ticket or 2FA challenge is returned.[16]

**Planned handling:** implement this path as an optional compatibility branch, but mark it experimental until validated in this repo.[16]

### 10. GraphQL pagination may be necessary

**Confirmed from source (single newer client, not yet validated here):** `unifideck` paginates `viewer.games(limit, offset)` and notes that larger page sizes may be rejected.[16]

**Planned handling:** the MVP should tolerate pagination if the endpoint exposes `totalCount`, but avoid claiming a hard server limit until validated locally.[16]

## Proposed implementation path

### Auth/session

1. Implement primary login via `POST /v3/profiles/sessions` with interactive email/password input and optional 2FA prompt.[2]
2. Store the resulting session ticket, session ID, expiration, remember-me ticket, and user ID in the local config directory with clear warnings.[2][9]
3. Before authenticated commands, try `PUT /v3/profiles/sessions` refresh, then fall back to remember-me refresh.[9]

### Identity

Use `GET /v3/users/{userId}` for `ubi me`, falling back to stored session fields if the endpoint is unavailable.[6]

### Library

1. Prefer Demux `ownership_service.initialize` for `ubi list`, because it exposes product IDs plus manifest/config data.[4]
2. Fall back to GraphQL `viewer.games` if Demux cannot be validated against the current Ubisoft back end.[6][9]

### Title metadata

1. Prefer live `OwnedGame.configuration` or `GetProductConfigReq` when the user is authenticated.[4]
2. Fall back to `UplayManifests` product datasets for public metadata lookup by product ID.[11][14][15]

### Manifest/build metadata

1. Prefer live Demux ownership-token + download-service URL retrieval, then parse `.manifest` / `.metadata` / `.licenses` using the public parser format.[3][4][5]
2. If live retrieval is blocked, still support manifest-hash inspection and fixture parsing using public `UplayManifests` samples.[11][13][17][18]

## Main risks

1. **Auth drift:** Ubisoft may now require additional anti-automation headers/challenges beyond the older direct-login flow.[2][16]
2. **2FA and CAPTCHA:** even with public session endpoints, some accounts may require interactive steps that this MVP cannot fully automate.[2][8]
3. **Demux drift:** request shapes come from reverse-engineered clients, and timeouts are a known failure mode when requests are slightly wrong.[1]
4. **GraphQL schema drift:** public clients already disagree somewhat about query shape and pagination semantics, so fallback code must be defensive.[6][9][16]
5. **Manifest access scope:** live manifest URLs may require ownership tokens and therefore only work for authenticated, owned products.[4][5]

## Open questions for validation

1. Which public app ID works most reliably for direct CLI login in March 2026?[2][7][10]
2. Does the current login flow require `Ubi-Challenge` for this account/environment?[16]
3. Does Demux ownership initialization still succeed with the public request shape from [4]?
4. Can live download-service URL retrieval still fetch `.manifest`, `.metadata`, and `.licenses` for owned products?[5]
5. For commands that accept `<title-or-id>`, how much name-based resolution is realistically supportable without authenticated library data?[6][15]

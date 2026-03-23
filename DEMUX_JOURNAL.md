# Demux Journal

## 2026-03-23

### Initial breakthrough

Findings from live Demux experiments in this repo:

- `dmx.upc.ubisoft.com:443` is reachable when the client speaks **TLS 1.2**.
- The public Node package's default hard-coded Demux client version (`10931`) is stale for the current service behavior.
- A working handshake sequence is:
  1. connect with TLS 1.2
  2. `getPatchInfoReq`
  3. push `clientVersion = latestVersion`
  4. `authenticateReq { clientId: "uplay_pc", token.ubiTicket }`
  5. open `ownership_service`
  6. `initializeReq { getAssociations: true, protoVersion: 7, useStaging: false, ubiTicket, ubiSessionId }`
- With that sequence, the repo successfully validated:
  - Demux patch/version negotiation
  - Demux authentication
  - ownership-service initialization
  - live ownership enumeration
  - ownership-token requests
  - download-service initialization
  - signed URL retrieval for live manifest assets

### Important nuance

Demux works, but product reconciliation is still messy:

- GraphQL/public-catalog product IDs do not always line up 1:1 with Demux ownership product IDs.
- `SpaceId` and `AppId` are better reconciliation keys than title alone.
- Some owned/installable Demux entries expose a `latestManifest`; many entitlement-style rows do not.

### Next implementation targets

1. build a first-class Demux client wrapper in `src/core/`
2. normalize Demux owned-game data into repo models
3. expose Demux-backed list/info/manifest/download-url flows in the CLI
4. add test coverage for handshake sequencing and normalization
5. document every validated capability and every remaining blocker honestly

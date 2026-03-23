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

### Implementation progress

Completed after the breakthrough:

1. built a first-class Demux client wrapper in `src/core/demux-client.ts`
2. normalized Demux owned-game data into repo models and a `DemuxService`
3. exposed Demux-backed CLI commands:
   - `ubi demux-list`
   - `ubi demux-info <query>`
   - `ubi download-urls <query>`
   - `ubi manifest <query> --live`
   - `ubi files <query> --live`
   - `ubi download-plan <query> --live`
4. added test coverage for:
   - handshake sequencing
   - ownership/download-service flows
   - Demux normalization/reconciliation
   - live-manifest service plumbing

### Current blocker frontier

The main remaining blocker is no longer basic Demux connectivity.

It is now the gap between **manifest/URL retrieval** and a full **chunk downloader / installer**:

- some titles do not expose a useful `latestManifest`
- public/catalog product IDs do not always align 1:1 with Demux ownership IDs
- the CLI does not yet reconstruct slice/chunk payloads into installed game files
- update/resume/install-state orchestration is still unimplemented

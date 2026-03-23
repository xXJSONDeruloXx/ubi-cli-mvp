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
   - `ubi slice-urls <query>`
   - `ubi download-slices <query>`
4. added test coverage for:
   - handshake sequencing
   - ownership/download-service flows
   - Demux normalization/reconciliation
   - live-manifest service plumbing
   - slice path derivation and raw-slice download plumbing

### Additional live finding

- The Demux `download_service.urlReq` response can bundle signed `.manifest`, `.metadata`, and `.licenses` URLs as alternate URLs under a single manifest-path response row rather than always returning three distinct response rows.
- After extracting those alternates explicitly, the repo successfully fetched and parsed live `.metadata` and `.licenses` assets for owned product `3539` (`Assassin's Creed® Origins`).
- Live parsed asset summary for `3539`:
  - metadata `bytesOnDisk: 79647476759`
  - metadata `bytesToDownload: 69428160597`
  - metadata `chunkCount: 58`
  - licenses `licenseCount: 1`
  - licenses identifier: `denuvo_eula`

### Additional file-reconstruction finding

- Downloaded slice blobs appear to be individually compressed payloads; a sampled Origins slice began with the zstd magic bytes `28 B5 2F FD` and decompressed successfully with Node's built-in zstd support.
- The repo now experimentally reconstructs individual files by:
  1. reading one file's `sliceList` from the live manifest,
  2. downloading those slices,
  3. decompressing zstd slice bodies,
  4. writing them at the manifest-declared file offsets.
- This worked live for at least one owned Origins file:
  - `Support\Readme\English\Readme.txt`
  - output size `15538`
  - reconstructed content began with `Ubisoft Entertainment / Assassin's Creed® Origins v1.6.1`
- A later follow-up found that the apparent “missing slice URL” issue was partly a client-mapping bug:
  - `download_service.urlReq` may return **one response row** whose URL list contains many requested slice paths.
  - the client now groups those URLs by parsing the returned CDN pathnames instead of assuming one response row per requested relative path.
- With that fix, the repo can now fetch all requested URLs for at least some multi-slice files too.
- A later follow-up found that many parsed `sliceList[].fileOffset` values come through as protobuf default zeroes even when the manifest JSON rendering omits the field; treating an all-zero multi-slice list as **implicit sequential offsets** fixed a real live extraction issue.
- The service also now validates each decompressed slice body against the manifest file's `slices[]` SHA-1 values when available.
- With those two fixes, live extraction of `d3dcompiler_47.dll` for owned product `3539` now succeeds too:
  - output size `4488896`
  - file magic `MZ`
  - `file` identified it as `PE32+ executable (DLL) (console) x86-64`
- Whole-build reconstruction is still unreliable though: this is now stronger evidence that some individual multi-slice files can be rebuilt correctly, but the repo still does not implement full installer/update orchestration.

### Current blocker frontier

The main remaining blocker is no longer basic Demux connectivity.

It is now the gap between **manifest/URL retrieval** and a full **chunk downloader / installer**:

- some titles do not expose a useful `latestManifest`
- public/catalog product IDs do not always align 1:1 with Demux ownership IDs
- the CLI does not yet reconstruct slice/chunk payloads into installed game files
- update/resume/install-state orchestration is still unimplemented

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
- The repo now also supports experimental **batch** extraction for multiple matching files from one live manifest query:
  - `extract-files <query> <pathFilter> [--prefix]`
  - it resolves slice URLs once for the matched set and reuses already-downloaded slice payloads across files when possible.
- To make that workflow easier, the CLI now also supports normalized manifest-path filtering in both `files` and `download-plan`:
  - `files <query> --live --match <pathFilter> [--prefix]`
  - `download-plan <query> [--live] --match <pathFilter> [--prefix]`
  - slash style and casing are normalized so Windows-style manifest paths can be queried with either `\\` or `/` separators.
- Live validation on Origins with `extract-files 3539 'Support\\Readme' --prefix --limit 3` reconstructed three readme files into one output tree with:
  - `matchedCount: 15`
  - `extractedCount: 3`
  - `sliceReferenceCount: 3`
  - `uniqueSliceCount: 3`
  - `bytesDownloaded: 14081`
  - `bytesWritten: 51942`
- That specific live sample did not demonstrate cross-file slice reuse, but the batch path itself now works live and reuse is covered by unit tests.
- The repo now also persists downloaded raw slice payloads under the local cache directory and reuses them across later extraction/download commands when the same slice hash is requested again.
- Live validation on Origins showed the same `extract-file 3539 'Support\\Readme\\English\\Readme.txt'` command dropping from `bytesDownloaded: 4532` on first run to `bytesDownloaded: 0` on second run, with transfer stats reporting `diskCacheHits=1`.
- A later Splinter Cell full-tree reconstruction attempt surfaced two more important findings:
  - some older manifests use **zlib-framed** slice payloads rather than zstd; adding inflate support fixed at least one live Splinter Cell file that initially failed strict size validation
  - a long-running `download-game 109` attempt later hit signed slice URL `403` failures, which showed that real full-game downloads need signed-URL refresh / resume orchestration instead of one long uninterrupted pass
- After adding signed-URL refresh, skip-existing resume behavior, longer slice fetch timeouts, and a pre-scan that avoids resolving slice URLs for already-complete files, a later resumed `download-game 109 --workers 4 --output-dir /tmp/splinter-cell-download` run completed the full manifest tree too.
- An additional rerun over the now-complete tree reported:
  - `matchedCount: 5320`
  - `extractedCount: 5320`
  - `sliceReferenceCount: 0`
  - `uniqueSliceCount: 0`
  - `bytesDownloaded: 0`
  - `skippedExistingFiles: 5320`
- That means repeat whole-tree validation is now dramatically cheaper once the local output tree is already present.
- The repeated Demux listener warning also appears to have a concrete cause and mitigation now:
  - the upstream `ubisoft-demux` package adds a `connectionData` listener each time `openConnection(...)` is called
  - `DemuxClient` now reuses a single `download_service` connection instead of opening a new one for every URL lookup
  - live validation with `slice-urls 109 --limit 5844` completed with empty stderr, which strongly suggests the earlier `MaxListenersExceededWarning` came from repeated download-service connection creation
- Whole-build reconstruction is still somewhat rough around the edges though: the repo can now reconstruct at least one full older game tree over multiple runs, but it still does not implement a hardened launcher-grade install/update engine.

### Current blocker frontier

The main remaining blocker is no longer basic Demux connectivity.

It is now the gap between **manifest/URL retrieval** and a full **chunk downloader / installer**:

- some titles do not expose a useful `latestManifest`
- public/catalog product IDs do not always align 1:1 with Demux ownership IDs
- the CLI does not yet reconstruct slice/chunk payloads into installed game files
- update/resume/install-state orchestration is still unimplemented

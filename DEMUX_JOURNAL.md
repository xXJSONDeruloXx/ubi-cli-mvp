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
- The repeated Demux listener warning had a concrete cause and mitigation:
  - the upstream `ubisoft-demux` package adds a `connectionData` listener each time `openConnection(...)` is called
  - `DemuxClient` now reuses a single `download_service` connection and one ownership token per product instead of repeating initialization for every URL lookup
  - live validation with `slice-urls 109 --limit 5844` completed with empty stderr, confirming the earlier `MaxListenersExceededWarning` came from repeated connection creation
- A larger bottleneck was the inherited 32-prefix slice URL strategy. The CDN prefix is deterministic from `fileHashToPathChar`, so probing 32 candidate paths per hash caused unnecessary control traffic and cascaded 404s:
  - old strategy: 16 slices / 9.62 MB took 113.6s and encountered 227 failed CDN attempts
  - deterministic strategy: the same payload took 0.94s at 9.75 MiB/s with 16/16 successes; a separate 64-slice HEAD sample succeeded 64/64
  - the full Splinter Cell manifest dropped from 187,008 candidate paths to 5,844 deterministic paths and resolved all URLs in 31.5s
- After that optimization, a resumed full reconstruction completed all 5,320 files / 2,545,474,351 bytes in 349s (5m49s), transferring 2,072,729,411 new bytes with 5,706 network fetches, 36 in-process reuse hits, 134 verified existing files, and zero URL refreshes. The pre-optimization baseline had reached only 138 files / 16.5 MB in 31m32s.
- A second full pass SHA-256-verified all 5,320 outputs in 14s with zero required slices and zero downloaded bytes.
- Whole-build reconstruction is still title/build dependent and does not implement a launcher-grade install/update engine.

### Current blocker frontier

The main remaining blocker is no longer basic Demux connectivity or practical throughput for the validated title.

It is now the gap between **manifest-tree reconstruction** and a registered, client-integrated install:

- some titles do not expose a useful `latestManifest`
- public/catalog product IDs do not always align 1:1 with Demux ownership IDs
- reconstruction works for selected files and at least one complete owned manifest, but remains title/build dependent
- launcher-grade update, repair, install registration, and Ubisoft Connect integration are still unimplemented
- the Ubisoft Splinter Cell build includes Uplay API loaders; direct Wine correctly failed without a client, while an official Connect install accepted the game API connection but still required interactive desktop-client authentication/entitlement handling
- the CLI must not fabricate registration, replace Uplay DLLs, or repurpose its authenticated web session to bypass that user/client boundary

### 2026-07-11 downloader hardening

- `download-game` now defaults to a bounded 10-file / 1-GiB selection and exposes `--dry-run`; full-tree work requires explicit `--all --yes`.
- Manifest-controlled paths are contained below the requested output root, reject symlink traversal, and publish only after a synced temporary file is atomically renamed.
- Resume state is bound to the product, manifest hash/body, and output root; it rehashes completed files with SHA-256 instead of trusting size alone.
- A bounded live Origins tree download and SHA-256-verified zero-network resume succeeded.
- Deterministic slice paths and reused Demux initialization reduced complete Splinter Cell reconstruction to 5m49s; a subsequent all-file SHA-256 verification completed in 14s with zero network transfer.
- `run` now starts from the executable directory. Legitimate Wine validation reached the expected Uplay requirement; the official Ubisoft Connect client installed, started, and accepted the game's API connection, leaving interactive client authentication/entitlement as the user boundary.

### 2026-07-12 guided Ubisoft Connect handoff

- `run` accepts an explicit `--wine-prefix`, repeatable pre-executable `--runner-arg` values, and `--connect` to start the official client before the game.
- `--ensure-connect --yes` can install a pinned Ubisoft CDN build when the explicit prefix has no client. Downloads are HTTPS-host/path constrained, streamed to a mode-0600 temporary file, SHA-256 pinned, checked for a PE Authenticode certificate table, synced, and atomically cached before execution. A caller can supply the same pinned installer with `--connect-installer`.
- The CLI deliberately does not accept desktop credentials or inject its existing web session. Interactive mode waits while the user completes the official client's authentication and MFA; noninteractive mode stops before game launch unless `--connect-ready` explicitly confirms those steps are complete.
- Clean-cache reconstruction then completed all 5,320 Splinter Cell files / 2,545,474,351 bytes in 175s using 5,844 network fetches, with zero cache hits or URL refreshes. A second full pass SHA-256-verified the tree in 10s with zero network transfer.
- Fresh-prefix testing showed that raw executable launch identifies the entitlement but does not register an external reconstructed tree. Connect still offers Download, and this legacy build did not expose a useful **Locate installed game** route.
- `connect-seed` now bridges that gap without fabricating client state. The operator starts Connect's official Download once, pauses after transfer begins, and fully exits. The command reads the product registration/state created by Connect, refuses to run while `upc.exe` is active, requires `--dry-run`/`--yes`, rejects unsafe paths/symlinks, SHA-256-compares source and staging, and atomically replaces only mismatched staged payloads.
- Live product-109 seeding found 3,083 existing matches and copied 2,237 files / 2,519,583,113 bytes in 22s. A second dry run matched all 5,320 files. Connect Resume then finalized immediately, wrote its own install manifest/state, removed staging, and exposed Play; all 5,320 finalized payload hashes matched the CLI source.
- Both the Play button and Connect's registered `uplay://launch/109/0` handler successfully launched the game from the official install directory. The URI path eliminates subsequent Play-button interaction while preserving Connect entitlement/DRM handling.
- `connect-seed --finalize` can now restart Connect after seeding and wait for the exact official finalization condition observed live (install manifest published and product staging removed); optional `--launch` then invokes the registered URI. This removes the manual Resume and Play interactions for clients that auto-resume as the validated build did.
- Remaining manual frontier: first official client authentication/MFA and one official Download initiation to create supported registration/staging metadata. `uplay://install/109` was accepted by the protocol handler but did not expose a confirmed noninteractive install action against an already-installed product. Automating credential submission or copying the CLI web session remains intentionally out of scope.
- Authentication persistence experiments established the safest prefix model:
  - one owner-only shared Connect prefix retains the official client's remembered login across launches and can host multiple product registrations
  - a Btrfs reflink clone of the full stopped prefix completed in 637ms and initially opened authenticated, proving Wine DPAPI/device/auth state is self-contained in the prefix
  - launching the clone rotated or invalidated the source prefix's remembered session, so authenticated clones are one-way migrations, not parallel templates; the test clone was stopped and deleted immediately
  - `connect-prefix clone` therefore requires `--include-auth --yes`, refuses existing targets, defaults to reflink-only behavior, and warns that only one authentication lineage may remain active
- `connect-profile` now stores only mode-0600 product/source/prefix paths. A live profile for product 109 reduced launch to `ubi play 109`.
- `play` invokes the official URI, monitors the profiled Wine game process, and stops Connect after game exit. Live validation launched Splinter Cell with no client clicks, detected normal exit, and left zero Wine/Connect processes, removing the post-game promotional-modal friction.

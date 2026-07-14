# Optima comparison

Compared on 2026-07-13:

- `ubi-cli-mvp`: local `main` at `221b5a9`
- [Starkka15/Optima](https://github.com/Starkka15/Optima) at [`026f0ae`](https://github.com/Starkka15/Optima/tree/026f0ae)

This was a static code review plus local build-quality checks. Optima was not run against Ubisoft, no game or shim binary was executed, no credentials were supplied, and the tracked `drm/signing/optima-signing.key` file was not opened. `cargo test --locked` compiled successfully but ran zero tests; `cargo fmt --check` reported formatting differences, and strict Clippy failed on warnings. Findings below describe the reviewed commit and may change upstream.

## Executive conclusion

The projects overlap in authentication, ownership, Demux, manifests, and CDN reconstruction, but they deliberately choose different launch trust boundaries:

```text
Shared data plane:
UbiServices session
  -> Demux ownership
  -> ownership token
  -> download_service signed URLs
  -> manifest/slices
  -> reconstructed Windows game tree

Optima launch plane:
local launch cache
  -> generated Uplay/Orbit profile and asserted ownership
  -> replacement loader DLLs + registry/certificate setup
  -> direct Proton launch without Connect

ubi-cli-mvp launch plane:
official Connect remembered profile
  -> official product registration/staging
  -> guarded payload seed
  -> official verification/finalization
  -> uplay:// launch through UbisoftConnect.exe
```

Optima offers a cleaner launcherless handheld/offline experience for a narrow legacy-game class. `ubi-cli-mvp` is substantially safer, more tested, and broader in principle because official Connect retains registration, entitlement, DRM, overlay, cloud, DLC, and online authority.

Optima does **not** solve first-ever desktop Connect authentication. Its WebAuth result is used for direct UbiServices/Demux access; it never creates or imports `ConnectSecureStorage.dat`, a matching `MachineGuid`, or another state accepted by `UbisoftConnect.exe`. It avoids that boundary by replacing the APIs loaded by selected games.

## Feature comparison

| Area                           | Optima                                                                       | `ubi-cli-mvp`                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Primary goal                   | Headless Connect replacement for Linux/Deck                                  | Hardened Ubisoft CLI/downloader plus official Connect bridge                                    |
| Implementation                 | Compact Rust binary                                                          | Layered TypeScript CLI/services                                                                 |
| CLI authentication             | Direct password API, pasted browser ticket, or local WebAuth page            | Direct session API with challenge replay, MFA, active-ticket refresh, then remember-me fallback |
| Desktop Connect authentication | Not implemented; Connect is avoided                                          | First login/MFA stays in official Connect; remembered state can be checked or migrated one-way  |
| Library                        | Demux-owned base games, numeric IDs                                          | GraphQL and Demux views, title search, public-ID/config reconciliation, add-on graph            |
| Missing-manifest fallback      | Implements `GetLatestManifests`                                              | Currently requires inline `latestManifest`                                                      |
| Slice layouts                  | Modern bucketed `slices_v3` and legacy flat `slices`                         | Deterministic `slices_v3` only                                                                  |
| Compression                    | Zstd, zlib-wrapped deflate, raw deflate fallback                             | Zstd and zlib framing                                                                           |
| Download concurrency           | 16 slices per file; files processed sequentially                             | 1–8 files, shared in-flight slices, persistent slice cache                                      |
| Resume                         | Existing size match                                                          | Manifest/output-bound state plus SHA-256 revalidation                                           |
| Integrity                      | No slice hash/size verification                                              | Decompressed size/SHA-1 checks, bounds, atomic files, final SHA-256 resume verification         |
| Path safety                    | Joins network manifest paths directly                                        | Rejects absolute/traversal paths and symlinked parents                                          |
| Install semantics              | Reconstructs a standalone tree; does not apply full manifest install actions | Reconstructs safely, then lets Connect create/verify/finalize authoritative installation state  |
| Launch                         | Replaces Uplay/Orbit DLLs and fabricates expected local API/config responses | Uses the official registered `uplay://launch/<id>/0` route                                      |
| Legacy fixes                   | Uplay R1, Orbit R2, EAX, umu/Proton tuning, settings-app launch              | General Wine/direct runner plus official Connect; no DRM loader replacement                     |
| Modern DRM/online              | Explicitly out of scope                                                      | Delegated to official Connect/game; still title/Wine dependent                                  |
| Tests                          | Zero tests at reviewed commit                                                | 92 tests across 26 files, plus format/lint/typecheck/build CI                                   |
| Maturity at comparison         | 8 commits over two days, one contributor                                     | 53 commits since March 2026, two contributors                                                   |

## What Optima does better

### 1. Better end-to-end handheld story

Optima's surface is short and product-oriented:

```text
login -> list-games -> install -> launch/settings
```

It is a native Rust binary, integrates with `umu`/Proton, and is designed for a GameVault/Deck UI. For an old single-player game that works with its loaders, this removes the 265-MB Connect client, desktop login window, per-product Connect UI, and runtime launcher overhead.

### 2. Useful protocol compatibility

The following are valuable neutral improvements that `ubi-cli-mvp` should consider implementing independently or porting after provenance review:

- `GetLatestManifests` fallback for owned entries lacking inline `latestManifest`;
- legacy flat `slices/<hash>` layout detection in addition to `slices_v3`;
- raw-deflate fallback;
- bounded per-file slice prefetch;
- byte-based progress for very large files;
- more complete product-config executable/settings-app discovery; and
- neutral `umu`/Proton discovery and compatibility options.

Optima also vendors the immediately relevant protobuf schemas rather than depending on a JavaScript Demux package. A shared, generated protocol library could reduce drift if licensing/provenance is verified.

### 3. Legacy-game compatibility work

Its EAX-to-DirectSound fallback addresses a real missing audio API rather than Ubisoft authentication. Its executable scanning, settings-app path, CPU-topology cap, NvAPI disablement, GPU selection, and working-directory rules contain useful operational knowledge for older Windows games under Proton.

The R1/Orbit loaders provide functionality that the official bridge intentionally does not: launcherless offline startup of selected old titles. That is Optima's unique reason to exist, subject to the security/legal caveats below.

## What `ubi-cli-mvp` does better

### 1. Authentication correctness and storage safety

`ubi-cli-mvp`:

- handles `Ubi-Challenge` replay;
- uses the `ubi_2fa_v1` challenge scheme;
- rejects incomplete sessions;
- computes refresh timing;
- attempts active-ticket `PUT` refresh before remember-me fallback;
- stores state with owner/type/size checks, `O_NOFOLLOW`, mode 0600, atomic rename, and locks; and
- strips all case-insensitive `UBI_*` variables from Wine/runner children.

Optima's browser/WebAuth paths save only a ticket with empty session ID, expiry, and remember-me ticket, so the README's silent remember-me renewal claim does not hold for those paths. Its direct MFA request uses `ubi_v1` with the challenge ticket rather than the observed `ubi_2fa_v1` scheme.

### 2. Downloader correctness and integrity

`ubi-cli-mvp` treats manifest paths and CDN data as untrusted. It provides:

- absolute/traversal/containment rejection;
- parent-symlink checks;
- free-space preflight and cancellation;
- bounded whole-game selection requiring `--all --yes`;
- correct offset placement with bounds checks;
- decompressed slice size/hash checks;
- shared and persistent slice reuse;
- atomic final-file publication; and
- manifest-bound, SHA-256-validated resume.

Optima directly joins manifest names to the output root, trusts same-sized existing files, ignores declared offsets, does not verify slice hashes/sizes, and flattens alternate URL responses. A malformed manifest can escape the selected directory, and mirrors may be mistaken for additional slices.

### 3. Vendor-authoritative final state

The Connect bridge never writes `IsAppOwned`, supplies placeholder launcher tickets, replaces Ubisoft loaders, or imports a certificate to make replacement DLLs pass verification. Connect itself creates registration/staging, verifies/finalizes payloads, checks entitlement, and launches the product.

That costs more setup and GUI involvement, but it is the more defensible default for modern DRM, DLC, cloud saves, achievements, overlay, online services, and titles whose launcher contract is not understood.

### 4. Evidence and maintainability

The local project has focused unit/smoke/security tests, measured live validation, architectural boundaries, explicit limitation language, and repeated independent security review. Optima compiled at the reviewed commit, but had no tests, was not rustfmt-clean, and failed strict Clippy. Its README makes broader ownership/integrity claims than its runtime enforcement supports.

## Important Optima risks

### Critical: real password and ticket propagation

Optima's local WebAuth page first collects the user's real email/password for the shim profile, separately from official Ubisoft authentication. It stores that password in `profile.toml`, then writes the password, email, account ID, and ticket into `Uplay.ini`, `Uplay.toml`, and `Orbit.toml` beside game code.

The password is documented as unvalidated/optional for offline play, so collecting and copying the real Ubisoft password is unnecessary. Game processes, mods, backups, indexers, or other users with access to the install tree can read those files. Runner/game children also inherit the parent environment, including `OPTIMA_PASSWORD`, because the environment is not sanitized.

### Critical/high: replacement-loader trust design

Optima replaces folder-local Ubisoft loader DLLs. Generated config sets `IsAppOwned=1`, the loader returns owned/connected state, and unavailable Uplay tickets may be replaced with the literal placeholder `OPTIMA` because the shim does not validate them.

For titles that verify loader signatures, Optima imports its certificate into the prefix's `Root` and `TrustedPublisher` stores. The repository tracks a file named `drm/signing/optima-signing.key`; its contents were not read. If it is the corresponding private key, anyone with the repository can sign arbitrary code trusted inside every Optima prefix using that certificate. The code calls the prefix throwaway, but it actually reuses one persistent shared prefix.

The technical behavior is materially different from merely reconstructing owned CDN files: it replaces the game-facing ownership/launcher API and makes anti-tamper accept the replacement. The README's ownership-backed intent does not make the offline cache or `IsAppOwned` assertion cryptographically enforce ownership. This creates substantially higher security, Terms-of-Service, and possible anti-circumvention risk. This is not legal advice.

### High: manifest path escape

Optima converts backslashes and calls `install_dir.join(relative)` without rejecting absolute paths, `..`, or symlinked parents. A compromised or malformed network manifest can write outside the requested install root.

This must be fixed before treating Optima's installer as safe.

### High: brittle WebAuth trust boundary

The local flow:

- serves a self-signed HTTPS page at the Ubisoft-owned-looking `localhost.ubisoft.com` hostname;
- instructs the user to bypass the certificate warning;
- executes mutable remote Ubisoft SDK JavaScript in that local page;
- collects a real password in the local form even though official login occurs separately;
- lacks random state/CSRF binding and robust Origin validation on `/profile` and `/ticket`; and
- renders the full `getTicket()` result into the page's diagnostic log.

A browser-assisted flow is valuable when DataDome blocks direct login, but this implementation expands the credential boundary too far. Any future browser flow here should never collect the password itself, should validate state/origin, avoid displaying bearer values, and ideally use a documented callback/device-code contract.

### Other correctness/security issues

- Fixed Demux version instead of patch negotiation.
- Service initialization responses are not consistently validated.
- Alternate URLs/results/TTL/path grouping are discarded.
- Direct 2FA likely uses the wrong authorization scheme.
- Sensitive state writes follow symlinks and are neither atomic nor locked.
- `OPTIMA_DEBUG` prints the beginning of signed URLs rather than removing query strings.
- Shipped `.reg` files are imported best-effort into the shared prefix.
- Certificate/registry command failures are ignored while success markers may still be written.
- Size-only loader identification and resume can accept unrelated/corrupt files.
- No full chunk/language/install-action/prerequisite handling exists despite calling the result installed.

## Should both projects continue?

Yes, but only if their different trust boundaries remain explicit.

### Keep `ubi-cli-mvp` as the safer general/default path

Use it when official Connect support is acceptable or required:

- modern DRM and online titles;
- cloud saves, achievements, overlay, DLC, and official update behavior;
- authoritative registration and verification;
- users who prioritize conservative security and lower legal risk; and
- development of a hardened reusable Ubisoft downloader.

### Keep Optima as a separate legacy/offline experiment

Its distinct value is launcherless preservation and handheld UX for old R1/Orbit games where Connect is undesirable or broken. It should not be presented as equivalent to official entitlement enforcement, and it needs substantial hardening before broad use.

If launcherless legacy support is not a project goal, maintaining two independent auth/Demux/downloader stacks is unnecessary duplication. The neutral data plane should converge; the launch backends should not.

## Recommended sharing boundary

A sensible long-term shape is:

```text
hardened shared protocol/catalog/downloader core
  -> verified reconstructed tree + non-secret metadata
  -> OfficialConnectBackend (default)
  -> LegacyOfflineBackend (separate package/plugin, explicit opt-in)
```

Good sharing candidates:

1. Protobuf/domain models and dynamic patch negotiation.
2. Product/config parsing and missing-manifest lookup.
3. Modern and flat slice-path support.
4. Zstd/zlib/raw-deflate handling with explicit unsupported-method errors.
5. One hardened downloader with containment, no-symlink writes, hash checks, offsets, alternate-URL mapping, atomic cache/files, bounded concurrency, cancellation, and manifest-bound resume.
6. Synthetic protocol/manifest fixtures and tests.
7. Neutral runner/umu discovery and non-secret compatibility settings.
8. EAX compatibility as an independently licensed, reproducibly built optional component.

Do not merge into the official bridge:

- password collection/storage or password-bearing game profiles;
- `IsAppOwned`/connected-state emulation;
- placeholder ticket behavior;
- Uplay/Orbit replacement loaders;
- self-signed certificate trust;
- fabricated launcher registration; or
- conversion/manufacture of opaque Connect authentication state.

Before accepting Optima code, audit inbound licenses for the YoobieRE schemas, vendored Re0xCat sources, prebuilt DLLs, and generated/signing artifacts. Both roots being MIT does not by itself establish that every vendored binary/source has compatible provenance.

## Practical recommendation

Do not replace `ubi-cli-mvp` with Optima and do not merge the repositories wholesale.

Port the four clear neutral wins first—missing-manifest lookup, flat slices, raw deflate, and bounded per-file slice prefetch—into the tested downloader here. Consider a separate optional `umu` runner/settings helper. Leave the launcherless DRM-shim strategy in a separate project with explicit security/legal warnings and independent review.

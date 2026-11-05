# Model connections and credentials (T05)

`Application` owns the versioned `app.model-configuration` session document in the same SDK Storage as product conversations. The document contains immutable connection IDs, public endpoint/protocol/model definitions, enabled flags and the new-conversation default. `pi.agent.model` remains the authority for each conversation's current selection. A default change does not rewrite existing conversations. A current-selection change does not abort an already dispatched request.

## Public boundaries

The data-only descriptor and payloads are in `src/model-protocol.ts`. `models.get`, `models.create`, `models.setDefault`, `models.setEnabled` and `models.select` pass through the existing versioned Application Interface. Connection mutations compare `expectedVersion`; a retried creation with the same ID and definition returns its existing identity. A different destination/protocol requires a new ID. Disabled and otherwise old definitions remain present for retained references. No automatic credential inheritance occurs.

Configuration is validated, committed through the real SDK transaction, synchronously published to `Models`, then acknowledged. Readers cannot run between individual provider replacements in that synchronous publication. Post-commit publication failure blocks further model dispatch and marks the application failed; reopening loads the committed version. It does not promise a rollback that did not happen. Configuration loading precedes `Harness.resume`. Request admission checks the current enabled/configuration state after its last asynchronous credential read.

Passwords use `DurableNative.writeCredential` and a separate native Messenger operation. Native checks the authoritative ready connection target and performs generation-CAS save/removal. Plaintext never enters ordinary `Application.request`, SDK documents, generic tool arguments or Termux. The correlated response contains only metadata or a fixed safe error. An absent bridge never falls back to ordinary `postMessage`. Inputs are cleared on submit/page teardown. The UI explains that chats, attachments and tool results can go to the selected cloud service.

## Request-time authentication

`ModelConnections` uses public Pi AI `createModels`/`createProvider`, `CredentialStore` and restricted `AuthContext` seams. Its SDK credential store is a presence facade: it supplies a nonsecret marker, never the real API Key. The actual native credential is resolved at the final checked fetch boundary, where the destination and credential generation are checked before adding the authentication header. This deliberately keeps real credentials out of both SDK serialized options and provider setup errors. Public configuration queries use metadata only; they do not call `Models.getAvailable`, `checkAuth`, secret resolution or decryption. No environment/file fallback is configured.

Production accepts credential-free HTTPS base URLs without query/fragment/userinfo. Both the constructed model/auth endpoint and final exact `POST <base>/chat/completions` route are validated. Requests use `redirect: 'error'`, including same-origin changed-path redirects. MiMo uses request-time `api-key`; configured OpenAI-compatible services use Bearer authentication. Neither header is retained in session state. Loopback HTTP and custom Provider factories exist only as explicit test/platform adapter constructor options; the product bootstrap never enables them.

Stream settings are checked before SDK open and on subsequent reads. Only typed transport, timing/retry, cache and deferred options are admitted; headers, arbitrary metadata, API keys and extra fields are rejected before they can enter generation or compaction checkpoints.

Each request retains its own sent credential in memory until its response is consumed. A byte-stream filter and a second decoded-event filter remove reflected keys from text, errors, object values and property names before SDK progress/final persistence. The decoded filter is necessary for JSON Unicode escapes and parsed tool arguments. Raw assistant provider metadata is omitted; ordinary nested tool argument metadata is preserved. UTF-8 decoding and UTF-16 surrogate boundaries are preserved. An earlier request's K1 is still filtered after the vault has rotated to K2. Immutable JVM/JS strings cannot be guaranteed zeroed; this is authorized request-time memory, not at-rest protection against a compromised same-UID process.

## Recovery and concurrency

The application does not implement another scheduler. Tests exercise the pinned Pi 1.5.0 behavior with real Storage and actual process boundaries:

| Boundary | Observed contract |
| --- | --- |
| New prepare / permitted ordinary generation retry | Reads current conversation selection and current request-time credential. |
| Already dispatched request | Configuration/credential edits do not abort or replay the dispatched bytes. |
| Successful normal close/reopen | Saved generation retains its old connection/model selection and resolves current auth. This can issue a new HTTP call for the old logical request. |
| Actual process termination during generation | SDK interrupted-attempt policy applies; a permitted retry prepares the then-current selection. |
| Deferred polling / interrupted poll | Saved response identity and connection remain fixed. Matching credential generation is required both before polling and at final fetch admission. Unknown account compatibility, disabled or unrecoverable handles produce deliberate non-retryable errors, never a replacement start. |
| Selected compaction / compaction retry | Selected old connection remains fixed while resolving current auth. Normal close/reopen also retains that selection. |

The nonsecret deferred envelope stores the original provider conversion data plus connection ID and credential generation. Changing a key does not prove that two keys name the same account. The compatibility check is conservative. A retryable provider polling error is a distinct SDK case that can discard a handle and prepare a new generation; policy failures do not reuse that error classification. MiMo Completions has no claimed deferred support; controlled Provider fixtures verify these SDK contracts.

## Native vault

`CredentialVault` stores AES-GCM ciphertext in private credential-encrypted `noBackupFilesDir`. AndroidKeyStore holds a fresh, nonexportable AES-256 protection key for each replacement. AAD binds the envelope version, immutable connection and monotonic generation; namespace isolation uses its SHA256 in the validated key-alias prefix. Save/removal use a stable cross-process OS lease, checked file sync, rename and directory sync before success. Removal leaves a generation tombstone. A failure after rename reports uncertainty and retains protection keys; reread the generation before retrying. There is no plaintext fallback or same-alias recreation presented as recovery.

`UserManager.isUserUnlocked` is checked before obtaining a CE path. After first unlock, later screen lock does not impose per-use authentication or an unlocked-device requirement. Android execution limits still apply. Metadata checks envelope structure and alias presence without obtaining a SecretKey or decrypting. `NativeCredentialAccess` can report an observed corrupt/permanently-invalidated result, keyed to the exact ciphertext revision, without decrypting again; a fresh process returns structural presence until a new resolve observes the failure.

Statuses distinguish absent, configured, waiting-first-unlock, temporarily-unavailable, key-missing, permanently-invalidated, corrupt and incompatible. Valid but damaged ciphertext/missing aliases can be explicitly replaced with CAS. Unreadable or future envelopes are preserved; create a new connection/key and explicitly select it for retained conversations. Credential errors do not delete conversation history or UI drafts. Backup exclusions remain as accepted in T04; this ticket does not claim actual backup/restore acceptance.

## Reproduction and evidence

- `npm test --prefix runtime`: Application/policy tests, fixed SDK storage tests, and real child-process recovery tests. `test/model-recovery.test.mjs` uses a parent-owned HTTP server and IPC barriers, not timing-based simulated crashes.
- `npm test --prefix ui` and `npm run build --prefix ui`: UI behavior and actual React → Application → SDK/SQLite integration.
- Build runtime and UI first, then `android/gradlew.bat -p android :app:assembleDebug :app:assembleDebugAndroidTest` with the documented JDK/SDK.
- Android `CredentialVaultTest`: real AndroidKeyStore/CE, CAS, fault classification, metadata, process lease and KeyInfo. Permanent invalidation classification uses an explicitly injected external Cipher failure; it is not physical key invalidation.
- Android `ModelSettingsTest`: actual React settings/native write, rotation/reopen, shared policy checks on Android Node, and opt-in real MiMo. `realProvider=true` requires the encrypted RSA capsule prepared by the root device coordinator; the test consumes it directly into the vault in memory. No plaintext provisioning file is used.
- Debug-only Direct Boot receiver checks real first-unlock state without resolving a secret or touching CE before unlock. It is not a background model runner.
- `node android/scripts/model-invalid-credential.mjs <device> <output-prefix>` reproduces the real MiMo 401 path with an intentionally invalid synthetic key. It uses debug WebView CDP, stops only this app, opens a new dedicated validation domain, drives actual settings/chat controls and removes its ADB forwarding. It never accepts a real key argument. Device coordination is required; optional screenshots do not determine functional success.

Versioned acceptance and the exact tested endpoint/device/support matrix are recorded in [T05 evidence](../docs/evidence/t05/README.md). Catalog listing does not assert that every catalog model or arbitrary compatible endpoint has passed live validation.

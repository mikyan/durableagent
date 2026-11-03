# Pi runtime and SQLite candidate probes (T01–T02)

This is a candidate-validation application, not the production Agent. It loads the **published Pi Durable / Pi AI / pi-schema 1.5.0 npm files** without a custom resolver or bundler rewrite. T01 conversations use MemoryStorage; T02 uses the real SqliteStorage and Chord Node SQLite adapter. The deterministic conversation fixture replaces model HTTP transport: actual Pi AI lazy OpenAI-compatible code consumes a byte-split SSE response. Explicit live tests are separate.

The agreed seam is `RuntimeProbe.start / send / observe / snapshot / stop / close`, exposed by a small trusted WebView through the native host. Kotlin owns exactly one Javet Node runtime on a dedicated thread, in the app's `:runtime` Service process. It pumps `RunNoWait` so messages and cancellation remain dispatchable. The Service is started separately from UI bindings. Android background survival/FGS policy is outside T01 and belongs to T12.

## Reproduce

Requirements: Node >=22.19.0 (validated desktop version recorded in evidence), JDK 17, Android SDK platform 36 and build-tools 36.0.0. No Android device is touched by the build.

```powershell
npm ci --ignore-scripts --prefix runtime
npm run build --prefix runtime
npm test --prefix runtime
# Set JAVA_HOME and ANDROID_HOME for this process to installed paths.
./android/gradlew.bat -p android :app:assembleDebug :app:assembleDebugAndroidTest
```

Android outputs: `android/app/build/outputs/apk/debug/app-debug.apk` and `android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`. Install the pair only on an authorized device. The app id is `dev.durableagent.probe`; instrumentation is `dev.durableagent.probe.test/androidx.test.runner.AndroidJUnitRunner`. Tests emit `probeEvidence` JSON for ready, streamed, settled, cancelled, closed and failed states. The UI can run the ordinary text scenario manually.

The APK includes ARM64 (supported target) and x86_64 (validation emulator only). `runtime.zip` contains npm production package files and compiled probe modules; it excludes TypeScript compiler/type packages. App private extraction uses a content-hash directory and completion marker. No npm install or dev server runs on Android.

## Boundary and evidence

- Lockfile pins npm tarball URLs/integrity for the complete closure. Direct dependencies are exact versions.
- Javet is fixed to `com.caoccao.javet:javet-node-android-i18n:6.0.3`; AGP 8.13.2, Kotlin 2.3.20, Gradle 8.13 and SDK 36.0.0 are fixed. Wrapper distribution SHA256 is checked. The standard non-i18n artifact failed actual Pi schema imports; see the gate report.
- Imports exercise actual package exports, relative modules, `import.meta`, crypto and SQLite. `node:vm` uses Node's main-context ESM loader, not Javet's V8 module resolver.
- The deterministic matrix checks text/tool arguments split at every byte, schema coercion and rejection, hanging-read abort, duplicate start, initialization/close race, UI detachment, runtime fault and close/recreate. It deliberately makes no crash-durability claim.
- `memory` is process RSS sampled at state publications, `peakMemory` is its maximum among samples (not a continuous high-water RSS). `startupMs` measures SDK initialization; Android `elapsedMs` also includes extraction/JNI/import time. `cancelMs`, SDK `closeMs`, and `nativeCloseMs` are separate measurements.
- Gate reports under `docs/evidence/t01/` distinguish desktop, static artifact, emulator and ARM64 evidence. A build or desktop pass does not clear T01 for T02.

## Explicit live MiMo validation

The default suite does not make network calls. The Android live test runs only with instrumentation argument `realProvider=true`, preferably selecting `RuntimeProbeTest#optInRealMimoRoundtripAndCancellation`. It reuses the fixed SDK's `xiaomiTokenPlanCnProvider`, model `mimo-v2.6-flash`, and the China Token Plan endpoint. It permits at most four HTTPS POST requests, disables retries, caps output at 1,024 tokens/request and sets a 45-second request timeout. Inputs/tools are synthetic. Client abort is not evidence that server compute or billing stopped.

Start the Activity once to bind the runtime Service. It generates a validation-only AndroidKeyStore RSA 2048 key and exports **public** SPKI DER to `no_backup/mimo-validation-public.der`. Encrypt the supplied API key in host memory with that public key using RSA-OAEP SHA1/MGF1-SHA1. Transfer only the 256-byte ciphertext to `no_backup/mimo-validation-key.rsa`. No plaintext credential file is accepted. At explicit live start, native code decrypts to memory, deletes the capsule, and passes a JNI value to JS, which consumes/removes the temporary global. Provision a new encrypted capsule for each fresh live runtime. The key never enters generated JS source or persisted SDK options; final fetch checks destination/method and adds `api-key`. MemoryStorage rejects any commit containing the exact secret. Errors are redacted at the probe observation seam. This test-only provision does not implement the product's T05 credential management.

## T02 storage contract validation

Select `-e class dev.durableagent.probe.StorageProbeTest` when invoking the same instrumentation runner. It runs 47 shared checks (the SDK's 32 public `createStorageConformance` cases plus 15 driver/Session checks), six process-death windows, native ownership contention, and a persisted conversation. A fifth test runs the live persisted MiMo conversation only with `-e realProvider true`; provision one new encrypted capsule first. This live case uses two requests, then reopens the saved transcript with no credential or model request. SQLite commits reject the exact secret, and live teardown scans the dedicated DB/WAL/SHM bytes for its UTF-8/UTF-16 encodings both before and after close/checkpoint.

`StorageDomainLease` takes a stable OS file lock before creating Node or opening SQLite/migrations. A same-process registry prevents reopening the lock inode, which could release POSIX process locks when a second descriptor closes. The independent instrumentation/UI process verifies it cannot acquire the runtime's lease, and that a competing native owner prevents runtime creation. Normal teardown releases the lease after Node closes; process death releases it in the kernel. JS additionally rejects concurrent opens of the same canonical file. WAL is a journal mode, not an ownership mechanism.

`openOwnedStorage` uses exact Chord 1.5.0 `NodeSqliteDatabase` and exact Pi 1.5.0 `SqliteStorage`. It explicitly replaces the adapter's NORMAL default with FULL and checks `journal_mode=wal` and `synchronous=2` before migrations. Engine version/source ID, compile options, busy timeout and WAL autocheckpoint are emitted in `storageEvidence`. A failed Session is closed and inspected after reopen; no replay loop is provided. The wrapper retains the in-process reservation if close fails.

All storage tests use UUID-named data below the validation app's private `files/storage-validation/`. They never clear app data or touch Termux. The crash test intentionally kills only the app's separate `:runtime` process after observing a precise barrier: before an entry write, after the actual write but before COMMIT, after native COMMIT but before receipt, after receipt, during an unflushed deferred update, or during the schema 1→2 task-table migration. The independent test process then starts a new host and inspects the same stable IDs. No normal close is used for the deferred-loss experiment. Desktop tests kill a dedicated child process at the same JS barriers.

These tests validate process-crash recovery. Device power removal, controller write-cache behavior and filesystem/hardware failure are not tested, and FULL is not a measured zero-loss guarantee. Product schema, credential lifecycle, native input records, Termux effects, background process policy and backup/migration UX remain their own tickets. See [T02 evidence](../docs/evidence/t02/README.md).

# Pi runtime candidate probe (T01)

This is a candidate-validation application, not the production Agent. It loads the **published Pi Durable / Pi AI / pi-schema 1.5.0 npm files** without a custom resolver or bundler rewrite. All SDK conversations use MemoryStorage. The only replacement is model HTTP transport: actual Pi AI lazy OpenAI-compatible code consumes a deterministic byte-split SSE response. No live Provider support is inferred from this fixture.

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

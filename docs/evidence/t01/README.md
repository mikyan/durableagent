# T01 runtime validation evidence

Validation date: 2026-11-04. This directory records a candidate probe, not the production app. User subsequently invoked implement-spec and authorized live MiMo smoke testing. MemoryStorage remains non-durable; no T02 storage acceptance is inferred.

## Candidate correction established by execution

The original fixed `com.caoccao.javet:javet-node-android:6.0.3` artifact **failed** on both Galaxy S23 Android 16 / ARM64 / 4 KB pages and Android 16 x86_64 / 16 KB emulator. Native Node started and Node's real ESM loader reached Pi schema, but module parsing failed:

```text
SyntaxError: Invalid regular expression: /^\p{ASCII}*$/u: Invalid property name
```

The unchanged published file is `@earendil-works/pi-schema/dist/formats/typebox/idna/pattern/pattern.js:38–39`. The standard Javet build disables ICU; the regex is essential real schema code, so the probe did not remove it, replace WeakRef or rewrite the SDK.

The same maintained Javet release publishes `javet-node-android-i18n:6.0.3`. The probe now uses that exact AAR and `V8Host.getNodeI18nInstance()`. This changes a runtime feature variant within the first candidate, not the UI architecture, Android target, Agent location or npm resolver. The 16 KB emulator then passed the real SDK deterministic matrix with Node `v26.13.0`; its embedded ICU data was sufficient without an external `.dat` file. ARM64 and live Android evidence are still being collected at this document revision.

Source reference: [Javet i18n guidance](https://www.caoccao.com/Javet/tutorial/advanced/internationalization_i18n.html), [release build patch](https://github.com/caoccao/Javet/blob/6.0.3/scripts/deno/patch_node_build.ts), [official i18n Maven artifact](https://repo.maven.apache.org/maven2/com/caoccao/javet/javet-node-android-i18n/6.0.3/).

## Fixed inputs and provenance

| Input | Fixed version / integrity |
|---|---|
| Pi Durable, Pi AI, pi-schema, Chord | Published npm `1.5.0`; complete closure in `runtime/package-lock.json` with tarball URLs and SRI |
| Javet standard AAR (failed candidate) | 6.0.3; SHA256 `68e5de97dd8d149d12fa49792915b5646e9fef9f1b34a53c8d11574a56ab6db9` |
| Javet i18n AAR | 6.0.3; SHA256 `39a9c290cf6636e6473b60b4e6321106d3fad7ff5dcc13ffad474e29a3a067c9` |
| Gradle | 8.13 bin ZIP SHA256 `20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78` |
| Gradle wrapper JAR | Official v8.13.0; SHA256 `81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f` |
| AGP / Kotlin | 8.13.2 / 2.3.20 |
| Android compile / target / min SDK | 36 / 36 / 36; build-tools 36.0.0 |
| Build Java | Temurin 17.0.19+10, Windows x64 |
| Desktop SDK tests | Node v24.14.1, npm 11.11.0; TypeScript 5.9.3 |

The research's source workflow describes NDK r29. Inspection of the published standard ELF instead found an r30 build marker; this is an observed artifact/source difference, not a claim that the native binary was reproducibly built here. See [binary inspection](javet-standard-artifact.md).

## TDD and failure record

Six desktop public-seam tests were introduced one at a time. Observed red stages were missing probe import; absent hanging-read metrics/control; close completing before initialization and later reviving ready; absent assembled tool arguments; absent rejected-tool observation; absent primitive/SQLite result. Each passed after its corresponding implementation. Tests use real Pi packages and real MemoryStorage; only the model HTTP response is controlled.

Android integration found and corrected two host defects before reaching the runtime gate: Samsung deferred an early service binding (now bounded retry with explicit failure); the owner-thread queue captured a recycled Binder `Message` (now copies its command string synchronously). Activity testing releases the extra test observer and destroys the UI, then creates a new UI/client and checks runtime identity/PID and current SDK state. Runtime failures and successful native close report the remaining native-owner count.

The standard-AAR Unicode parse failure remains a separate recorded rejected candidate, rather than being rewritten as a successful run. A later feature variant pass does not retroactively change that evidence.

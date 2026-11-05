# T01 runtime validation evidence

Validation date: 2026-11-04. **T01 candidate gate passed for the pinned Javet i18n variant on the recorded environments.** This directory records a candidate probe, not the production app. User subsequently invoked implement-spec and authorized live MiMo smoke testing. T02 may use this runtime/SDK prerequisite evidence; MemoryStorage and the simple SQLite primitive check do not establish T02 storage acceptance.

## Candidate correction established by execution

The original fixed `com.caoccao.javet:javet-node-android:6.0.3` artifact **failed** on both Galaxy S23 Android 16 / ARM64 / 4 KB pages and Android 16 x86_64 / 16 KB emulator. Native Node started and Node's real ESM loader reached Pi schema, but module parsing failed:

```text
SyntaxError: Invalid regular expression: /^\p{ASCII}*$/u: Invalid property name
```

The unchanged published file is `@earendil-works/pi-schema/dist/formats/typebox/idna/pattern/pattern.js:38–39`. The standard Javet build disables ICU; the regex is essential real schema code, so the probe did not remove it, replace WeakRef or rewrite the SDK.

The same maintained Javet release publishes `javet-node-android-i18n:6.0.3`. The probe now uses that exact AAR and `V8Host.getNodeI18nInstance()`. This changes a runtime feature variant within the first candidate, not the UI architecture, Android target, Agent location or npm resolver. Both environments then passed the complete SDK matrix with Node `v26.13.0`, ICU `78.3`, Unicode property regex and `Intl.Locale('zh-CN').language === 'zh'`; embedded ICU data was sufficient without an external `.dat` file.

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

## Executed deterministic matrix

| Environment | Actual result | Bounded measurements from this run |
|---|---|---|
| Galaxy S23; Android 16 / API 36; ARM64; page size 4,096 | 2 deterministic instrumented tests passed, 1 live test explicitly skipped; 11.2 s | First ready 4,540 ms including bundle extraction/import; later recreations 313–335 ms; max sampled runtime-process RSS 205,152,256 bytes; hanging-read cancel 10.52 ms; JNI close 3–8 ms |
| Google Android 16 `google_apis_ps16k` x86_64 emulator; API 36; page size 16,384 | Same 2 tests passed, live test explicitly skipped; 10.174 s | First ready 2,385 ms including extraction/import; recreations 189–253 ms; max sampled process RSS 838,418,432 bytes; hanging-read cancel 5.50 ms; JNI close 2–5 ms |
| Windows x64, Node v24.14.1 | 6 public-seam tests passed | Full output in [desktop tests](desktop-tests.txt); this is host evidence only |

The two Android tests cover: real package/relative/static imports and `import.meta`; crypto/codecs/WeakRef/Proxy/async iteration/SQLite; genuine Pi SDK watch updates; per-byte UTF-8/SSE and tool argument assembly; valid schema coercion and invalid argument rejection before tool execution; hanging-read abort; duplicate start; destruction of all UI/test observer bindings and later reattachment to the same runtime PID/instance; normal close and fresh native-runtime creation; injected runtime execution failure and recreation. Observed native runtime count is one while running and zero after every recorded close/fault. This is bounded resource/lifecycle evidence, not a long-duration leak claim or durable crash recovery.

Device build fingerprints: S23 `samsung/dm1qzcx/dm1q:16/BP2A.250605.031.A3/S9110ZCS7EZCI:user/release-keys`; emulator `google/sdk_gphone16k_x86_64/emu64xa16k:16/BE2A.250530.026.F3/13894323:userdebug/dev-keys`. Device serials are omitted. Emulator memory is not a phone estimate; these measured values are not guarantees for other devices.

Raw device observations: [S23](s23-deterministic.txt), [16 KB emulator](emulator16k-deterministic.txt). Both used fourth-pair APK SHA256 `fbf7750d5da360348fbae927ff6b577b36b4df9978b71da7dbb2823ca6a313d8`. Standard-artifact failed runs are preserved separately: [S23](s23-standard-failed.txt), [16 KB emulator](emulator16k-standard-failed.txt).

The final live-test pair adds explicit per-request abort counters/read completion and reports ICU metadata. App SHA256 `4d60020c8f15dbc2d4f45bc97295605225ffa1a51791b5e8c91b07376ab587a4`; instrumentation SHA256 `be102c5607d0766c054c289f95857ba9a28e4e06e277478e39662e0c4c4af26c`. APK ELF and ZIP checks are recorded in [i18n artifact inspection](javet-i18n-artifact.md).

## Final full suite including real MiMo

The final APK above was installed on both recorded environments. With `realProvider=true`, **all three instrumented tests passed with no skips**: S23 in 19.273 seconds, 16 KB emulator in 17.838 seconds. This repeats the deterministic matrix on the final artifact and adds real MiMo tool execution, follow-up incremental response, cancellation and close. Raw evidence: [S23 final suite](s23-final-live.txt), [16 KB final suite](emulator16k-final-live.txt).

The selected model was `mimo-v2.6-flash` at the exact China Token Plan HTTPS endpoint, using the SDK's own provider/catalog and OpenAI-compatible lazy implementation. Each device made three real requests: tool call, follow-up after its result, then a deliberately long response stopped after actual output. The real tool executed once with `{city:"北京🌍",count:2}`; the follow-up response used that result. Before cancellation, S23 observed 5 text and 7 tool-argument delta events across the first two requests; the emulator observed 14 text and 7 argument deltas.

| Cancellation evidence for current HTTP request 3 | S23 | 16 KB emulator |
|---|---|---|
| Immediately before Stop | Read pending; request abort count 0; provider not finished | Same |
| After SDK Stop | Same request 3; abort count 1; read no longer pending; `AbortError` | Same |
| SDK abort latency | 10.43 ms | 12.08 ms |
| Native owners after close | 0 | 0 |

An earlier live run used a cumulative abort boolean that could include normal cleanup of the preceding response. It was not accepted as cancellation proof; the final test resets/checks metrics at the actual HTTP request boundary and compares identity/counter/read state before and after Stop. Client abort still does not prove server computation or billing stopped.

Only encrypted RSA-OAEP credential capsules were transferred to the apps; AndroidKeyStore private keys remained in their platform stores. Capsules were consumed/deleted on both devices. Only public DER files remained in the provision directory. The coordinator's exact-secret scan of live evidence found zero occurrences; audited real MemoryStorage also rejects exact-key persistence. This is coverage of the tested flow, not the product's complete T05 secret-handling acceptance.

Maximum sampled runtime-process RSS over the final suite was 216,272,896 bytes on S23 and 849,002,496 bytes on the x86_64 emulator. These are publication-time samples as documented, not continuous high-water measurements. There is no physical ARM64 device with 16 KB pages in this test set: ARM64 ELF alignment is checked statically, ARM64 execution is on 4 KB S23, and actual 16 KB execution is on x86_64. Other devices, background lifecycle policy, long-duration memory behavior, durable recovery and additional Providers remain subsequent work.

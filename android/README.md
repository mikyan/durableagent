# Android application and T06 input validation

The Android app hosts the bundled React UI and the Pi runtime, while native draft storage remains independent of Node and SDK Storage. Build and device results are tracked by the [ticket index](../docs/specs/v1/README.md); individual targeted test passes do not establish acceptance of a different final APK. The [T06 evidence](../docs/evidence/t06/README.md) records the exact candidate hashes, unified results, earlier failures and platform limits.

For earlier runtime/SQLite reproduction and encrypted live-test provisioning, see [runtime documentation](../runtime/README.md). UI protocols and interaction assertions are described in the [UI documentation](../ui/README.md).

## Build

Requirements: Node 22.19 or newer, JDK 17, Android SDK platform 36 and build-tools 36.0.0. Set `JAVA_HOME` and `ANDROID_HOME` to the installed tools. From the repository root:

```powershell
npm ci --ignore-scripts --prefix runtime
npm ci --ignore-scripts --prefix ui
npm run build --prefix runtime
npm run build --prefix ui
./android/gradlew.bat -p android :app:assembleDebug :app:assembleDebugAndroidTest
```

The APK pair is:

- `android/app/build/outputs/apk/debug/app-debug.apk`
- `android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`

Builds do not operate a device. Before device tests, install this exact pair on an authorized validation device and record its hashes. The instrumentation runner is `dev.durableagent.probe.test/androidx.test.runner.AndroidJUnitRunner`. The debug build provides synthetic source/fault components and WebView debugging; these are validation tools, not product controls.

## Native draft and attachment matrix

Install the [independent source fixture](fixtures/input-source/README.md) before running the complete matrix. From the repository root, with `adb` available:

```powershell
$device = '<authorized-device>'
adb -s $device install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s $device install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s $device shell am instrument -w -r -e class 'dev.durableagent.probe.NativeInputStoreTest,dev.durableagent.probe.NativeInputCrashTest' dev.durableagent.probe.test/androidx.test.runner.AndroidJUnitRunner
```

The matrix contains **20 test methods**: 18 in `NativeInputStoreTest` and two in `NativeInputCrashTest`. It uses dedicated `input-test-*` data and synthetic documents; no model key or network request is required.

- Draft recovery across helpers/reopen, independent conversations, monotonic revision after clear, operation replay, and stale save/clear rejection.
- Actual WAL/FULL/foreign-key values in both the read pool and an active writer transaction. Android pool configuration uses `execPerConnectionSQL`; the dedicated quota case constrains all connections with `max_page_count`, provokes a real SQLite capacity failure, and checks the last committed text survives.
- Whole UTF-8 validation and Unicode digest, PNG transparency and full-frame resizing, JPEG EXIF orientation, damaged/mismatched images, unknown source lengths, pixel/byte budgets and model capability changes.
- Immutable frozen bytes after original changes, source loss and actual cross-UID permission revocation; pin protection during cleanup; discarding fixed input never deletes the user source.
- Slow source reads and held provider metadata queries. The initial selection is committed with explicitly unknown metadata before any provider call; its receipt releases the UI save dependency. A separate native store can commit newer text while source work remains pending, and the eventual source result preserves that text.
- Two occupied source workers do not block a third selection's initial commit or a subsequent text save. `admitSource` performs the short transaction on the writer queue and returns a `SourceAdmission` receipt; `continueSource` runs separately on the existing source pool. The per-job lease covers the queue wait. An admission that will not run must be closed: the bridge does this when dispatch is rejected or it is already closed. Closing a native store abandons its pending admissions; running work retains ownership until its completion/cancellation cleanup. The regression also removes a queued selection, runs cleanup and reopens after abandoning another admission.
- Failed final publication recovery while the same process remains alive. Per-job OS leases distinguish a live worker from a stale durable job; PID liveness alone is insufficient.
- Actual CE/private `no_backup` layout and packaged backup/transfer exclusions. These are configuration/layout checks, not an OEM backup or device-transfer experiment.

The two crash methods kill the real separate debug process `:input_fault_probe`, after observing each of six barriers:

| Barrier | Required recovery observation |
| --- | --- |
| Before draft COMMIT | Last confirmed author text/revision remains. |
| After draft COMMIT, before receipt | The new version exists; replaying the same operation returns its receipt. |
| After staged object `fsync` | Incomplete preparation is recoverable; partial data is not ready content. |
| After object publication, before metadata commit | Unreferenced material can be reclaimed; retry prepares complete bytes. |
| After preparation commit, before receipt | The ready representation survives. |
| After freeze/pin commit, before receipt | The same frozen token is recovered and remains readable after draft clear and cleanup. |

The tests do not simulate these windows with an orderly close. They emit `inputCrashEvidence` for actual separate-process death, and `inputEvidence`, `inputQuotaEvidence` or `inputGrantEvidence` for relevant safe facts. They do not claim power-loss zero-loss durability or that every keypress was committed.

## Application, picker and live input checks

`InputApplicationTest` exercises the actual React/native/SDK path: native saving while Node is busy or absent, two drafts across recreation/reopen, runtime input-policy checks, and replay of a committed selection without opening another picker. The first UI receipt describes a saved selection, not fully prepared bytes or SDK admission. Source validation/preparation and explicit sending remain distinct operations.

The real system picker is opt-in and requires device-runner interaction while instrumentation waits:

```powershell
adb -s $device shell am instrument -w -r -e class 'dev.durableagent.probe.InputApplicationTest#actualSystemPickerImportsSyntheticText' -e systemPicker true -e pickerSource external dev.durableagent.probe.test/androidx.test.runner.AndroidJUnitRunner
```

Select **DurableAgent 外部测试资料 → fixture-note.txt** in the system picker. The test checks complete frozen UTF-8 content and the runtime's zero model-request count. Direct fixture-issued grants and same-UID source fault injection are separate checks and cannot substitute for this navigation/consent result.

`InputApplicationTest.realMimoReadsFrozenImageAndUtf8ChallengesAfterOriginalChanges` requires `realProvider=true` and the existing encrypted validation credential capsule. It intentionally contacts the configured MiMo service using synthetic challenges. Do not put credentials in command arguments, plaintext files, SDK options or test logs. The ordinary native suite and UI-process script below need no credential.

## Actual UI process death and reopen

With the final debug APK installed, run the standalone Node script from the repository root. The output prefix's parent directory must already exist:

```powershell
node android/scripts/input-ui-process.mjs "$device" '<output-directory>/input-ui' fixture
```

The script uses `ADB` if set, then `ANDROID_HOME/platform-tools`, then `adb` from `PATH`. It requires Node's built-in `fetch` and `WebSocket` and the debug WebView CDP socket. Use **fixture mode**: the script explicitly asserts that mode before starting the app. It never provisions a key or clicks Send.

The script starts a fresh validation run, creates two real conversations through the UI, enters distinct synthetic drafts, and waits for each confirmed native save. It closes CDP, kills only the UI PID, verifies the `:agent` PID is unchanged, reopens the UI and checks both exact draft texts, saved state and empty submitted histories. No extra observer binding keeps the host alive. There is an initial package force-stop to start the validation run; app data and Termux are not cleared.

Outputs include a JSON result and available before/after PNGs. A missing/zero viewport or screenshot timeout is recorded as a diagnostic and does not hide a functional assertion failure; it also provides no visual acceptance. The script's empty histories do not measure exact model-request counts—those assertions belong to the instrumentation tests. Keep device identifiers and credentials out of published evidence.

`lastSelectedRestored` is an observation, not a draft durability assertion: the final emulator once reopened on the first conversation instead of the last selected one, while both original saved drafts remained exact. The original failure and same-run recovery reads remain in T06 evidence; the page-selection behavior remains a T15 experience limitation. The helper still requires a new UI PID, the unchanged native PID, and every full draft/saved/empty-history assertion.

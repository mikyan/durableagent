# Android application validation

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

## Native sending, acknowledgement and stop facts

After installing the exact APK pair, run the T07 native authority matrix:

```powershell
$device = '<authorized-device>'
adb -s $device shell am instrument -w -r -e class 'dev.durableagent.probe.NativeSubmissionStoreTest,dev.durableagent.probe.NativeSubmissionCrashTest' dev.durableagent.probe.test/androidx.test.runner.AndroidJUnitRunner
```

The current source contains **12 methods**: nine store tests and three crash tests. They use actual native SQLite, dedicated `input-test-*` namespaces and the bundled synthetic document provider. They do not start Node or use a model credential. Candidate results, including the separate migration test, must be recorded against the APK actually run; the count here describes the suite rather than a gate result.

- An explicit action binds a stable intent ID to the frozen token, original author revision/digest, product/SDK association, location expectation, queue policy and control generation. Replaying an action returns that intent; explicitly sending the same body with a new action creates a distinct intent. List queries use bounded pages and cursors tied to their conversation filter.
- Native ACK atomically stores the validated SDK receipt and clears a draft only if its author revision/text and all ordered ready representation identities still match the frozen input. Later edits, author text that changed away and back, and a newly prepared object at the same author revision survive. Replaying an ACK returns the current draft and does not clear it again.
- The durable stop fence cancels old generations without rewriting every historical intent. Only a new explicit action advances a stopped generation; an unresolved prior SDK abort remains a barrier. Confirming an older stop cannot clear a newer barrier. A late valid ACK records acceptance while retaining cancellation.
- Pending, uncertain, acknowledged and cancelled intents retain their frozen object pins. Explicit discard rejects an input still held by an intent, and cleanup preserves its exact bytes. ACK is not evidence that all downstream effects have completed, so this module does not automatically release those recovery objects.
- Actual native transactions reject injected storage failures without publishing a partial intent, ACK or stop. A malformed existing control record remains on disk and raises `INPUT_STORAGE_CORRUPT`; it is not replaced with a default open control. The generic UI method surface cannot forge ACKs or confirm an SDK abort.
- The schema migration case uses a dedicated SQLite v2-schema fixture with real draft/object/operation data, then exercises the actual helper upgrade to the current schema 4. Migration preserves old material and creates no send. A migrated conversation requires trusted publication of its SDK association before creating an intent.

`NativeSubmissionCrashTest` observes and then kills the real separate debug process `:submission_fault_probe` at six native barriers: before/after intent commit, before/after ACK commit, and before/after stop commit. Recovery checks the last committed fact, same-action replay and preservation of later drafts. The emitted `nativeSubmissionCrashEvidence` records each observed barrier. The intent and ACK barriers cover four of T07's six **cross-database admission** windows; the two SDK commit windows belong to the runtime/application suite. The extra two native stop barriers must not be counted as SDK commit evidence. Native receipt fixtures alone do not prove unique SDK submission or a real provider request.

The native input database remains independent of SDK Storage. Native intent/ACK/control commits and SDK admission commits do not form one transaction. Public input actions run through the native bridge before the Node queue; only the trusted host exposes `markDeliveryUnknownJson`, `confirmAdmissionJson` and `confirmAbortJson` to the runtime.

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


## Reliable submission: actual UI process loss

```powershell
node android/scripts/submission-ui-process.mjs "$device" '<output-directory>/submission-ui' fixture
```

This standalone debug helper starts a fresh fixture run with an initial package force-stop, creates a conversation and sends one synthetic input through the actual React controls. After the original intent is acknowledged and settled, it saves a newer unsent draft, kills only the UI PID, and reopens. It requires a new UI PID, unchanged `:agent` PID, the same intent/receipt and complete history, and the exact new draft text/revision. Its public Interface observer only reads; rejected `INPUT_STORAGE_BUSY` reads have a bounded retry with a recorded count. No observer service binding keeps the host alive. No app data or Termux data is cleared.

Use the same ADB resolution and output rules as the draft helper above. This helper accepts fixture mode only and does not provision credentials. Real MiMo ACK-loss recovery and exact request deltas are covered by `SubmissionApplicationTest.realMimoLostAckReconcilesWithoutAnotherCloudRequest`, with `realProvider=true` and an encrypted validation capsule. That test performs two explicit user actions, and verifies same-intent reconciliation adds no request. `recreateActivity=false` may omit the Activity recreation step on a locked device; evidence records that omission, and it supplies no recreation acceptance.

The React instrumentation observer uses only `listSends`, `inspect` and `readSend` against the native store. On `INPUT_STORAGE_BUSY` it retries that observation for at most two seconds and records counts; it does not retry mutations or swallow another error code. A native write failure remains a product failure. These two React fixtures have only text and no preparation jobs; in general `inspect` may perform interrupted-preparation maintenance, so it is not an assertion that every native inspect is free of writes.


## Projects and adopted positions (T08)

The complete product fixture uses the same native send intent and SDK admission
path as T07. After installing the full APK pair, run:

```powershell
adb -s $device shell am instrument -w -r -e class 'dev.durableagent.probe.ProjectApplicationTest' -e realProvider true dev.durableagent.probe.test/androidx.test.runner.AndroidJUnitRunner
```

This is three methods: sixteen shared real SDK/SQLite policy callbacks, the actual
React project flow with fixture transport and a fresh host reopen, and the opt-in
real MiMo flow. The latter requires an encrypted validation capsule and makes two
explicit inputs, each using the debug `location_witness` tool followed by an answer
(four requests total). The witness only observes the adopted environment; it
performs no filesystem or shell access. Activity recreation is enabled by default;
`recreateActivity=false` records its omission. A real-provider test reconnects to
the same host; only the fixture case claims fresh-host zero-request reopen.

The native location fence matrix is independent of Node and model credentials:

```powershell
adb -s $device shell am instrument -w -r -e class 'dev.durableagent.probe.NativeProjectFenceTest,dev.durableagent.probe.NativeProjectFenceCrashTest,dev.durableagent.probe.NativeSubmissionStoreTest' dev.durableagent.probe.test/androidx.test.runner.AndroidJUnitRunner
```

Its seventeen methods cover complete trusted context publication, old snapshot
ordering, native intent/edit orderings, continued drafts/stops/ACKs, v2/v3→4
migration and four actual separate-process kill windows around begin/finish
COMMIT. The current fence table singleton is required; malformed or missing state
fails closed. Generic WebView input actions cannot forge fence finish or SDK ACK.
The native-only artifact used for early tests omits UI/runtime assets and must not
be used to launch the product Activity. See [T08 evidence](../docs/evidence/t08/README.md)
for exact candidates and results, and [runtime policy](../runtime/PROJECTS.md) for
canonical recovery, lifetime checks and T09/T10 integration limits.

T08 test observers retry only `INPUT_STORAGE_BUSY` for the explicit public query
allowlist (`sendStatus`, `open`, `list`, `history`, `projects.get`) for at most two
seconds, with recorded counts. They never retry send or configuration mutations.
`open` may publish current native metadata; this is not a claim that every query
has no maintenance writes. Whole-run completion is observed separately from SDK
submission settlement before model-request/tool-witness assertions.

The project fixture deliberately creates its first pending intent through the
independent native authority. Before its second UI send, it waits for the exact
local text to be saved. If that external ACK advanced the draft revision, the
test clicks the real “保留本地内容并重试” control once, verifies the unchanged text
and confirmed save, then sends once. `recoveredDraftConflict` records which path
occurred; the four-request, two-witness and reopen checks remain mandatory.

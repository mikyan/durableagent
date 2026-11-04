# Actual product lifecycle, without instrumentation

Root holds the Android device lease and controls actual network, keyguard, reboot and force-stop. These scripts require the already configured product MiMo connection `recovery-validation`; no credential import or configuration changes occur. All model requests are real. Only a marker reply is requested, no tools or file writes. Use a fresh output prefix/directory and one new UI-created conversation for every scenario. Preserve failed inputs; never resend them to turn a failure into success.

The earlier `RecoveryLifecycleTest` was never executed and has been removed. Android 16 [ActivityManagerService](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android16-release/services/core/java/com/android/server/am/ActivityManagerService.java) normally force-stops the target package at both instrumentation start and finish (`start instr` / `finished inst`). Starting a no-binding instrumentation observer is therefore still intrusive; merely ending preparation can also terminate its owner. The retained old artifact is invalid for lifecycle acceptance. None of the scripts below calls instrumentation.

## Preparation

Prerequisites: no other active product work, no active instrumentation, no existing AgentActivity record. Root records original networking, unlocks once, disables actual Wi-Fi and mobile data, confirms no connectivity, then runs:

`node tools/recovery-lifecycle-process.mjs prepare emulator-5582 <new-prefix>`

The driver opens the normal product Activity, attaches only to its bundled WebView, reads public list/configuration, then physically clicks the visible Create control through CDP mouse input. It enters a unique marker prompt through React input handling, waits for the native durable save and UI receipt, clicks Send exactly once, and waits for the original submission row and pending UI action to settle before reading public intent/admission plus actual network-offline wait. It matches that row's identity to the durable intent. A section refresh error is retained separately and is not treated as a failure of an ongoing send. The first reboot preparation demonstrated this distinction: it reported a stale section error, although the same original input had durable admission and was waiting offline; it was stopped, not resent. The driver changes no existing model/default. A failed or uncertain send is retained and never retried automatically.

It then closes CDP, presses actual Android Back to finish the Activity, verifies no remaining AgentActivity and the same foreground owner, and exits as an external desktop process. This exit has no Android instrumentation completion behavior. `<prefix>.json` records product, run, text, original intent/admission and PID. A screenshot and service dump prove the preparation surface and foreground state. No complete HTTP count is claimed; Android offline conditions and public waiting state are the request gate evidence.

## External completion evidence

After root applies the intended lifecycle condition, use:

`python tools/recovery-external-observer.py emulator-5582 <prepared.json> <new-observation-directory> --wait 120`

For later-lock validation add `--require-locked`; the script requires an actual `deviceLocked=true` record in dumpsys trust throughout observation. Root additionally checks the captured trust/user records identify the current primary user and establish that first unlock already happened.

The observer only runs `dumpsys`, `pidof` and `run-as` reads. It does not open an Activity, bind/start a Service, send broadcasts, resolve credentials or open the SDK. It waits until ApplicationService is absent from actual service records, then copies only `no_backup/recovery-input-v1/recovery.sqlite` twice with matching bytes and no ApplicationService record before/after. Before, between and after the copies, the rollback journal must be absent or exactly zero bytes; WAL and SHM must be absent. The report records every observed journal size. Android may retain a zero-length rollback journal and cache the `:agent` process after Service destruction; neither is evidence of an active owner. The report records the cached PID and does not claim process exit or a file-lock proof. The local copy is opened with SQLite `mode=ro&immutable=1`; integrity_check must pass. Completion requires this product's `done` projection, stable completion identity and matching durable outbox row. Notifications and pending-intent records are captured afterward as corroboration, without executing the pending intent. Private observation dumps stay local until root audits any public excerpts.

The extra Service-exited requirement may delay observation after durable completion. If the Service remains registered or any snapshot condition is uncertain, the script times out without claiming completion. Do not open the app to convert that timeout into automatic recovery success. Root may diagnose retained state separately. The first later-lock observation required PID exit and timed out even though actual service records were empty; the second required rollback-journal absence and encountered an actual retained zero-byte journal. Retain those observations separately, then run a new external observation of the same work without reopening the app. A nonempty journal is still rejected; no recovery/rollback is performed on the device or by the read-only local copy.

## Scenarios

1. **Later lock:** prepare offline, lock through the real keyguard, verify user has already been unlocked, restore network while still locked, then external observer with `--require-locked`. Do not open the Activity or instrumentation before the external proof. Unlock only afterward for public history verification.
2. **Whole-device reboot / first unlock:** prepare offline, reboot the actual emulator, and before first unlock use only external shell to record locked-user / CE-unavailable state and absence of the agent. Restore network as needed, unlock the real keyguard once, then wait for ordinary boot/unlock receiver and JobScheduler. Run the external observer before any Activity or instrumentation. Capture actual Android refusal if recovery is denied; do not force-run jobs or send synthetic broadcasts. No fixed wake latency or OEM scope is claimed.
3. **Force-stop:** prepare offline, execute actual `am force-stop dev.durableagent.probe`, restore network, then use the external observer with `--stopped-interval --wait 30`. It requires the package `stopped=true` and no agent for the entire interval; it rejects any observed completion of the original pending work. Never launch instrumentation or any app component during this interval. Root then performs the explicit user-style launcher reopen (`am start -W -n dev.durableagent.probe/.AgentActivity`), waits for the same input to complete, and presses Back to let the owner exit. Run the external completion observer afterward. This is user-reopen recovery, not automatic recovery across force-stop.

Root must retain/recover the managed Termux daemon through its existing public gateway after reboot if file tools are needed later. These marker-only lifecycle scenarios do not replace or initialize Termux.

## Final public verification

Only after external proof reports `completed:true`, with no current AgentActivity and user now unlocked:

`node tools/recovery-lifecycle-process.mjs verify emulator-5582 <new-prefix> <prepared.json> <observation-directory/result.json>`

The driver opens the normal Activity, uses read-only public application methods, compares the original admission byte-for-field, requires original intent DONE, exactly one original user input, real assistant marker and zero tool executions, then closes Activity/CDP. It never sends another input. Restore previous network/display configuration after the scenario. No test result exists until root actually runs these scripts and checks the records.

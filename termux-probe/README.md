# T03 Termux managed startup probe

This is an API 36 **validation fixture**, separate from the product host in `android/`. It implements the agreed high-level “initialize / inspect execution environment” Interface through a real cross-UID RUN_COMMAND call. It does not run the Agent or implement T09 command streaming, T12 receipts, or a general RPC server.

## Build and run

Use JDK 17 and an Android SDK containing platform 36 / build-tools 36.0.0. Set `JAVA_HOME` and `ANDROID_HOME` for the build process, then:

```powershell
.\gradlew.bat testDebugUnitTest assembleDebug lintDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`. Package/activity: `dev.durableagent.termuxprobe/.MainActivity`. The pure Kotlin fixture runs on ARM64 and x86_64; x86_64 is an emulator test seam, not an added product support promise. Gradle 8.13 distribution checksum is pinned, and wrapper scripts/jar are from Gradle v8.13.0 (jar SHA256 `81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f`). AGP 8.11.1 supports API 36 with Gradle 8.13 / JDK 17; Kotlin plugin 2.2.20 is fixed. No dynamic dependency versions.

The screen explains the one-time process, has a complete setup-copy button, system authorization button, official release link, and separate facts for installation, bootstrap, external calls and protocol. Start/resume automatically inspects while the Activity is visible. Explicit checks coalesce. The Activity holds `FLAG_KEEP_SCREEN_ON` only while this validation screen is visible; no global device setting is changed by the app.

Install/open the fixed official Termux and allow its initial bootstrap to finish. Copy the entire `app/src/main/assets/setup.sh` block into that Termux terminal. It enables `allow-external-apps`, backs up changed properties in the fixture directory, preserves unrelated settings and installs the short-lived probe. Then grant RUN_COMMAND to this fixture using Android's prompt and check. The app never silently opens Termux as a daily workaround, changes Termux config, installs packages, or overwrites an existing Termux APK. An existing different release is diagnosed as unverified and must be preserved for compatibility review.

## Trust, lifetime and diagnostics

`AndroidTermuxGateway` validates exact package version, actual signing certificate, and complete installed APK hash before dispatch. Full APK hash matters because the upstream GitHub debug signing key is public. It accepts only the pinned official ARM64 APK and official x86_64 test APK; this fixture makes no assertion about F-Droid/Play variants. The explicit service component is `com.termux/com.termux.app.RunCommandService`; permission is `com.termux.permission.RUN_COMMAND`.

The only command is fixed: `/data/data/com.termux/files/usr/bin/bash`, invoking this fixture's bridge under a 12-second `timeout` with a 2-second kill grace. No Intent extra from another app becomes executable text. A new random challenge is bound to an explicit, non-exported, one-shot mutable PendingIntent receiver using immutable Intent data. Only that capability is handed to the verified Termux package. The controller then requires matching challenge, actual installed Termux UID, protocol 1, positive process instance ID, shell, tools, expected workspace, verified write/read, success exit and complete untruncated output. Callback arrival alone is insufficient.

The Application owns the current probe and observers detach when UI stops. This is not a keepalive service. On the S23, the first service start after a host cold launch sometimes returns null during Samsung background management. Only that null result is retried, within 3 seconds, using the same challenge and PendingIntent. Package hash, stopped flag and permission are revalidated before every retry. An accepted (non-null) start, callback, revoked prerequisite or deadline stops retries. Null does not prove that Android never accepted the operation. This is permission to repeat this fixed harmless probe only; it is not a policy for replaying arbitrary T09 commands.

A kernel `flock` prevents overlapping probe execution across host process death and retry; no long-lived daemon is created. At 20 seconds the controller releases the request as **unknown timeout**; late, duplicate and unrelated callbacks cannot make a new attempt ready. Samsung freezing can suspend the remote shell and its `timeout` watchdog together: the 12+2-second watchdog is not a wall-clock termination guarantee, and host timeout does **not** prove remote execution stopped. A host restart begins unchecked; the previous atomic diagnostic is labeled historical and is never restored as readiness. Termux force-stop is detected from the platform stopped flag and requires explicit user reopening, unlike ordinary process recycling.

Missing/revoked permission, explicitly reported external-config rejection, missing setup script, protocol mismatch, concurrent execution, Android service-start restrictions, invalid output and unknown timeout are distinct. If Android does not supply enough information to establish bootstrap/config state, it remains **UNKNOWN**. No timeout is relabeled “not initialized.” Notification/channel and OEM restrictions are observations recorded during device validation; another app's notification grant is not guessed from this fixture's grant.

## Reproducible validation

`EnvironmentInspectorTest` exercises the public initialization/inspection boundary with controlled external platform facts and completion evidence: installation preconditions, coalescing/deadlines, full success, stale/revoked/truncated/wrong-UID proof rejection and distinct failures. `scripts/test-setup.sh` runs setup in an isolated home, replacing only the Android reload command; it checks duplicate property handling, repeat setup, preserved unrelated settings and executable installation. Run it with Bash (Git Bash works on Windows).

On an explicitly authorized test device, `scripts/test-cold-start.ps1 -Device SERIAL -Adb PATH -Iterations 3` reproduces the real lifecycle seam. Each iteration terminates only the Termux process (its own UID), verifies recovery through the fixture, lets Android reclaim the background fixture using `am kill`, then verifies a fresh cold-start READY. It records each action and diagnostic, rejects stale evidence and exits nonzero on failure. It never force-stops, clears, uninstalls or opens the Termux Activity. Do not run this process-death test against a Termux session with unrelated active work.

Real device results and remaining gate rows belong in [validation.md](validation.md). The fixture becoming READY once does **not** close T03; ordinary cold start/recovery and the other required rows must pass without repeated manual terminal opening. If that hard gate fails, review the deployment route.

For an authorized connected test device, these commands install only this fixture and read its diagnostics. Device operations are intentionally outside the build:

```text
adb -s SERIAL install -r app/build/outputs/apk/debug/app-debug.apk
adb -s SERIAL shell am start -W -n dev.durableagent.termuxprobe/.MainActivity
adb -s SERIAL shell run-as dev.durableagent.termuxprobe cat no_backup/last-inspection.txt
adb -s SERIAL logcat -d -s DurableAgentProbe:I
```

Use the actual UI to grant RUN_COMMAND. For permission-revocation injection on a test device: `adb -s SERIAL shell pm revoke dev.durableagent.termuxprobe com.termux.permission.RUN_COMMAND`, then resume the fixture and verify `PERMISSION_REQUIRED`. Regrant through the UI and check again. Never use `pm clear` or uninstall Termux for recovery testing. Force-stop injection is a separate row and must not be used as evidence for ordinary process death. A `run-as` diagnostic read is test-only; normal readiness comes exclusively through RUN_COMMAND and the PendingIntent.

## Pinned sources

- [Official Termux v0.118.3 release](https://github.com/termux/termux-app/releases/tag/v0.118.3), source commit `5b657c6adf4304e5198951ce815fe0205dcac29c` (release May 22, 2025; checked November 4, 2026).
- [Pinned RUN_COMMAND service](https://github.com/termux/termux-app/blob/5b657c6adf4304e5198951ce815fe0205dcac29c/app/src/main/java/com/termux/app/RunCommandService.java) and [wire constants](https://github.com/termux/termux-app/blob/5b657c6adf4304e5198951ce815fe0205dcac29c/termux-shared/src/main/java/com/termux/shared/termux/TermuxConstants.java).
- [Official API guide](https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent), [Android PendingIntent](https://developer.android.com/reference/android/app/PendingIntent), [AGP 8.11 compatibility](https://developer.android.com/build/releases/agp-8-11-0-release-notes).

Wire format, 3-second startup / 12-second shell-watchdog / 20-second caller bounds, one-shot probe, exact release pin and fixture UI are agent refinements within the accepted T03 seam. A production upgrade policy, full execution transport and automated boot work remain with their owning tickets.

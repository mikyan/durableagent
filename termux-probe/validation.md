# T03 validation evidence

2026-11-04, Galaxy S23 (Samsung SM-S9110), Android 16 / API36, ARM64, 4096-byte pages. This document distinguishes observed results from outstanding acceptance rows. Pending is not a pass; this is not yet a claim that T03 is complete.

## Fixed artifacts

| Item | Verified value |
| --- | --- |
| Final fixture | `dev.durableagent.termuxprobe`, source `acdc000`, compile/target36, min31 |
| Final fixture APK SHA256 | `197a869eb00af13d643e859342bc26ddd45341b5e7f7778b79c9c23b5be93bb6` — matched independently on host and installed `base.apk`; [record](evidence/s23-final-artifact.txt) |
| Official Termux | `com.termux`, version0.118.3 / code1002, actual target28 / compile30 |
| Termux source | `5b657c6adf4304e5198951ce815fe0205dcac29c` |
| Termux certificate SHA256 | `b6da01480eefd5fbf2cd3771b8d1021ec791304bdd6c4bf41d3faabad48ee5e1` |
| Official ARM64 APK SHA256 | `72fdb596045116bf5ba1b5bdf5b26fddb9acc0bd074ad9f2da9eb0ae85e83a4e` |
| Official x86_64 test APK SHA256 | `3550e61f4d9eb49b712fd1bd9519dc37085a4d8eb597c57a340f0a64859b7144` |
| Build | JDK17.0.19 / Gradle8.13 / AGP8.11.1 / Kotlin2.2.20 / SDK36 / build-tools36.0.0 |

Official APK/checksums came from the pinned release. `apksigner`, `aapt dump badging`, SHA256 and the actual fixture's package inspection verify these facts. The public GitHub debug certificate alone is not provenance. The fixture keeps target36 and its own UID; it does not use Termux's older target to claim indefinite execution.

Artifact attribution: the [earliest root-observed READY](evidence/s23-first-cross-uid.txt) proves behavior, but that installed **fixture** APK hash was not captured unambiguously while builds were changing; no precise fixture hash is asserted for that sample. Termux's `72fdb…` hash was in the actual diagnostic and is exact. The first implementer campaign used fixture `1f7781f` / `54ca5b…`. Protocol/permission/deadline/bridge fault injections used `a7e6f…`, independently read back from installed `base.apk`, with the retry implementation before its final strict overdue-attempt guard. Final acceptance for ordinary startup uses the independently pinned `acdc000` artifact above and fresh repeated observations, not the ambiguous early build.

## Local engineering checks

Nine public inspection tests, `assembleDebug` and `lintDebug` pass. Tests cover prerequisites, coalescing/deadlines, complete execution evidence, stale/revoked/truncated/wrong-UID rejection, known failures, the real Termux wire format, fresh-platform-verification failure and bounded same-request startup retry. `scripts/test-setup.sh` passed after first reproducing a duplicate-property bug; it checks final active value, repeat setup, preserved settings and executable installation. Lint has zero errors; warnings concern intentional compiled Termux prefixes and single-language fixture diagnostics.

The first S23 callback exposed upstream success `err=-1` (Android RESULT_OK) and String output-length fields. Fixed against pinned upstream `Errno` / `ResultSender`; regression tests reject missing status and inconsistent lengths. Desktop/controller results are not Android lifecycle evidence.

## Real device matrix

Root coordinates exclusive ADB ownership. No Termux data was cleared, uninstalled or migrated. Fault injection changed only this newly installed test Termux, its fixture script and its backed-up properties. Script/properties were restored byte-for-byte using `cmp`; RUN_COMMAND was restored through Android UI; no probe/sleep process remained at final handoff. USB stay-awake was the user's separate temporary setting and is left for root to restore.

| Scenario | Observation |
| --- | --- |
| Install/bootstrap/full setup | PASS. No prior user0 Termux existed; clean official install reached shell. [Fixture Copy → native Termux Paste → Enter → return READY](evidence/s23-copy-setup.txt) passed and terminal confirmed configured. Existing configuration was preserved |
| Authenticated/versioned cross-UID command | PASS on final pinned artifact: [fresh READY](evidence/s23-final-ready.txt), actual UID10187, protocol1, Bash5.3.20, required tools, expected writable workspace and actual package source |
| Ordinary host cold start | PASS after transient-start fix: [three final COLD cases](evidence/s23-cold-loop-final/iteration-1-host-cold-start.txt), [second](evidence/s23-cold-loop-final/iteration-2-host-cold-start.txt), [third](evidence/s23-cold-loop-final/iteration-3-host-cold-start.txt). Host process was absent after Android `am kill`. No terminal opening or command paste occurred |
| Termux process death | PASS, distinct from force-stop: [three final cases](evidence/s23-cold-loop-final/iteration-1-termux-process-death.txt), [second](evidence/s23-cold-loop-final/iteration-2-termux-process-death.txt), [third](evidence/s23-cold-loop-final/iteration-3-termux-process-death.txt). Only exact com.termux PID was killed using its own UID; earlier platform inspection confirmed stopped=false |
| Host process recycle | [PASS](evidence/s23-host-process-recycle.txt), exact host PID killed using its own UID and only fixture reopened. The final cold-start loop independently repeats Android reclamation. Activity recreation is not inferred from this test |
| Short bridge process death/recheck | PASS for this per-request bridge: exact in-flight bash PID killed; real result [exit137, never READY](evidence/s23-bridge-killed-result.txt), then restored script and [fixture-only recheck READY](evidence/s23-bridge-death-recovered.txt). There is no persistent bridge daemon |
| Duplicate checking | PASS for bounded ownership: 11 clicks while a deliberately delayed bridge ran retained [one request/challenge](evidence/s23-repeat-checking.txt) and [one bash plus one timeout supervisor](evidence/s23-repeat-live-processes.txt). No second execution bridge was created |
| Deadline/late recovery | Real Samsung freeze of injected sleep8 caused [UNKNOWN_TIMEOUT](evidence/s23-repeat-complete.txt) at about20.05 seconds. Remote watchdog/process also froze, so no remote-death claim. With original script restored, [one retry reported actual service-kill exit137](evidence/s23-delayed-probe-retry.txt), then [fixture-only READY](evidence/s23-delayed-probe-recovered.txt); no terminal reopening |
| RUN_COMMAND revoke/regrant | [PERMISSION_REQUIRED](evidence/s23-permission-revoked.txt) after real pm revoke, followed by real Android permission prompt and [READY](evidence/s23-permission-restored.txt) |
| External-call config disabled | [EXTERNAL_CALLS_DISABLED](evidence/s23-config-disabled.txt), upstream err2 after saved property file was appended with false and read back. [Exact restoration → READY](evidence/s23-config-restored.txt), no terminal opening |
| Incompatible protocol | [PROTOCOL_MISMATCH](evidence/s23-protocol-mismatch.txt) after replacing only protocol1 with2 in the fixture; [restoration → READY](evidence/s23-protocol-restored.txt) |
| Force-stop | [FORCE_STOPPED](evidence/s23-termux-force-stop.txt) before dispatch after actual force-stop. [Explicit reopening](evidence/s23-force-stop-restored.txt) restored this distinct user-stop test; it is not a normal recovery workaround |
| Platform start restriction | Actual Samsung null-service transient and idle/freezer behavior recorded below. Typed Android start-exception classification is covered at the controlled controller seam; an actual `ForegroundServiceStartNotAllowedException` was not fabricated or observed on this foreground path |
| Notification/channel/OEM facts | Termux notification prompt explicitly denied, `importance=NONE userSet=true`. App/run-command channels importance2, plugin-error channel4. [Scoped facts](evidence/s23-notification-facts.txt). Foreground invocation can complete in this state; it does not establish sustained background execution |
| Screen lock/resume | Pending root-coordinated real lock and user unlock. Do not count ADB launching an Activity behind keyguard as a normal user path |
| Reboot/first unlock | Pending root-coordinated reboot and first user unlock, then open only the fixture. Do not open Termux first |
| Package ecosystem | PASS, actual root-run package test exit0: jq1.8.2 + oniguruma6.9.10-1 installed; jq operated on Unicode JSON/regex. Bash5.2.37-2→5.3.20, coreutils9.6-1→9.12, readline8.3.6/OpenSSL3.6.5 dependencies. Existing configs retained at dpkg prompts. Official pkg chose packages-cf.termux.dev; post-upgrade cross-UID probe confirms actual Bash5.3.20 |

## Reproduced cold-start failure and fix

The original [failure](evidence/s23-ordinary-cold-start.txt) returned null from `startForegroundService`. [System evidence](evidence/s23-cold-start-platform-log.txt) simultaneously showed calling UID TOP / FGS Allowed and Samsung Freecess/app-idle stopping RunCommandService. The real `scripts/test-cold-start.ps1` loop reproduced the same symptom; another fixture check worked without opening Termux. Thus a permanent setup failure was not established.

The fix retries only a null return, at250/500/1000/1250 ms within a3-second ceiling, reusing the same random challenge and explicit PendingIntent. Every attempt rechecks package identity, permission and stopped state. Accepted start, callback or changed prerequisites stop retries. Final device loops passed6/6; the [retry log](evidence/s23-final-retry-log.txt) shows the same nonce surviving the initial null and the250 ms retry. Null does not prove Android never accepted the operation. This benign probe is safe to repeat; T09/T12 must decide arbitrary-command effects using their own receipts and evidence rather than copying this replay policy.

Samsung freezing also delayed a real injected shell task and its local watchdog:12+2 seconds is not a wall-clock remote termination guarantee. The caller's20-second timeout is an uncertainty boundary, not cancellation evidence. Preserve this fact for T08/T09/T12; no battery exemption, specialUse service, permanent wake lock or vendor-global setting was introduced.

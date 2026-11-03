# T03 validation evidence

Local engineering baseline: 2026-11-04. This document distinguishes observed results from outstanding acceptance rows. It is not a claim that T03 is complete.

## Release and build

| Item | Verified value |
| --- | --- |
| Host fixture | independent `dev.durableagent.termuxprobe`, compile/target 36, min 31 |
| Official Termux | `com.termux`, version 0.118.3 / code 1002, actual target 28, compile 30 |
| Source commit | `5b657c6adf4304e5198951ce815fe0205dcac29c` |
| Certificate SHA256 | `b6da01480eefd5fbf2cd3771b8d1021ec791304bdd6c4bf41d3faabad48ee5e1` |
| Official ARM64 APK SHA256 | `72fdb596045116bf5ba1b5bdf5b26fddb9acc0bd074ad9f2da9eb0ae85e83a4e` |
| Official x86_64 APK SHA256 | `3550e61f4d9eb49b712fd1bd9519dc37085a4d8eb597c57a340f0a64859b7144` |
| Build | JDK 17.0.19, Gradle 8.13, AGP 8.11.1, Kotlin 2.2.20, SDK/build-tools 36/36.0.0 |

Release APKs and checksums are fetched directly from the official release. `apksigner verify --print-certs`, `aapt dump badging` and SHA256 verify artifact facts. The fixture does not exploit the older Termux target to lower its own target or claim indefinite execution. The public debug certificate alone is not provenance.

## Local tests

`testDebugUnitTest`, `assembleDebug`, `lintDebug` passed. Seven public inspection tests cover missing install, platform preconditions, bounded coalescing, actual-evidence validation, stale/revoked/incomplete proof rejection, known failures and the actual pinned callback wire format. The first S23 callback exposed success `err=-1` (Android RESULT_OK) and String output-length fields; the decoder was corrected against pinned upstream `Errno` / `ResultSender` and a regression test rejects missing codes and inconsistent lengths. The setup script's duplicate-property test first reproduced disabled effective configuration, then passed after checking the final active property. The initial online build fetched missing lint tooling; the subsequent build can use the cache. This is controller/build evidence, not an Android cold-start result. Lint has no errors; remaining warnings are deliberate Termux compiled-prefix paths and single-language diagnostic text in this fixture.

## Device matrix

Root integration owns ADB and records actual observations here after validating the runnable APK. Pending is not a pass.

| Scenario | Status / required evidence |
| --- | --- |
| Clean install and first bootstrap/setup | S23 Android 16 / API36 / ARM64 / 4 KB pages: root observed normal shell and completed setup; cross-UID fixture run pending |
| First cross-UID command / RUN_COMMAND grant | Pending fixture run and complete READY output |
| Ordinary fixture cold start | Pending, do not open Termux as a workaround |
| Bridge process death | Pending; this bridge is a bounded per-request process, no daemon |
| Termux process death | Pending distinct from force-stop |
| Host process recycle / Activity recreation | Pending actual Android result |
| Reboot / first unlock | Pending actual reboot and unlock |
| Repeated clicks / timeout retry | Controller proven; actual Android observation pending |
| Missing/revoked RUN_COMMAND | Controller proven; actual revoke/regrant pending |
| Disabled external config / protocol mismatch | Controller proven; actual test fixture fault injection pending |
| Force-stop / start restriction / unknown timeout | Distinct controller results; actual platform row pending |
| Notification/channel / screen lock / OEM settings | Pending recorded device facts |
| Packages install/run/upgrade | Root S23 execution exit0: `jq 1.8.2` + `oniguruma 6.9.10-1` install, jq runs; Bash `5.2.37-2 → 5.3.20`, coreutils `9.6-1 → 9.12`, readline `8.3.6` and OpenSSL `3.6.5` dependencies. Official pkg selected `packages-cf.termux.dev`; existing config retained at dpkg prompts. Post-upgrade cross-UID probe pending |

The package demonstration shows real `pkg`/`apt` capability and representative dependencies, not compatibility with every Linux package. Evidence currently supplied by root is in the local implementation evidence directory; final accepted device observations must be reconciled here before closing #4.

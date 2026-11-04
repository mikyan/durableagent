# Reproducing T13 checks

Use the pinned dependencies in the lockfiles, Node22.19 or newer, JDK17 and
Android SDK36. From the repository root, independent host suites are:

```powershell
npm --prefix runtime ci
npm --prefix ui ci
npm --prefix runtime test
npm --prefix ui test
```

The focused real-SDK regression file is `runtime/test/data-saver-documents.test.mjs`.
After `npm --prefix runtime run build`, run
`node --test runtime/test/data-saver-documents.test.mjs` from the repository root.
It covers pre-admission policy/channel contention, uncertain dispatched results,
fixed snapshot-page contention and lost policy acknowledgements without opening
an Android Provider. The separate `data-saver.test.mjs` covers final prepare
mutations, nested SDK calls, host-death safe replay and pending-tool continuity.

From `android/`, build with:

```powershell
.\gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug --console=plain
```

The build recompiles and packages runtime/UI before APK creation. Retain APK
hashes, full source manifest and instrumentation output for each candidate.
Do not infer an APK's tested source from Git HEAD when a worktree was dirty.

## Native configuration and metadata cases

These cases need an unlocked API36 emulator and matching debug app/test APKs;
they need no configured model, Termux owner or selected original:

| Class and method under `dev.durableagent.probe` | Required observation |
| --- | --- |
| `InputApplicationTest#configuringNewUiBridgeDoesNotWaitForAnotherStoreLease` | New bridge construction on main completes while old native read still waits for an externally held OS lease; release then completes the same old read |
| `InputApplicationTest#publicInputFreezeWaitsForShortNativeLeaseWithoutRetryingTheAction` | One public freeze waits for a150ms lease, emits one response, retains one frozen input; unreleased lease fails visibly within the bounded wait; no sends/models |
| `DataSaverProviderTest#nativeProviderProjectionMakesUndispatchedEvidenceExplicitAcrossReopen` | Explicit false across registration/reopen/grant; true after committed dispatch and reopen |

Run an individual selector using the installed test runner, for example:

```powershell
adb -s $testDevice shell am instrument -w -r -e class dev.durableagent.probe.InputApplicationTest#configuringNewUiBridgeDoesNotWaitForAnotherStoreLease dev.durableagent.probe.test/androidx.test.runner.AndroidJUnitRunner
```

For the construction RED/GREEN, use **the same497E test APK** with FEDF and0AE,
respectively. The original frozen test is
`D:/durableagent-validation/t13-ui-config-red01/test.apk`, SHA256
`497e5f215392dd2a2fa7ccd8d0a1c784227cccf698e54155fcb229d51599a72f`.
Use the exact BB5 test for the separate projection RED/GREEN. Candidate hashes
and actual outcomes are in [README](README.md); do not run old failed inputs
again to change their historical result.

Recorded final native result:0AE plus unchanged497E test passed both construction
and public freeze cases,2/2 in8.932s. Construction1ms, one freeze response200ms,
unreleased lease failure1048ms. The exact log is
[t13-ui-config-green01-device.log](t13-ui-config-green01-device.log).

## Integrated execution and visible UI

Use a retained official Termux installation already paired with the validation
app and its matching three-module executor. Keep existing ledger/pairing/data.
After an emulator cold start, verify the actual public connection before testing;
installing an APK or observing stored pairing is not proof that the daemon runs.
The connect-only fixture is
`ExecutionTransportTest#productionBootstrapUsesRealTermuxAndPersistsVerifiedPeer`
with `-e executionProduction true`; it uses the already installed environment.
It does not authorize executing a setup/replacement command.

Set the test network to a known metered state, record Android's queried fact and
the prior override, and restore the prior override in a host-side `finally`.
Do not rely solely on the override command's exit code. Then run one selected
`DataSaverExecutionTest` method:

| Method | Additional precondition and expected evidence |
| --- | --- |
| `actualReactSingleGrantKeepsGlobalPolicyAndTheNextIdentityWaiting` | Use2727 test or newer; actual enabled fixed-operation button receives one trusted pointer/click, first operation finishes, second explicit input waits with no inherited grant, global setting stays enabled, explicit UI stop settles second;3 controlled requests |
| `actualLocalFilesAndFixedBashContinueWhileAnotherConversationWaitsForPolicy` | Existing authenticated local capability proof; three local operations finish without grants while original unknown shell waits |
| `actualSdkOriginalReadAndWriteNeedIndependentPolicyGrants` | Dedicated synthetic original and retained actual system-picker read/write grant; separate read/write grants, local work continues during write wait,6 controlled requests, fresh owner0 added requests |
| `actualMimoOriginalReadAndWriteNeedIndependentPolicyGrants` | Same original precondition plus one-use encrypted real-model provision, `-e realProvider true`;4 actual HTTP requests, independent read/write grants, separate normal Termux original read |

Provider fixtures use only the dedicated synthetic URI
`content://dev.durableagent.documentsfixture.documents/document/original`.
Record old/new digest and verify final bytes outside the application through
normal Termux. Private credential provisioning and exact credential audit remain
outside public artifacts; never put a key in instrumentation arguments or logs.
The real-mode fixture fixes registered `tool_choice`; it is not a model autonomy
test and does not reopen a consumed credential capsule.

For screenshots, wait for enabled exact identity, viewport hit-testing and a
WebView visual-state/frame barrier, then capture and **inspect the actual PNG**.
Retain pointer coordinates and trusted DOM event targets. An assertion or a saved
PNG path alone is not visible proof. The retained08 failure demonstrates why
visibility without enabled state is inadequate.

Recorded final UI result:0AE+2727 [actual09](t13-react-grant09-device.log),1/1
in19.688s. One trusted pointerdown/up/click reaches the same enabled first
identity; the second identity waits and UI stop settles it. Both current-ID
screenshots were inspected. The next row's top label is clipped by scrolling,
while its identity, scope and button are visible. The retained network query
confirms the original `AndroidWifi;none` override was restored.

The actual download cutover requires the separate host HTTP server and externally
coordinated network transition used in [cutover03](t13-cutover-actual03/events.json).
Preserve its server and transition logs; do not replace this device experiment
with the host's controlled transport tests. OEM lock/reboot coverage remains T17.

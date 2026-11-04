# T09 independent scoped development gate

Reviewed on 2026-11-04. **PASS for the documented development scope**, with no
remaining concrete blocking finding from the independent native/Python and
SDK/Interface reviews. This does not replace the final review of all seventeen
tickets or the outstanding physical-device acceptance.

Exact owner commit: `b0ccf8db38f4ef87ee23179ab12500d080a1b596`.
Local no-fast-forward merge: `6b8df018ef170d13126ef1a6a46e4927ed7d9d50`.
Parents are integration `46fe4e7862dcdf264865ecec174ef8c3a57f1dc7` and that exact
owner. Merge tree `58f4959f55aaa80df0c2da6dce638073d56af308` matches the owner
tree exactly. This report is a separate subsequent documentation commit.

## Reviewed contract and findings

The [validation record](../VALIDATION.md) and the separate
[native/Python](native-python-review.md), [SDK/Interface](sdk-interface-review.md)
and [dispatch classification](dispatch-failure-review.md) reviews cover the
eleven ticket criteria:

| Criterion | Scoped supporting evidence |
| --- | --- |
| 1. One SDK tool environment | Fixed Bash/ExecutionEnv through native authenticated transport; actual React/SDK/Termux flow, no WebView command/start endpoint. |
| 2. Durable invocation identity | Session-scope task/call/ordinal identity and exact request/context committed before prepare; receipt survives reopen. |
| 3. Dedupe and uncertainty | Canonical request/final digest, same-ID replay, lost-start response and persistent cancellation tombstone; unknown cannot be replaced by a new identity. |
| 4. Truthful states | Native scope evidence and UI uncertainty correction; non-cancellation readiness/model failures no longer become false aborted results. |
| 5. Execution parameters | Four unchanged SDK shell cases on real Termux; separate shell/argv, frozen environment and directory identity checked through a held fd. |
| 6. Bounded ordered output | Stream/sequence and incremental decoding, 1.2 MB real output, exact SDK window/discard counts, raw and chunk quotas plus final-parameter limits. |
| 7. Reconnect and complete output | Same execution/cursor; actual 1.2 MB raw output through the same ExecutionEnv, length/SHA and byte comparison. |
| 8. Scoped cancellation | Live guardian/subreaper and verified pidfds; lost supervision stays unknown; native cancel while Node is busy has actual device evidence. |
| 9. Fault windows | Executor-side actual process/effect failures and four Android runtime-owner kills; recovery queries existing identity and checks real file effects. |
| 10. Authenticated local boundary | Loopback-only mTLS, Keystore identity, server pin, ledger/session/request verification, fixed bootstrap and bounded framing. |
| 11. Actual minimal page | Success, exit 7, large output, native cancellation, timeout, Activity reconnect and fresh-host reopening on actual Termux. |

Native/Python production and setup files are unchanged from this reviewer's fixed
`21fc11f` inspection. Its independent public SQLite metadata subset passed 3/3;
it was not represented as process or Android proof. The SDK reviewer separately
reproduced and verified the UI uncertainty correction and reviewed the T14/T09
merge wiring. Final source retains both T14 route/source guards and T09 pending
execution/control ownership; it does not replace either with a test adapter.

## Production05 failure and production06 scope

The production05 combined run was **2/3**, not an all-green run. In the failed
six-scenario method, the first five commands reached confirmed terminal states.
The sixth input was accepted/ACKed but had no execution identity; its SDK
submission was unanswered/model_error. Read-only examination found native
generation 1, stoppedThrough 0 and no pending stop. The old error wrapper had
discarded the original exception code. Its cause cannot now be identified as
BUSY, a provider fault or an actual saved stop.

The final classification change emits aborted only for an actually aborted
signal. Other failures retain a bounded readiness/model category without raw
exception text or credentials. Independent actual SDK/SQLite differential tests
show the injected control-read error becomes error rather than aborted, with
one original user/submission, zero model calls and zero calls after reopen.
There is no added model/command retry, timeout increase or relaxed fixture.

Production06 ran the unchanged six scenarios successfully: **1/1, 48.817s**,
1,200,000 output bytes over 74 pages, and zero fresh-host model requests. The
[independent file observations](final-owned-effects.json) found success and
reconnect files each equal to the four bytes `one\n`; cancellation and timeout
delayed-effect files were absent. This pass establishes a new observed result,
not proof that the original05 triggering condition was repaired.

Production05's separate real MiMo case passed **1/1, 12.96s**, with two actual
HTTP requests, one Bash execution and exact output. Earlier process-death,
conformance, Node-busy control, resource-budget and complete-raw-output results
retain their own artifact scopes. Historical failures and the zero-test selector
mistake remain documented.

## Final evidence and merge checks

Final app: `5c2d9fc445439e1ce590c0f9e47b2a97a17e95475834e5ef5a9b39f8a9c4ff91`.
Final test: `d13b688d98e148f8f8cb4895a76c8b39fd050d6c3db58b3931163af57c825865`.

The six-scenario06 run used test `36a563432820aff14026defd3be1bb31a7f60693f63f25f8d938aecc9296c853`.
The final test only corrects the separate read-only observation's native control
route; that observation passed **1/1, 3.131s**, with no new model requests. It does
not claim a second complete matrix on the final test APK.

The merger independently verified all **15** referenced raw-log hashes, **143**
current source hashes and the final app/test hashes. APK bytes match all **51**
runtime and **11** UI files. Both native libraries match the pinned i18n hashes;
their ZIP offsets and ELF load segments pass 16 KiB alignment. The packaged
setup hash matches production04 and the recorded Python/installer source hashes.
See [final candidate mapping](final-candidate.json) and
[device evidence](android-development.json). No broad test suite was rerun merely
for merging; existing final host results are **171 runtime / 73 UI tests passed**.

Root's last public audit covered **557 files**, with no actual private key or
private device serial found. The earlier 556-file count in the candidate map is
the preceding audit snapshot. This reviewer did not access a private key or
operate a device. The merge had no conflicts or binary additions; diff-check and
clean-tree checks passed before this report was added.

The accepted device scope remains Android 16/API 36, **4 KiB x86_64 emulator**
with pinned official Termux. Native library 16 KiB alignment does not prove
Termux bootstrap on a 16 KiB image. Samsung/Xiaomi OEM, lock/reboot and T17
acceptance remain pending. T10 workspace/file coordination, T11 complete stop
fencing, T12 background/recovery policy and T13 network policy are successor
contracts, not silently accepted by this T09 gate. No arbitrary-command
exactly-once or automatic transient-failure recovery guarantee is made.

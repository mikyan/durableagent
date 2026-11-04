# T14 independent scoped development gate

Reviewed on 2026-11-04. **PASS within the documented development scope**, with no
remaining blocking finding from this ticket review. This is not the final review
of all seventeen tickets or OEM acceptance.

The reviewed owner commit is `95ec64b7035f5b99c1f6299dc55c47c9438733cd`.
It was merged without conflicts into `integration/android-agent-v1` at
`85f6e0a13417458b5cb8ba827e02782d7ae5ce75`, preserving both parents. The merge tree
`d6d85faa1016e21a1efa985800a418c0a2659a23` exactly matches the owner tree.
This report is the only subsequent documentation addition.

## Contract coverage

The [evidence README](README.md) maps all eleven ticket criteria to observable
checks. Independent source review and targeted public-interface counterexamples
confirmed the following boundaries:

| Criterion | Reviewed boundary and evidence |
| --- | --- |
| 1. UI-only / Agent-only / both | Real Timeline, routing tools and model settings; no placeholder Agent for Timeline. |
| 2. Separate bundles | Shared data-only descriptor; separate loader tables and host React; final packaged modules match source. |
| 3. History and subscriptions | Actual Android 53-record paging; unmount leaves the conversation running; stale async pages and browser errors are tested. |
| 4. SDK contribution path | Existing SDK registry, tools, sections and scheduler; no parallel registry or scheduling authority. |
| 5. Identity and overrides | Actual SDK tests cover accidental identity collisions, intentional selection order and duplicate task names. |
| 6. Truthful states | Packaged, installed, selected and actual React mount states remain distinct; failed loading is not reported mounted. |
| 7. Explicit queries | Stable target identities and bounded summaries; ordinary input remains local, without copying target context. |
| 8. Reliable transfer | Independent native input through T07 receipt/admission and T08 expected location; native four and SDK two actual process-death windows. |
| 9. Refusal and stopping | Original source generation, target control and location checks remain mandatory; accepted target work is independent of later source cancellation. |
| 10. Shared model authority | Agent and UI use the same model Interface; metadata queries do not resolve credentials; fixed core retains admission/control/storage authority. |
| 11. Diagnostics and ownership | Browser subscription failure is observable without fabricated completion; real renderer recovery and SDK resource-owner lifetime are tested. |

Four independent defects were reproduced and corrected: route ACK leaking the
target's unsent draft into source tool history, a dropped browser subscription
error, source cancellation being labelled as target stop, and a never-admitted
cancelled route permanently occupying a workspace. Their RED evidence and fixed
public tests are retained in the README. The F4 paired tests were independently
rerun, **2/2**: verified absent admission can release occupancy, while accepted
target work and unresolved effects remain busy; inconsistent facts and authority
read failures refuse the edit. No rejected location edit is applied automatically.

## Final bootstrap-close change

The final native change only affects the debug close entry point. Its request is
retained on the serialized runtime-owner thread until asynchronous bootstrap
installs `__appClose`; dispatch is marked before invocation and occurs once.
Release resets the latch. Bootstrap failure still follows the existing failure
and release path. Product stop, UI unmount and Service destruction are separate
entry points and were not redefined by this fix.

The same test APK first failed on the preceding app in **16.276 seconds**, then
passed on the final app. It observes opening before close, requires zero native
owners and a released storage domain, opens a distinct instance, and confirms a
new native draft in that new validation domain. The [final targeted run](emu16k-final-targeted.log)
passed **3/3**, zero skipped, in **39.356 seconds**, also running all twelve shared
extension policies and the existing project busy/refusal/reopen fixture.

## Artifact and evidence checks

Final app SHA256: `76312472306e912ee0ac8ffc2aae307d5e86c1b65ac0afe835dfde06b7a8aa6c`.
Final test SHA256: `76b28c8a1e21043d0c127ab1375c032b2e191f36c2da78b8db972d8dae0a3455`.

The reviewer independently verified both APK hashes, all **109** current source
hashes, exact APK/workspace bytes for **44** runtime and **11** UI entries, and
all ten log hashes and method counts in [results.json](results.json). Third and
final APK assets are byte-identical. The [final inspection](final-apk-inspection.json)
records SDK 1.5.0, pinned native-library hashes and both ABI ZIP/ELF 16 KiB alignment.
The merge contains no added binary files; `git diff --check` passed.

Existing full host results are runtime **147/147** and UI **67/67**. Real MiMo
normal ACK and separate lost-ACK cases ran on the second app: three actual
requests each, no target draft in source history or encoded requests, and zero
additional requests at the tested ACK-reconciliation/reopen boundaries. The final
debug close change does not alter those runtime/UI assets. Prior partial failures
remain published; these runs are not described as one all-green full-device run.

Root reported the final public-file audit covered **508 files**, with zero actual
key or private device-serial matches. The published credential audits are bounded
app-data/log checks, not heap or whole-device forensics. This reviewer did not
access credentials or operate a device.

Device evidence is Android 16/API 36, x86_64, **16 KiB emulator** scope. No T14
Samsung/Xiaomi execution, T09 real Termux effects, T12 background guarantees or
T17 OEM acceptance follows. Existing physical-device lock/reboot and Xiaomi
requirements remain pending. Integration with T09 must preserve its real location
adapter and unresolved-effect authority alongside these routing guards.

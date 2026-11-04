# T14 bundled extensions and explicit routing evidence

The implementation is documented in [runtime/EXTENSIONS.md](../../../runtime/EXTENSIONS.md).
The UI-only timeline, Agent-only routing and both-sided model settings use one
data-only descriptor catalog and the actual Pi Durable 1.5.0 registry. Android
uses the previously pinned Javet Node i18n 6.0.3 runtime. Tests use the public
Application Interface, real SDK/SQLite stores and native input authority.

## Candidate and device scope

All T14 device results below are from Android 16/API 36, x86_64, with **16 KiB
pages**. They do not establish Samsung/Xiaomi behavior or real Termux execution.
The phone was unavailable during this ticket. Controlled model transports and
directory adapters are identified separately from actual MiMo HTTPS requests.

| Candidate | App SHA256 | Test SHA256 |
| --- | --- | --- |
| First full | `bed5ae5b58628702c8315478f608a3f1f445c4c1359d815844ee05d21e226607` | `acfdb990ae6708fbd661d17c914a734b4a1acabbe75dcd3671b0289160326eac` |
| Second full | `0b388870606e57b92ce56d7d38b2d358be49912a9cdb011aacc21c48c94d734b` | `96c3c5ad1076e3fcf197923b93791bd847f034057c92b5b2e99b75aa59614d00` |
| Third targeted | `dd3744d1209e09dbcd84a31971e8e659f3af5e2ea9985cb283d9ba049f0a029f` | `6acb9e602215e04edcd59dbade598178d215e9f8e5b1d0b8be5fa439140e01a9` |
| Third diagnostic, test only | same third app | `c51ddd0dca016040d32d52ad6940fe330e235a2824b9d6de4d77361d8de7dce9` |
| Bootstrap close regression RED | same third app | `76b28c8a1e21043d0c127ab1375c032b2e191f36c2da78b8db972d8dae0a3455` |
| Final debug close fix | `76312472306e912ee0ac8ffc2aae307d5e86c1b65ac0afe835dfde06b7a8aa6c` | same bootstrap regression test |

The [final targeted run](emu16k-final-targeted.log) passed **3/3**, zero skipped,
in 39.356 seconds: bootstrap close and next-domain isolation, all twelve shared
policies, and the existing project busy-refusal/recreate/reopen flow. The final
change retains a debug-only close request until asynchronous bootstrap installs
its owner. The bootstrap RED/GREEN test APK is byte-identical. Runtime and UI
resources are unchanged from the third app; the real-provider route behavior
below was validated on the second candidate and was not rerun for this native
debug-only change.

[Final artifact inspection](final-apk-inspection.json) matched **44 runtime
entries, 11 UI resources and 109 source hashes**, all four SDK packages at 1.5.0,
and both native libraries against the pinned i18n AAR. Native ZIP/ELF alignment
and `zipalign -c -P 16 4` passed. [Compact results](results.json) links each
retained run to its log SHA256; these are scoped runs, not a fabricated single
all-green aggregate.

## Observed extension and routing behavior

The [second complete run](emu16k-full-second.log) ran eighteen methods:
**17 passed, one native test-fixture failure**, zero skipped, in 100.193 seconds.
The failed method and its later repair are preserved below. Passing coverage was:

- Actual React timeline: 26 completed inputs, then one held input, **53 history
  records**. The custom page fetched older records beyond the current SDK watch,
  displayed stored text and progress, and unmounted its own subscription while
  the conversation remained running. Deliberate termination of the actual
  WebView renderer followed by the existing **重新打开** button preserved the
  same runtime and pending input, without another model request. The recorded
  `rendererRecoveries=1` was this explicit termination recovery.
- Actual React source input invoked the real SDK `conversation_transfer` tool.
  The target received one independent fixed input while its existing unsent draft
  and revision stayed unchanged. Same-intent reconciliation, Activity recreation
  and a fresh fixture host preserved the receipt/history and added no request.
- Four native commit/ACK windows killed a separate OS process; two SDK commit
  windows killed the actual runtime owner. Reopening recovered only committed
  facts, retained the original source generation and had one target input.
  These deterministic scenarios do not promise zero repeated external billing
  after arbitrary provider/process failures.
- Nine earlier T07 native submission/stop cases passed, preserving the authored
  send ACK contract alongside the new independent route ACK.

The real-provider method in that run used **normal ACK**. A separate
[real-provider lost-ACK run](emu16k-real-lost-ack.log) passed **1/1** in 41.787
seconds with `ackLossInjected=true`. Each scenario made **three actual MiMo
HTTPS requests**: source tool request, source continuation and target reply.
Both asserted that the unique synthetic target draft was absent from the actual
source history and serialized model requests. Target draft text/revision stayed
unchanged. Same-intent ACK repair and reopen added **zero requests** at those
observed boundaries. The real model answered the explicitly forwarded random
marker; the complete target/source contexts were not forwarded.

The [third diagnostic run](emu16k-third-diagnostic.log) passed **2/2**, zero
skipped, in 29.775 seconds on the unchanged third app. It ran all **twelve**
shared registry/routing callbacks, including the final source-cancelled location
guard, and the existing React project busy-refusal/rebind/reopen scenario. The
latter preserved two tool witnesses and four controlled model requests;
reopening added none. `recoveredDraftConflict=false` records that this run did
not exercise its optional draft-conflict recovery button.

## Host tests and independent regressions

[Complete final runtime tests](runtime-final.log): **147/147**, zero skipped.
[Complete UI tests](ui-final.log): **67/67** in 21 files, including actual
Application/SDK/SQLite-to-React checks. TypeScript/Vite production build passed.
[Android build](android-final-build.log) passed. [Lint](android-lint.log) passed
with zero errors and seven known warnings: three pinned dependency updates,
two intentional bundled WebView JavaScript uses, one debug receiver and the T15
application icon. The lint run precedes the small debug close fix.

Four independently reproduced defects were fixed and covered through public
seams; none of the earlier partial passes is substituted for these checks:

| Finding | Retained RED | Fixed behavior and coverage |
| --- | --- | --- |
| Normal route ACK included target draft in source tool history | [Actual SDK counterexample](route-draft-red.log) | Native route ACK does not invoke the authored-draft callback; Routing returns a narrow receipt/status projection. Shared actual SDK test and both real-provider ACK modes verify no draft in source history/serialized requests. |
| Browser dropped subscription errors | [Real browser callback](browser-subscription-red.log) | Strict protocol/error/identity validation forwards the event; actual browser-to-Timeline test shows observation loss without fabricating conversation completion. |
| Source cancellation looked like target stop | [Actual SDK plus UI label](source-stop-label-red.log) | `sourceCancelled` is distinct from target `cancelled`; accepted independent target progress remains truthful. A subsequent genuine target stop still takes priority. |
| Never-admitted source-cancelled route permanently occupied a workspace | [Real dual-store counterexample](source-cancel-location-red.log), [same probe GREEN](source-cancel-location-green.log) | Same SDK transaction under the native location fence verifies absent Admission, native ACK and SDK input plus original source identity/stopped generation before releasing occupancy. Disagreement/read failure refuses. [Paired tests](source-cancel-location-paired.log) protect an accepted independent target, reopen and unresolved effects until actually settled. The same two callbacks passed on Android. |

The shared twelve are nine routing/configuration policies plus three actual SDK
registry policies. They cover stable IDs, source/target/location refusal, both
source-stop/SDK-commit orderings, lost ACK, unconfigured model gate, same Interface
model settings, intentional tool/section override order, duplicate identities,
duplicate task names and resources that survive SDK uninstall until their actual
owner releases them. Tests do not inspect private registry internals.

## Retained failure history

- The first native stub failed as intended ([RED](emu16k-native-red.log), 0.209s).
  The exact same test APK then passed ([GREEN](emu16k-native-green.log), 0.335s).
  Test SHA256 was `c19910017d8e3a41925a1adc432708f0be5eb6d432595ad1a161740448a56988`;
  RED app `e83b1c7765049b8d02df07778c2ce58ccd11457a8a86cc17f70d1de9f73d7fff`,
  GREEN app `ca2509f2839b74487afc0e688ae1b235f70b50896c71b9985e280daae75881a7`.
- The [native combined run](emu16k-native-combined.log) was **12/13**. Its fault
  fixture expected the raw injected exception before COMMIT, while the public
  storage wrapper correctly returned `INPUT_STORAGE_FAILED`.
- The [first full run](emu16k-full-first.log) was **7/9** in 166.708s. The same
  fixture then overcorrected its after-COMMIT assertion: this boundary is outside
  the storage wrapper and retains `IllegalStateException("Synthetic response loss")`.
  The fixture now asserts each exact stage separately and retains all durable
  before/after checks. The other failure was initial Timeline readiness; root's
  UID diagnostic confirmed renderer **SIG11 before the first create action**.
  The second run used the existing explicit renderer recovery and passed the
  complete timeline. Raw UID logs are deliberately not published.
- The second full run's only failure was another test-data error: constructing a
  deliberately bad receipt reused its source JSONObject by reference, mutating
  the original intent before the next valid ACK. The helper now deep-copies it
  and asserts the original generation remains one. That method passed in the
  [third targeted run](emu16k-third-targeted.log).
- That third run was **1/3**, 36.243s: the shared-policy method's cleanup timeout
  masked its primary error, then the project fixture could not find its draft.
  The native owner loaded Javet only after more than ten seconds; the test's
  nested control-query deadline was ten seconds despite its 90-second readiness
  deadline. Readiness now keeps one asynchronous state query within the existing
  overall deadline, and cleanup preserves primary/suppressed errors. The passing
  diagnostic rerun observed a faster 3467ms startup; this warm run alone does not
  prove the earlier timing cause.
- A separate [bootstrap-close RED](emu16k-bootstrap-close-red.log) deterministically
  observed `phase=opening`, one native owner and the held domain, then failed
  because debug close was silently dropped before JS installed `__appClose`.
  The [same test passed after the fix](emu16k-final-targeted.log), proving the old
  runtime and lease were released and a newly opened validation domain had its
  own native draft. Product stop,
  UI unmount and Service destruction are different entry points; this is not
  described as a product stop failure.
- The [first host suite](runtime-first.log) retained an earlier test expectation
  for a fabricated conversation terminal state on observation failure. The final
  test instead verifies a separate subscription error and failed host, with no
  invented stored terminal conversation; the final 147-test suite passes.

## Acceptance traceability

| Ticket criterion | Observable coverage |
| --- | --- |
| 1. UI-only, Agent-only, both sides | Timeline without placeholder Agent; actual routing tools; model configuration UI plus Agent contribution. |
| 2. Separate bundles/shared React | Data-only descriptor imports; UI/Agent loader tables; packaged entry/source mapping. No cross-process function/closure serialization. |
| 3. Real custom history and subscription | Android 53-record paging/unmount/renderer recovery; stale-page and subscription-error component/browser tests. |
| 4. SDK contribution path | Model settings and routing use actual Extension tools/prompts/registry; source tool work is scheduled by the existing SDK. |
| 5. Identity and override semantics | Three actual SDK registry callbacks: application/final SDK identity refusal, selected override order, task collision. |
| 6. Truthful states | Actual catalog installed/selected state; lazy load, real React mount commit, error boundary and unmount tests. |
| 7. Explicit target query | Stable-ID summary-only list/query; same-name targets remain distinct; ordinary send still targets its current conversation. |
| 8. Tracked reliable create/transfer | T04 creation identity, T07 native/SDK receipt path, T08 expectation, same-intent reconciliation and six real process-death windows. |
| 9. Refusal and stop races | Absent/disabled/stale target or stopped source; source generation remains fixed; commit/ACK overlap uses actual acceptance facts and separate target stop. |
| 10. Shared settings and core control | Agent models.get/select use the same Interface; queries do not resolve Key; core native authority/configuration/location/control remain mandatory. |
| 11. Diagnostic lifecycle | Initialization/duplicate failures; asynchronous load/render failure; browser-delivered subscription error; uninstall resource-owner semantics and real renderer recovery. |

The [second credential audit](credential-audit-second.json) checked **68,516,864
application-data bytes** and **341,329 UID-log bytes**; the [third audit](credential-audit-third.json)
checked **64,912,384 data bytes** and **337,939 log bytes**. Both found zero actual
private-key occurrences in raw UTF-8/UTF-16LE/UTF-16BE byte sequences at every
offset, passed offset-zero/one positive controls and verified tar completion.
Immutable extracted runtime bundles were excluded. These are bounded data/log
audits, not heap, deleted-flash or whole-device forensics.

To reproduce host checks, run `npm test` in runtime and ui. Android selectors are
`NativeRoutingTest`, `NativeRoutingCrashTest` and `ExtensionApplicationTest`.
The real-provider method requires the established encrypted validation capsule
and explicit `realProvider=true`; `routeAckLoss=true` selects the separate lost-ACK
case. Secrets are never passed in instrumentation arguments. Native debug probes
and controlled adapters are validation fixtures, not product controls or proof
of T09 execution capabilities.

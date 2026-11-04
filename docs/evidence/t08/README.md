# T08 project and adopted-position evidence

Implementation: [runtime policy](../../../runtime/PROJECTS.md), shared SDK checks
in `runtime/validation/project-policy.mjs`, React project settings and trusted
native schema-4 location fence. SDK packages remain 1.5.0; native runtime remains
the pinned Javet Node i18n 6.0.3 candidate accepted in T01.

## Final application result

The [fifth application run](emu16k-application-final.log) passed **3/3 methods,
zero skipped**, in 40.525 seconds on Android 16/API 36 x86_64 with 16 KiB pages.

| Final artifact | SHA256 |
| --- | --- |
| Full app | `3c6989139cfc0725111167fe27a491c13be56eedee6e3aea3cccc52a5307c8ac` |
| Instrumentation test | `cb395a68a6c48a04d77f5660e094054e00fb13909963c6e63b4198c059524ddf` |

- All **sixteen** shared project callbacks passed on actual Android Node/SDK/SQLite.
- The actual React fixture flow made two explicit inputs, received two adopted
  environment witnesses and made four model requests. Activity recreation kept
  the same facts; a fresh native host reopened the same configuration/history with
  **zero additional requests**.
- The actual MiMo flow also made two explicit inputs, received two SDK tool
  witnesses with the expected old/new binding and made **four HTTPS requests**.
  Old accepted-intent replay added no request. Activity recreation preserved the
  selected project, shared name, exact receipts and history. This real-provider
  case reconnects to the same host; it does not claim a fresh real-provider host.
- Both flows recorded `recoveredDraftConflict=false`: waiting for the second text
  to be saved avoided conflict on this run. The explicit keep-local branch exists
  in the fixture, but this passing device run did **not** exercise that button.
  Both native-store and Interface BUSY-observation retry counts were empty.
- [Final artifact inspection](final-apk-inspection.json) matched 36 runtime
  entries and nine UI resources to source, confirmed all four SDK packages at
  1.5.0, matched both native libraries to the pinned i18n AAR and verified their
  16 KiB ZIP/ELF alignment. [Build and lint](android-final-build-lint.log) passed;
  lint had zero errors and seven existing warnings (three dependency updates,
  two intentional WebView JavaScript uses, one debug receiver and the T15 icon).
- The original independent identity probe is retained as
  [RED](identity-review-red.log) and [GREEN](identity-review-green.log). The same
  public operation now commits exactly once and ends with three projects at
  catalog version three.
- The [final credential audit](credential-audit-final.json) found zero occurrences
  of the actual validation key in **58,967,040 application-data bytes** and
  **4,763,930 UID-log bytes**. It checked raw UTF-8, UTF-16LE and UTF-16BE sequences
  at every byte offset, passed offset-zero/one positive controls and validated the
  transferred tar completion. Immutable runtime bundles were excluded; no heap,
  deleted-flash or all-device-forensics claim is made.

## Host and native verification

- [Complete runtime baseline](runtime-full.log): 131/131 passed, zero skipped,
  before the later focused project fixes. Those changed paths are covered by the
  final 17/17 targeted run below and the sixteen actual Android callbacks.
  [First run](runtime-first-full.log) retained two outdated T07 fixture failures:
  one changed the superseded configuration document, and the other armed a SQL
  fault before reaching the intended submission transaction. The former now uses
  public `workspaces.update`; the latter arms at `after-sdk-submit`. The actual
  SQL failure and exact old receipt assertions remain.
- [Earlier project policies](project-policy-final.log): 13/13 passed after adding a
  direct ledger-binding check. Its preceding focused RED demonstrated that a late
  unresolved effect could be missed after the current execution pointer was
  released. The guard now reads every pending binding independently of current
  conversation pointers and refuses missing evidence.
- [UI tests and production build](ui-full.log): 58/58 tests in 18 files passed;
  TypeScript and Vite build passed. Includes real Application/SDK/SQLite tests,
  shared names, busy refusal, explicit retry and unchanged old receipts.
- [Provider encoding regression](live-provider-encoding.json): a separate new
  host test passed using the actual live-provider encoder and synthetic HTTP.
  It checks the first serialized `tool_choice` names `location_witness` and the
  post-tool choice is `none`. This is transport-boundary validation, not a cloud
  result; it was added after the 131-test complete run.
- Android native-only [RED](emu16k-native-red.log): 2/4 passed, two stale/fenced
  context-publication failures. The exact same test APK then
  [passed 4/4](emu16k-native-green.log) after the native fix.
- Final native-only [17/17](emu16k-native-final.log), zero skipped, 5.582 seconds:
  seven fence store tests, one method covering four actual separate-process kill
  windows, and nine T07 native store regressions. Parsed safe facts are in
  [native-reviewed-metrics.json](native-reviewed-metrics.json). This result is
  specific to the native-only APK pair below, not the later full application.

| Native-only artifact | SHA256 |
| --- | --- |
| RED app | `8d05db05c21f18f93818fc3ad316e67ff700b94b79b380ab7b16691d9a5e797b` |
| Exact RED/GREEN test | `d62fc2f02078ad73794c6d6e62ef758c7d7b5c79577eeff2d2c6cd3218d052b1` |
| GREEN app | `09aea65bcc74a2a63b6ede9a3c99569e4926e05bdd553399671788e0e08c7a04` |
| Final native-only app | `f4fb7e15859b607f89689d2bda82bf408f7ce03cb172a56422949e60c9759d80` |
| Final native-only test | `e5f081eec1e82beba5c6e24a778d19bd7958f5a129d5a701cfff65497d206a73` |

Native checks used the Android 16/API 36 x86_64 emulator with 16 KiB pages.
No S23 T08 run is claimed: the phone is currently unavailable. Actual private
directories, WAL/FULL commits and OS process death are exercised; actual Termux
directory aliases are outside this ticket.

## Acceptance traceability

| Ticket criterion | Observable coverage |
| --- | --- |
| 1. Common default and explicit project | Shared metadata policy; React create/select; no mkdir in project module. |
| 2. Stable shared identity and names | Two products reference one project/workspace; rename preserves expectation and receipt; reopened catalog contains one authority. |
| 3. Adopted versions through execution | Actual SDK queued followups resolve one binding; explicit later location creates another; old receipt remains stable. Tool witness observes the adopted environment. |
| 4. Full lifetime refusal | Native pending intents; SDK submissions, inbox, live run, all nonterminal/background tasks; terminal-owner surviving child; alias/unknown and unresolved ledger cases. |
| 5. No delayed proposal | Rejected selection stays absent after work settles; only an explicit new request changes the association. |
| 6. Concurrency and interrupted publication | Both native intent/edit orderings; drafts/stops continue under fence; exact complete context publication; four native PID-kill windows; actual SDK COMMIT-before/after-response uncertainty with reopen. |
| 7. Old ACK and history | Old accepted receipt replays after current location changes; missing native finish is repaired from canonical SDK facts; unresolved old binding still blocks after pointer release. |
| 8. Internal inheritance | Actual task-owned child survives terminal owner, remains hidden, accepts later input with old binding; fork keeps source location but uses actual task owner's control domain. |
| 9. Availability and no fallback | Actual provider parser invokes witness only with available adopted environment; revoked adapter yields visible tool error and zero fallback invocations. Production without adapter reports unverified. |
| 10. Actual identity exposure | Controlled adapter maps different records to one actual identity; shared position edits refuse active aliases. No real filesystem alias proof claimed. |
| 11. One Interface and fresh conversation escape | UI and extensions call the same actions; fresh B selects another workspace while A uses default, but shared default relocation and A's own busy rebind still fail. |

## Retained failures and scope

The first [complete application run](emu16k-application-first.log) passed 2/3
methods: all thirteen shared SDK policies and the actual React fixture flow.
The real MiMo method failed its first request-count assertion (one observed,
two required). Its observer waited for submission settlement, which can precede
the SDK tool and follow-up generation. A test-only candidate now records safe
phase/metrics/history at that boundary and waits for the complete observed run
before the unchanged two/four-request and witness assertions. Its actual result
was still a failure: [second run](emu16k-real-second.log) showed a completed
text-only response, not a late tool result. The cloud scenario was then made
explicit: first call `location_witness`, then answer with the random marker.
[Third run](emu16k-real-third.log) observed a genuine first tool call and adopted
binding, but later failed on an `INPUT_STORAGE_BUSY` query. It is not a complete
cloud-flow pass. The test now retries only that error on its explicit public-query
allowlist for at most two seconds and records the count; no mutation is replayed.

After the first candidate, two separate public Interface races were reproduced
and fixed: a late old locator inspection overwrote the new position identity;
and a delayed product snapshot could combine an old catalog with a new selection.
[Latest targeted host run](project-policy-latest.log) passes all sixteen shared
project checks plus the live-provider encoding test (17/17). The read-delay test
wraps the public SDK read boundary to hold timing while retaining every actual
SDK snapshot and SQLite operation. The final APK includes both fixes. The
additional operation-identity case covers
`constructor`, `toString` and `__proto__`, exact replay after reopen and conflicting
payload refusal. It first reproduced the inherited-property false conflict; both
cached and transactional receipt lookups now require an own property.

The [fourth application run](emu16k-application-fourth.log), on app
`f1f2a3ebb967d0dbc8d4c5291c1af280d77c2914152fbb7484931f2ae2e5fa79` and test
`dd8d5826b4e244c7303fb2035da82ba1544a706807602269bd1a370b4b897551`, passed
2/3 methods. Shared fifteen policies and the complete real MiMo flow passed:
four requests, two actual adopted-environment tool witnesses and Activity
recreation. The fixture flow failed waiting for its second intent because an
external first native save/ACK left the UI at an older draft revision. The UI
correctly preserved the second local text and exposed a conflict. The new fixture
uses the explicit keep-local recovery button if needed, confirms exact saved text,
then sends once; it does not bypass CAS or retry a send.

The [fourth-candidate credential audit](credential-audit-fourth.json) found no
actual key in 58,219,008 application-data bytes and 5,571,573 UID-log bytes, using
the established raw-byte UTF-8/UTF-16 checks and positive controls. It is attributed
to that candidate; the separate final audit is linked above.

The debug `location_witness` tool has a controlled environment and never reads,
writes or executes files. MiMo using that tool can prove that an actual SDK tool
received the adopted location, not that Termux accessed it. Real executor access
and write conflict coordination remain T09/T10. The old app-private configured
default is preserved until explicit setup changes it; it is not silently treated
as accessible to Termux.

# T11 scoped development gate review

2026-11-04: **pass for the recorded T11 development scope**. Independent review
of `7a511769920267128f2bb7fbf073a0447ec90317` against integration
`22fe83e8b4984ba8aece9ff10347e630b3953fa2`; merged without conflict as
`99a4763bdc2aee629f85b2fcc721c01eb4e576c6`. This is not whole-product acceptance,
the final all-ticket code review, or T17 OEM acceptance. GitHub remains the
execution-status authority; root owns publication and the issue update.

Reviewed the [ticket](../../specs/v1/tickets/11-stop-fencing.md), parent spec,
dependency index, AGENTS, tracker/domain rules, glossary, ADR 0006 and
[implementation contract](../../../runtime/STOP.md). Read current GitHub
[#12](https://github.com/mikyan/durableagent/issues/12),
[#1](https://github.com/mikyan/durableagent/issues/1), accepted dependencies
[#8](https://github.com/mikyan/durableagent/issues/8) and
[#10](https://github.com/mikyan/durableagent/issues/10), and #12/#1 comments
(none). The scoped review covers source, retained evidence and artifact identity;
it does not claim the final code-review skill's two parallel reviewers.

## Standards

No actionable documented-standard violation or baseline smell requiring a change
found. Native control, SDK scheduling and Termux process evidence retain their
separate authorities. UI copy distinguishes durable intent from SDK interruption
and verified external completion. No private SDK-table mutation or broad Termux
process kill was introduced. The raw UI test log retains its original trailing
blank line; it was not normalized because its recorded byte hash is evidence.

## Spec

No remaining blocker found in this scope. The preliminary P1 was a real dropped
second-stop defect: an active namespace accepted another durable stop but never
ran its native external sweep. The final service increments a per-namespace work
revision. Its sweep snapshots that revision; a later request triggers another
pass. Request admission and worker exit share the jobs lock, so a request after
the last pass either causes a bounded follow-on job or creates a new job after
removal. Short admission has a separate executor and does not queue behind slow
external verification. Idle shutdown checks both jobs and in-flight admissions
on the main thread using the latest start ID. Unknown effects alone do not
schedule unbounded retries.

The same regression test APK (`6b1eb46f...`) failed on Full01 and passed on
Full02, [RED](t11-second-stop-red02-device.log) /
[GREEN](t11-second-stop-green01-device.log). It verifies that a second synthetic
SAF effect is actually examined while both SDK barriers stay pending; it does
not claim that the command worker cancels a document-provider write. Actual
Termux cancellation is evidenced separately by the notification and MiMo runs.

The original Full01 notification admission failure remains **cause unknown**.
The final intake retains a safe failure category and waits up to 1500 ms for the
lease before entering the action. It neither retries a partially committed
mutation nor invents a new stop action after a lost response. A newer control
version still rejects an old notification. The successful later run does not
retroactively identify the first failure's cause.

Checked the own-host watchdog during bootstrap and ready JS, namespace checks,
persisted abort identity, one reconstruction per control link, inherited SDK
background/fork abort scope, immutable effect digest/namespace, monotonic receipt
evidence and unresolved-effect projection. Published native v6 migrates to v7
without recreating T16 retention tables; earlier published versions retain their
ordered migrations. Failed migration preserves the original database. The
unpublished v5 fixture is rejected, and a migrated catalogue remains unverified
until recovery inventory completes. T16 retained read-only history still opens
without enabling dispatch.

## Artifact and evidence checks

- Both review inputs were clean at their pinned commits. The final owner freeze
  has **156/156 matching files**; root's independent inventory has **165/165**.
  The different counts reflect explicitly different scopes, not omitted matches.
  These byte hashes were checked in the frozen owner worktree. The merge Git tree
  is identical to the owner tree; integration's existing `core.autocrlf=true`
  checks out ten new source files as CRLF instead of the frozen LF bytes. All ten
  were independently compared and differ only in line endings. The frozen
  artifact hashes were not rewritten to describe a different checkout.
- All **35 retained log hashes** match. The copied final APK inspection is
  byte-identical to root's external inspection, including **58 runtime entries,
  11 UI resources**, pinned native binaries and 16 KiB ZIP/ELF alignment.
- Full02 and final source inventories differ only in `NativeStopService.kt`.
  Removing exactly the final two lint-comment lines and one `SuppressLint` line
  yields Full02's SHA256
  `89cab09f328236e7188da6e624e45d35ac48ea7f74ea04c19acf346cf2b9481d`.
  Full02 app `f452d027...` and final app `3ddbae2c...` are distinct artifacts;
  both test copies hash to `b676f370...`. **The final app was not device-retested.**
- Reviewed retained runtime **183/183**, UI **76/76**, final build/lint success,
  Full01 native **23/24** and the corrected v6 fixture pass, actual Full02
  notification **1/1, 19.779 s**, real MiMo **1/1, 42.384 s**, and second-stop
  **1/1, 0.849 s**. These are separate runs, not one fabricated green batch.
- Reviewed root's independent read-only original-file observations for both
  Full02 flows: original stopped executions were scope-confirmed, delayed files
  absent, and generation-2 verifiers completed with exit 0. The notification's
  other execution was still running and uncancelled at the target assertion;
  its later explicit cleanup is separate. The actual live run recorded one old
  request, three total requests and zero observed old follow-ups.
- The reviewer made no device or credential calls and did not repeat full tests
  without a new concern. Root's retained exact-key audits report no matches in
  app-data/UID-log byte streams with positive controls. Final public-file audit
  and publication remain root-owned.

## Acceptance traceability

The [owner matrix](README.md#ticket-traceability) supplies the detailed log links.
Each criterion was checked against source and those recorded results.

| T11 criterion | Reviewed basis |
| --- | --- |
| 1. Old abort before new SDK admission | Shared real SDK descendant/fork cases; three Android opening/ready/writer busy cases; native new input remains saved until old scope settles. |
| 2. Stop survives JS/UI loss | Same native authority for UI and immutable notification; actual notification after UI destruction and busy Node. |
| 3. Commit before saved acknowledgement | Native transaction and process-death windows; failed/unknown admission is not reported as committed. |
| 4. Old generation cannot dispatch | Native prepare/start fence, T07 dispatch gates, immutable historical catalogue adoption, old notification rejection and live zero old follow-ups. |
| 5. Related SDK background scope | Public conversation/task abort plus inherited control ownership; held abort callback prevents fresh admission. |
| 6. Readiness and unresponsive JS | Bootstrap/ready watchdog, native independent external cancellation, persisted barrier verification and own-process reconstruction. |
| 7. Actual external stop proof | Authenticated matching execution receipts and original-file observations; unknown effects remain unresolved. |
| 8. Idempotence/isolation | Stable action/version, repeated PendingIntent, other actual scope untouched, matching monotonic evidence and second-stop regression. |
| 9. No revival on reopen/late events | Commit-edge process deaths, actual host reconstruction, shared persisted descendants, T07 retry/readiness gates and unavailable-control behavior. OEM/network-policy universality is not claimed. |
| 10. Old unsent inputs and later draft | Persisted stopped-intent handling, old input unanswered, later authored draft preserved without automatic submission. |
| 11. Explicit fresh generation | Actual generation-2 model/tool verifier; abort barrier and unknown external occupancy remain separate. |

## Remaining boundaries

The full evidence retains both early 16 KiB and later 4 KiB emulator environments
and the failed attempts. Samsung/Xiaomi, pre-unlock and complete background or
network-policy behavior remain T12/T17 work. T10's writer queue can legitimately
serialize arbitrary shell commands; combined isolation validation must adapt its
unrelated witness without bypassing that production coordinator. This gate adds
no keepalive scheduler and makes no claim about arbitrary unsupervised processes,
all provider failures, exactly-once effects or zero repeated model billing.

Standards: **0 actionable findings**. Spec: **0 unresolved findings in scope**.

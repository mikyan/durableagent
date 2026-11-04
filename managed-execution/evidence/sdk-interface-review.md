# T09 independent scoped gate review

Reviewer: `/root/implement_runtime`, with independent native/Python axis by
`/root/gate_review`. This is the **T09 scoped review**, not the final implement-spec
review of the entire seventeen-ticket branch.

Fixed implementation: `21fc11f9cf179556f9e8bef5cf6725734280e73b`.
Comparison: `git diff fc0ab3dd9b8609ac4f00add235645824b14d70bb...21fc11f9cf179556f9e8bef5cf6725734280e73b`.
Commits: `e66525e` execution authority, `670c9dd` accepted integration merge,
`21fc11f` actual SDK/Termux wiring. Later UI repair `fd9b5a8f5ea1ffa620f6839b8eef0ae884ad9dba`
was reviewed separately from an external immutable `git show` snapshot. The
owner's in-progress T14 merge was not treated as a defect or a reviewed final tree.

Sources read: AGENTS, tracker/domain rules, GLOSSARY, total spec/index, local T09
ticket, current GitHub #10 and comments (zero), runtime/MANAGED_EXECUTION.md,
managed-execution/VALIDATION.md, code/tests and root's exact raw device results.
Existing research is not treated as project device evidence. No ADB, private
credential, remote mutation or owner-source edit was performed by this reviewer.

## Standards

No additional actionable documented-standard breach found in the reviewed scope.
The split between SDK state, native control/transport and Termux execution
evidence follows the repository domain rules; tests identify controlled model /
external transport boundaries separately from actual Termux proof. Fixed Bash
wrapping is core-only, and the implementation does not install an extra scheduler
or expose arbitrary command admission through WebView. The compact source style
and repeated receipt checks deserve normal maintenance attention, but are not
reported as correctness defects or repo-rule violations. Tool-enforced formatting
and speculative refactoring requests were excluded.

## Spec

One concrete issue was reproduced and repaired:

**F1 — current loss of execution confirmation was hidden by an older running row.**
At fixed `ui/src/execution.ts`'s `newer()`, every `source: application` row lost
to a previous execution-server row. Public Client/Coordinator reproduction first
displayed `running, sequence:2`, then received the current core result
`unknown, CLIENT_CONFIRMATION_LOST, source:application, sequence:2`. The actual
view remained `running` with no notice or error. `ExecutionPanel` consequently
continued to label it 正在执行. This violates criterion 4's distinction between
running evidence and unconfirmed results, and criterion 11's disconnection flow.

The original external test/log are `t09-review/uncertainty.test.ts` and
`t09-ui-uncertainty-review.log` (1 failing test). The fix at `fd9b5a8` lets a
current application uncertainty qualify a previous nonterminal fact, preserves
confirmed terminal facts, retains sequence protection against older remote
receipts and existing request-generation protection. The **same** external
counterexample, with only import paths changed to the immutable fixed snapshot,
passes **1/1** in `t09-ui-uncertainty-green-review.log`. The owner added terminal
and late-response regression cases. The requirement is truthful visible uncertainty,
not a mandated internal field name.

No other concrete SDK/Interface correctness blocker was found at the fixed source.
Native/Python findings and final status are in `t09-native-independent-review.md`.

## Independent SDK/Interface checks

- Read durable task/call/ordinal mapping, immediate SDK intent commit, immutable
  command/options/binding/generation, actual directory identity, stable identity
  reuse and mismatch refusal. Mutation transport has no automatic retry.
- Read startup and same-host reconciliation, unknown refusal of a different
  identity, fixed source generation, actual invocation abort and cancellation
  persistence beyond task retirement. The effect snapshot retains pending
  binding/control owners; terminal records and unknown effects are not inferred
  from UI disconnect or SDK completion.
- Read bounded channel frames, identity/sequence/cursor checks, dual incremental
  UTF-8 decoders, SDK output window delegation and same-namespace raw length/SHA
  verification. The raw read is capped at 16 MiB and fetched in bounded pages.
- Independently ran only three focused actual SDK/SQLite tests, **3/3**:
  lost-start uncertainty prevents a new identity, same-host public verification
  resolves a lost ACK before a later explicit execution, and environment cleanup
  cancels only the adopted SDK conversation's commands. Log:
  `t09-runtime-independent-targeted.log` (979.5541ms total). No broad duplicate
  full suite was run.
- Read actual Android SDK four-shell-case conformance and separate-PID recovery
  assertions. The test does not use a stored SDK receipt alone as proof of an
  external file effect; a subsequent real command verifies the effect.
- The suggested tiny-output oversized-frame hypothesis was **withdrawn**:
  Python `read_output` has SQL `LIMIT 64` in addition to byte paging. No invented
  failure or unnecessary buffer increase is requested.

## Eleven-criterion traceability and limits

| Criterion | Reviewed support |
| --- | --- |
| 1. One SDK tool environment | Fixed Bash wrapper/ExecutionEnv, trusted Javet channel; actual React/SDK/Termux six scenarios. |
| 2. Durable invocation identity | Session-scope intent/index keyed by real task/call/ordinal; immediate commit before prepare; fixed request/context checks. |
| 3. Endpoint dedupe and uncertainty | Python durable prepare/start identity/digest, guardian lock, tombstone and actual dropped-start-response test; unknown never treated as unstarted. |
| 4. Truthful distinct states | Endpoint states and native confirmation checks; F1 UI correction verified independently. |
| 5. Final arguments | Shell versus argv, cwd/env/timeout, actual directory FD; four unchanged SDK shell cases on actual Termux. |
| 6. Bounded ordered output | Per-stream decoder, cursor/sequence, SDK exact window counts; raw/chunk/retention/final-parameter budgets; real 1.2 MB output. |
| 7. Reconnect and full raw | Same identity/output cursor; replay fills a new SDK buffer from old spool without a second start; actual same-env 1.2 MB raw test passed. |
| 8. Scoped cancellation | Real per-command guardian/subreaper + pidfd; unknown retained if supervision fails; Node-busy native cancel actual proof. |
| 9. Crash windows | Native execution-side actual process/effect tests plus four Android SDK owner deaths; public effect verification and same-intent no added execution assertions. |
| 10. Authenticated local connection | Native pin/client Keystore, loopback mTLS/version/ledger/session/request identity, fixed setup/launcher, no WebView prepare/start. |
| 11. Minimal actual page | Success/exit7/large output/cancel/timeout/recreate/reopen; source review plus root's frozen 02/03/04 actual results. |

Root evidence: production02 six scenarios 1/1 (40.593s); production03 four SDK
shell cases, actual busy-owner native cancellation, four owner deaths, real MiMo
1/1 (20.055s, two HTTP requests/one completed execution/exact Chinese stdout);
GREEN13 executor 21/21 and same-source transport/CLI 4/4. Production04 actual
same-environment raw output passed 1/1 (19.577s), checked in
`t09-production-04-same-env-raw.log`. At fixed commit VALIDATION.md still called
that last case pending: the final owner documentation must reconcile the new
result, not pretend it had already passed at that checkpoint.

These results establish the documented **Android16/4KiB/x86_64 official Termux
development scope**. They do not establish Samsung/Xiaomi OEM completion, x86
Termux bootstrap on 16KiB pages, whole-workspace T10 exclusion, full native T11
stop fencing or arbitrary-command exactly-once side effects. Those planned
successor scopes are not counted as T09 defects or silently accepted here.

## Handoff status

Fixed-source SDK/Interface review: no remaining concrete blocker after F1 repair.
Independent native/Python report is complete and clear at the fixed baseline:
`t09-native-independent-review.md` (3/3 bounded public SQLite metadata tests,
not a replacement for the real process/Android results).

After the owner declared conflict-resolution files stable, the eight T14/T09
wiring files plus the UI uncertainty module were read again. Their hashes are
in `t09-merge-wiring-review-hashes.json`. The new per-open registry copies caller
contributions before installing fixed core execution and app extensions, avoiding
duplicate installation on reopen. The merged source retains execution startup
reconciliation/lazy environment, routes/source fences, pending control-product
effect protection, both native debug controls and close latch, both UI surfaces
and subscription-error handling. No lost-side merge defect was identified.
The original external UI counterexample also passed against that actual merged
worktree, **1/1**, in `t09-ui-uncertainty-merged-green.log` (163ms).

Final APK/setup mapping, evidence reconciliation and root's scoped post-merge
device verification remain separate acceptance gates. This review does not mark
an unrun final binary as passed. No direct integration merge or remote mutation
was performed by either reviewer.

Axis totals: Standards **0 actionable findings**; Spec **1 reproduced finding,
fixed and independently green**, **0 remaining source blockers** in the recorded
scope. Final seventeen-ticket full-branch code-review remains outstanding.

## Post-merge production05/06 dispatch follow-up

Root's post-merge production05 run found a sixth-scenario failure: input persisted,
no new execution receipt, and `运行已停止` despite original native control having
version0/generation1/stoppedThrough0 and no recorded stop. This exposed a second
definite Spec finding: DispatchGate mapped **all** thrown check/model errors to
an aborted response, erasing their safe category. The original triggering error
cannot be reconstructed from that persisted generic message.

Owner's narrow candidate emits abort only for an actually aborted invocation
signal; other caught failures retain bounded readiness/model categories with no
raw exception text. Independent stream tests **5/5** and a differential actual
SDK/SQLite probe (retry enabled, original versus patched source) pass. Both
versions preserve one original user/submission and zero model calls/reopen calls
for injected INPUT_STORAGE_BUSY; patched response truthfully persists `error`
instead of `aborted`. This does not add automatic model retries.

The identical six-scenario Android production06 matrix passed **1/1, 48.817s**,
including 1.2MB / 74 raw-output pages and zero fresh-host requests. Reviewed source
hash `6ce4bd80e03641edecd974b52d741d2bff6de1abf19926a53b869885412f18f4`
matches root's final06 artifact mapping. Detailed facts, hashes, original failure,
limits and reproducible probe are in `t09-dispatch-failure-review.md` and
`t09-dispatch-sdk-review.mjs/.json`.

Updated scoped disposition: Standards **0 actionable findings**; Spec **2
reproduced findings, both fixed and independently verified**, **0 remaining
concrete T09 blockers identified**. The successful06 run is not proof of BUSY or
provider error as original05 cause. Retain that uncertainty; bounded automatic
recovery is a T12 successor concern. Final owner evidence/commit reconciliation,
OEM acceptance and the full seventeen-ticket branch review remain separate.

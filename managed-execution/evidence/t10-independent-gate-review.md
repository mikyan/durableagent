# T10 independent development-gate review

Status: **SOURCE CLEAR after the focused cleanup correction; final commit/test/artifact handoff still pending.** This is a ticket-level review, not the final all-ticket code review. No repository source, device, credential or remote state was changed by this reviewer.

## Reviewed baseline and scope

- Integration baseline: `4914bb8`; implementation worktree: `C:/Users/AI_BA/.codex/worktrees/t10-files/durableagent`.
- Production source initially reviewed at `5008b8d` (SAF merge), unchanged through `fc0111e` apart from tests/evidence. The owner is now correcting the finding below; this report does not mark that unreviewed patch complete.
- Read current tracker issues #11/T10 and #12/T11, repository domain rules, spec, ticket contracts, `runtime/FILES.md`, `runtime/ORIGINAL_DOCUMENTS.md`, `managed-execution/FILE-VALIDATION.md`, and `docs/evidence/t10-saf/README.md`.
- Source focus: actual SDK environment ownership and cleanup, immutable file/document operation identity, shared writer coordination, original-vs-copy verification, unknown effects, recovery, Python file helper and Android original-document service/store. The device results below are parent/owner evidence, not tests performed by this reviewer.

## Blocking finding F1: SAF writes escape environment cleanup

At the reviewed baseline, `ManagedExecution.cleanup` (`runtime/src/managed-execution.ts:208`) marks `(bindingId, sdkConversationId)` closed, stops its readers and cancels only the command index. `writeDocument` (line 225) delegates to `DocumentWrites` without that fence. `DocumentWrites` has a separate durable index and its policy did not check the closed owner. Consequently cleanup can both overlook an active original-document effect and allow a new original-document write afterward.

Independent reproduction: `t10-cleanup-afterclose-review.mjs`, run with Node 24.14.1 against the actual pinned SDK, Application, tool wrapper and two real SQLite stores. Only model HTTP and external document/execution transport are synthetic. A real SDK tool executes `await api.env.cleanup(context)` followed by `api.env.writeDocument(...)` through the public environment. The assertion that no Provider start occurs fails:

```json
{"cleanupReturned":true,"providerStarts":1,"originalChanged":true}
```

Evidence: `t10-cleanup-afterclose-review-red.log`. The owner independently reproduced the complementary live-effect case: cleanup incorrectly resolves while the Provider remains running (`t10-saf-cleanup-red.log`). These are product cleanup-contract defects, not failures of a device polling fixture.

Required correction and verification:

1. Close new SAF dispatch for precisely the binding and actual SDK conversation. Recheck after the final awaited policy read before `start`, including a preparation response that arrives after cleanup.
2. Include that owner's document index in cleanup. Query/cancel the same immutable operation and validate full identity/digest; never replay preparation merely to obtain a cancellation receipt.
3. A verified queued/not-started operation can settle and release its queue entry. An active or unknown Provider scope remains occupied and cleanup must report unconfirmed scope; cancellation intent alone is insufficient.
4. Preserve independent owners and their operations. A failed cleanup must still fence future work for the closed owner.
5. Retain real SDK regressions for active scope, queued no-start, post-cleanup dispatch and the prepare/cleanup interleaving. The independent public probe must turn green without weakening its no-start assertion.

## Other reviewed boundaries

- File helpers use immutable plans, staged content hashes, supervised command identities, pinned parent/file identities, fsync and separate readback. Repeated operation identities do not authorize overwriting later edits. Observation of matching bytes is distinct from confirmation that an execution/Provider can no longer write.
- The SDK writer coordinator persists FIFO claims, checks canonical/object/ancestor overlap, and puts arbitrary shell and SAF original writes in a conservative whole-device file domain. Unknown/active claims are not released because a process disappeared or a lease expired. Pure app work is outside this writer queue.
- SAF receipt checks bind resource, product/control generation, actual SDK conversation and content/precondition hashes. Native start performs original/grant/control preflight and retains unknown scope after potentially effective Provider access; an unknown original does not become complete merely because a later read matches.
- Recovery reuses fixed identities and queries external facts. The reviewed unknown-state paths do not blindly recreate an original write. No second concrete blocker was established on these paths in this pass.
- These observations do not claim that workspaces sandbox arbitrary shell commands or that other applications honor this app's coordinator.

## Acceptance evidence still to preserve

The parent reports Production06 shell-first `PASS 31.828s`, queued-local cancellation `PASS 22.111s`, and the test-only revised T11 fixture `PASS 18.383s`. The prior failure remains attributable only to an unresolved fixture boundary after draft save and before intent creation; both targeted execution scopes were confirmed stopped. Do not claim an identified production BUSY cause or silently omit the old failure.

Production05 real MiMo and same-original Provider/Bash evidence, Python contracts, native SAF cases, actual process-death recovery and previous accepted T08/T11 gates retain their recorded scope. The parent independently read back the actual successful original bytes through normal Termux. These passed axes need not be rerun solely because the new cleanup correction touches SDK owner cleanup; targeted correction coverage and final package mapping are still required.

No merge authorization has been received for this revision. Physical locked S23/OEM visible-UI and Xiaomi acceptance limits remain unchanged.

## Focused correction review

F1 is now resolved in the reviewed working source. `DocumentWrites` receives the existing owner-closed predicate, checks it on entry, after asynchronous policy reads and synchronously immediately before prepare/start. Its cleanup queries and cancels only the fixed operation belonging to the same binding and actual SDK conversation. It accepts only a matched terminal receipt with confirmed scope, preserves unknown state, and cancels a queued claim only on confirmed no-start. `ManagedExecution.cleanup` attempts both command and document cleanup even when one side is unconfirmed.

Independent verification against the rebuilt actual SDK/Application/SQLite:

- The original counterexample is unchanged and now passes: cleanup resolves, Provider starts `0`, original unchanged, later write rejected as `aborted`. Evidence: `t10-cleanup-afterclose-review-green.log`.
- New held-preparation-response interleaving passes: prepare is durably accepted, its response is held, cleanup queries/cancels that exact operation, then a stale accepted response is released. Provider starts `0`, prepare calls `1`, final state `not_started`; cancellation requests retain the same identity/digest.
- Same binding but a different actual SDK conversation passes: cleanup sends no cancellation for the active original belonging to the first owner; that original finishes through its single start.
- Both latter cases and source are in `t10-cleanup-interleaving-review.mjs` / `t10-cleanup-interleaving-review-green.log` (2/2). The first fixture run incorrectly downgraded a terminal cancelled receipt on repeated cancellation. The retained `t10-cleanup-interleaving-review.log` is a fixture failure, corrected to match native cancellation idempotence; it is not a production regression.
- Read owner `t10-saf-cleanup-green02.log`: four passing cases cover command owner cleanup, reader cleanup, live SAF unknown scope/post-cleanup rejection and queued SAF no-start. The earlier `t10-cleanup-queue-green.log` is an inherited command test only and is not used as proof of the new SAF queue case.

Owner-lifetime check: the accepted T09 contract explicitly closes `(bindingId, actualSdkConversationId)` for the current host. SDK 1.5 obtains environments for tools/generation without automatically calling this cleanup API; ordinary T11 stop also does not call it. Thus a normal stop/control-generation change does not populate `closedOwners`. A deliberately cleaned owner remains closed as documented; another SDK owner sharing the binding is not closed. The correction does not broaden that existing lifecycle policy to product IDs or native control generations.

Reviewed hashes:

| File | SHA-256 |
| --- | --- |
| `runtime/src/document-writes.ts` | `e1e9dae60ea19a25927824a4dea4dc5e6c686578376d52d653b37dc320996111` |
| `runtime/src/managed-execution.ts` | `840ef141e47d03cca74e779886edf782d1c6547a2b1bbbee26a9f1412961abe0` |
| `runtime/dist/document-writes.js` | `ed2d1d840cf58710a398784e2f13588e55a9f8b16c6b5da095682a7e98b2c9da` |
| `runtime/dist/managed-execution.js` | `9be4bc502d1b03b1e08d7747dc12bb3c6a7b47e4431800f119331335881825c6` |

Remaining integration checks are concrete handoff checks, not requests to rerun unchanged device matrices: owner final passing tests and clean commit containing integration `4914bb8`; final APK/runtime source map including these two rebuilt modules; final twelve-criterion evidence map retaining the prior failure scopes; parent acceptance/explicit merger authorization and public-data audit. If those correspond to this source, no further source blocker remains from this review.

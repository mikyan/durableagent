# V1 implementation review — findings and repair verification

Fixed base: `c8071d539847091a64e081a33ffe6c642fe9eeb4`.
Reviewed implementation: `a8ee9c06a706fbaad051562f95ea50d5ddbe538f`.
Command: `git diff c8071d539847091a64e081a33ffe6c642fe9eeb4...a8ee9c06a706fbaad051562f95ea50d5ddbe538f`.
The two agents reviewed independently under the code-review skill. This review ran while final device validation was ongoing; it does not claim T12/T17 acceptance. Later commit `342c1b7` adds notification observation tooling only.

## Standards

No confirmed documented-standard breach. One **P3 possible Duplicated Code** judgement: the recursive canonical JSON implementation is duplicated in managed-execution.ts, file-writes.ts, submission.ts and projects.ts. These functions underpin durable identity comparisons/digests; extract one behavior-preserving pure function so fixes do not diverge. This is a maintenance finding, not an observed runtime failure.

A separate candidate, not counted as a confirmed finding: NativeRecoveryAccess.restoreRunning seeds lastWake from a durable record before checking platform job publication. A failed publication followed by owner reconstruction may suppress an identical wake. An actual Android regression is pending.

Full notes: `v1-review-standards.md` in this directory.

## Spec

1. **P1 — initialized executor is not started by ordinary execution/recovery.** ExecutionAccess invokes ExecutionTermuxGateway only for explicit connect; production ordinary/recovery calls use the saved peer socket, and only the UI emits connect. This contradicts the requirement that ordinary cold startup/recovery be managed by the app. Static call-chain proof is complete; actual executor-death regression is pending.
2. **P2 — Retry-After is ignored.** Real Application and Pi SDK with a synthetic 429 / Retry-After:120 made the second request after 1,027 ms. Response sanitization drops headers, provider retries are disabled, and the durable retry uses fixed backoff. The spec explicitly requires respecting Retry-After and stricter SDK budgets. Fixed regression and RED are retained.
3. **P2 — pending native sends recover in reverse order.** Submissions.recover iterates the descending native list. A real SDK/SQLite-adapter regression creates FIRST then SECOND before admission and observes SECOND then FIRST after reopen. This is an implementation error in preserving the saved queue intent; FIFO is the behavioral interpretation, not a fabricated verbatim spec sentence. Fixed order regression and RED are retained.

No independent scope creep was found. Known OEM/hardware gaps are not new code findings. Full notes and exact reproduction files: `v1-review-spec.md` in this directory.

Standards: 1 judgement finding, highest P3. Spec: 3 confirmed findings, highest P1. The wake candidate remains unconfirmed and excluded from these counts.

## Repair ownership and gates

The existing T12 implementer `t12_complete`, in its isolated `codex/t12-resume` worktree, is the single fixer for all review findings. Exploration agents may provide read-only guidance; no other agent edits implementation. Retain all RED evidence, run the same fixed regressions after repair, inspect the final code delta and resulting APK, and request independent merger review only after the gates pass. T17 final integration and physical/OEM limitations remain separate.

## Wake follow-up: confirmed and locally repaired

The former wake candidate is now a confirmed P2. Actual Android test `aReopenedOwnerRepublishesItsPersistedWakeWithoutAnotherInput` failed on C233 after 15.590s: the durable wake survived and a new owner was created, but the identical job was not republished. Root read the original failure log and frozen metadata. Main C233 + test ADD944 are retained at `D:/durableagent-validation/t12-wake-reopen-red01`.

Removing only the assignment of the durable wake to the in-memory publication cache produced GREEN on main 02BB43 with the exact same ADD944 test APK, 7.332s. Root read the GREEN log and production diff: same admission, owner reopened, actual job present, zero model requests. Logs are `t12-wake-reopen-red01-device.log` and `t12-wake-reopen-green01-device.log` beside this report. This is a focused repair, not final joint acceptance; the final native candidate must also retain same-owner publication retry and Job-only foreground lifetime behavior.

The original independent axis reports above remain historical. Follow-up adds one confirmed P2 to the Standards candidate; full repair verification is still pending for the other four findings.

The Standards reviewer independently checked both frozen test/source metadata and the RED/GREEN logs, then appended the confirmation to its original report. Updated findings against the pinned HEAD: **Standards 2 (one P2 documented breach and one P3 judgement smell), worst P2; Spec 3, worst P1.** The Standards P2 now has focused GREEN; its final integrated lifecycle checks remain pending. The two axes are not merged or reranked.

## Pending-send order follow-up

Owner repair `08cbe61de4990b59cfa2d5d74ebea851bf96a471` gathers pending intent identities across every descending native page, then reverses the complete list before admission. It uses durable sequence order rather than wall-clock timestamps and reuses normal admission checks. Root inspected the committed nine-line change and independently reran the original unchanged fixed regression: exit 0 in 0.92s, native listing remains SECOND/FIRST while recovered SDK user history is FIRST/SECOND. This is a local actual Application/Pi SDK/SQLite-adapter test, with synthetic model transport, not Android or real-cloud evidence.

Root log: `v1-review-pending-order-root-green01.log`. Fixed script SHA-256: `755F2A14FBFDCDD91BA3C87166FDA67AC2574D4B100814EDC00CC8113F348C35`. Reviewed executed dist/submission.js SHA-256: `8B272A67936E30095596F990701B10F3FAFD6B933F105B1E3635143031CFB92A`. Original RED and owner page-boundary regressions remain retained. Retry-After, automatic executor readiness and canonical refactor remain pending; final combined validation has not run.

## Retry-After and executor follow-ups

Retry-After is now independently closed at **da85f5f2fef23995fb51aeff158fb8775c15f8c2**. The original fixed six-second regression independently passed at ebf9676 (one request, still waiting); final da85 changes only overflow-compaction status projection and its actual SDK regression. Three initial repair gaps have inspected RED→GREEN evidence: concurrent request while deadline commit is held, prepared A waiting after selecting B, and the SDK compaction child waiting without live.generation. See `v1-review-retry-after-fix-review.md`. Full runtime at ebf9676 was 271/271; the later compaction case passed in 1.558s. These are actual SDK/SQLite with controlled transport; they do not claim a 120-second real-cloud rate-limit test. Active waiting still obeys original SDK crash budgets.

The automatic-executor finding is now also confirmed by an actual Android RED, not only static reasoning. `t12-autostart-red01-device.log` records authenticated original executor/ledger, exact owned idle listener PID6290 termination, independently observed absent listener, and an ordinary ExecutionAccess ping with no explicit connect. It fails CONNECTION_UNCONFIRMED in 0.469s. Frozen main02BB/testDF9F07 and source hashes are in `D:/durableagent-validation/t12-autostart-red01`. The listener remains down and pairing/ledger remain unchanged while the sole fixer prepares the existing-only native/helper repair. This finding remains open; canonical refactoring and final combined validation remain pending.

## Final repair verification — 2026-11-04

The preceding reports remain historical. The same T12 implementer repaired all findings, and the independent reviewers closed their respective findings. Latest focused reports are `v1-autostart-fix-review.md`, `v1-review-spec-final-addendum.md`, and `v1-review-retry-after-fix-review.md`.

### Standards

Both original findings are closed: canonical JSON was extracted without behavior change at `0e207f2` (runtime 272/272), and persisted wake publication was repaired at `0b2f6c1`. Final main1623/test3D99 passed the two wake publication tests (15.889s, same admission, zero model requests) and actual Job foreground lifetime test (56.318s, original owner retained after Job binding ended, exits after stop).

### Spec

All three original findings are closed: pending-send ordering at `08cbe61`, Retry-After at `da85f5f`, and automatic retained executor startup at `374d74d`. The latter passed the same 3D99 Android test in 1.230s after an actual absent-listener fault: original executor/ledger/pairing retained, process epoch changed, no explicit Connect. Final once-effect recovery also passed in 10.448s: original append occurred once, same execution/operation, repeated intent added zero executions. The reviewed helper upgrade retained all138 ledger records, including the exact two old prepared fixtures, and preserved logical ledger/schema/pairing/file tree across install/start; only the two owned helpers and their installation manifest digest fields changed.

A subsequent narrow user-facing omission (manual Termux reopening after force-stop) was repaired by the same owner at `4c52692`. Its actual asynchronous ApplicationClient regression was RED then GREEN (controller7/7). Independent reviewers closed the code/description finding. New frozen mainE7CF/test3D99 changes only UI entries; root independently compared all20 regular non-UI/non-signing APK entries with1623 and verified the packaged source mapping. Native results retain their1623 provenance, rather than being relabeled as tests ofE7CF.

Standards: 0 remaining findings (original2 closed). Spec: 0 remaining original findings (original3 closed); additional force-stop description code finding also closed. T12 independent merge acceptance and T17 actual final product/real-MiMo/force-stop/OEM verification remain separate delivery gates; this review does not assert all17 tickets are complete or authorize marking the PR ready.

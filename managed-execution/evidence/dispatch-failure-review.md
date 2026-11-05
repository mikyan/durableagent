# T09 production05 failure — independent narrow review

Scope: read-only review of owner source, fixed SDK 1.5.0, existing safe device evidence, and a separate host probe. No owner source edits, ADB, credentials, remote writes or new device claims. This is a T09 scoped follow-up, not the final whole-branch review.

## Established facts

- Production05 `f4ba097` DispatchGate catch discarded every exception and returned an assistant `error` event whose reason/stopReason were `aborted`, with `运行已停止`. A native readiness failure, synchronous Models throw, or thrown stream iteration could all produce that same persisted message.
- The original device observation (`t09-production-05-observation.log`) shows original conversation phase `failed`, reason `运行已停止`, the `EXEC_RECONNECT` user entry, and only five execution receipts. It does not retain an original exception category. The 03:46–49 section of `t09-production-05-failure-uid.log` reports the public-state timeout but no original INPUT/STOP code. Therefore temporary native contention is possible, not proved as the production05 cause.
- Native `pendingStopsJson()` calls `NativeInputStore.pendingStops()`, which takes the same `StorageDomainLease` as other operations. The runtime service and Activity bridge use independent store instances. `StorageDomainLease.acquire` uses a stable inode and nonblocking `tryLock`; another holder produces `INPUT_STORAGE_BUSY` even for this control read. It must not be treated as an empty stop list.

## Candidate classification review

Reviewed candidate `runtime/src/dispatch-gate.ts` SHA256 `6ce4bd80e03641edecd974b52d741d2bff6de1abf19926a53b869885412f18f4`:

- Only an actually aborted invocation signal maps a caught failure to `aborted`/`运行已停止`.
- Other caught failures map to `error`, distinguishing readiness versus Models invocation. Bounded protocol code validation excludes arbitrary exception text; raw errors/credentials are not copied to the persisted message.
- Existing wait, shared-check and last synchronous hold/signal guards are unchanged. Readiness failure does not enter Models.
- Fixed SDK `AssistantMessageEventStream` completes on the emitted error event; result and iteration both terminate normally. No manually built scheduler or retry state is introduced.
- SDK `harness/generation.js` lines625–653 applies its own retry classifier and otherwise persists one failed run/unanswered submission. `运行前检查未完成（INPUT_STORAGE_BUSY）` is **not** retryable under fixed `pi-ai/utils/retry.js`; it does not silently start a new model request. This change improves truthfulness and diagnostic resolution, not automatic availability recovery.

## Independent verification

1. `node --test test/dispatch-gate.test.mjs` in runtime: **5/5 passed**, including immediate pause/abort, shared concurrent check, safe readiness classification and actual signal cancellation.
2. External `t09-dispatch-sdk-review.mjs` compiles the original fixed source and current candidate in memory, then runs both through actual SDK Harness + real SQLite with retries enabled and the same synthetic readiness failure. Output: `t09-dispatch-sdk-review.json`.
   - Both: one control check, zero model requests, one user entry, original submission `unanswered`, zero requests after close/reopen.
   - Old05: persisted `aborted`, `运行已停止`.
   - Candidate06: persisted `error`, `运行前检查未完成（INPUT_STORAGE_BUSY）`.
   - Both classifier results nonretryable. Synthetic private exception detail absent.

The host probe does not prove what occurred on Android05. Initial probe setup import path was corrected before the successful run; no owner code changed.

## Remaining device diagnosis / safe boundary

No new source blocker found in the reviewed classification patch. Parent/root should run the original Android matrix using the newly observable category. If it confirms transient lock contention, a later bounded, abort-aware retry may be placed only around the pre-dispatch control read (rechecking the entire stop state after each wait). Exhaustion must remain an explicit failure with no Models call. Do not cache an old empty pending-stop list, replay an uncertain write/submission, translate BUSY to cancellation, or add an application model retry loop. Actual provider calls already started are a different boundary and must not be replayed merely because an outer wrapper throws.

## Production06 device follow-up and disposition

Independently read root's actual `t09-production-06-matrix.log`: **1/1 passed, 48.817 s**, containing the unchanged six scenarios. Success, nonzero exit, large output, native cancellation, timeout and reconnect all produced records; large output read totals **1,200,000 bytes / 74 pages**, fresh host added **0** model requests. This was the classification-only production change, not an increase to sleep/timeout or retry.

Frozen artifact mapping in `t09-production-06-apk-inspection.json`:

- App SHA256 `5c2d9fc445439e1ce590c0f9e47b2a97a17e95475834e5ef5a9b39f8a9c4ff91`.
- Test SHA256 `36a563432820aff14026defd3be1bb31a7f60693f63f25f8d938aecc9296c853`.
- Packaged/reviewed DispatchGate source hash equals the independently reviewed `6ce4bd80...` above.

The read-only original05 investigation (`t09-production-06-control-observation.log`) independently confirms native control **version0 / generation1 / stoppedThrough0**, no pending stop, and original latest input accepted/acknowledged, `cancelled:false`, SDK `unanswered` with reason `model_error`. Reopening did not redeliver. Thus there is no evidence of a real user/native stop behind the old message; the pre-fix error category is irretrievably absent. The successful06 rerun does **not** establish BUSY or a provider exception as its cause.

**Scoped T09 conclusion: no remaining concrete blocking finding from this review.** The definite false-abort classification is fixed, checked through real SDK/SQLite, and the unchanged Android matrix now passes. Retain original05 failure and this causal limit in evidence. Bounded automatic recovery from transient control-read unavailability remains a later T12 concern, not a claim delivered by this patch. This conclusion does not waive final T09 evidence/commit review, remaining OEM validation, or the final all-ticket branch review.

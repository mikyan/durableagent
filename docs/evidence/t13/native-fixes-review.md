# Independent targeted review — UI lease acquisition and dispatch projection

Reviewed 2026-11-04. Frozen production: `D:/durableagent-validation/t13-provider-projection-green01`, main SHA256 `fedf063ccde1492599b24bb8a489f80f5486f7b9a286a66272446e9a79aa0849`. Compared the two native production changes against `t13-provider-review-final02`. No repository source, ADB, credential or remote operation performed.

## One concrete inspection risk (performance; not device-reproduced)

**Configuration can acquire a busy storage monitor on the Activity main thread.** `NativeInputBridge.kt:14` now constructs its store using `.withLeaseWait(1000)`. `AgentActivity.kt:32` constructs that bridge during `onCreate` on the main thread. `NativeInputStore.withLeaseWait` (`NativeInputStore.kt:44–46`) takes the same companion-wide `monitor` that `locked` holds while acquiring an external OS lease and performing its action. Thus, if recreation/opening overlaps an older UI bridge/source worker waiting for a competing process's lease, new Activity construction can wait on that worker's storage monitor, potentially for its remaining one-second lease wait (plus any other queued contention). Keeping the later action on an executor does not avoid this construction-time lock acquisition. The code path is established; its real-device frequency and visible latency are not measured here, so this is not reported as a device-proven regression or functional stop defect.

An inexpensive follow-up is to configure the bounded wait without acquiring a busy process-wide storage lock on the Activity thread, for example as a constructor-only immutable setting set before the store is published to workers. Keep the existing default of zero, the one-second pre-action wait, and one execution of the transaction. This recommendation is based on the call/lock path, **not a newly run device reproduction**. The existing real WebView short-lease test validates action waiting after Activity creation, not recreation while another worker holds that monitor. No broader redesign or new acceptance requirement is implied.

## Dispatch projection: no confirmed defect

- Native policy storage remains version 1; incompatible versions fail through SQLiteOpenHelper upgrade/downgrade handling. Registration in that deployed format deliberately omits `dispatched`.
- `requireStart` writes Boolean true in the durable native transaction before allowing the Provider action. No normal stored-row path removes it. Public `operationView` now projects absent v1 fields to Boolean false, retains true, and rejects present non-Boolean/null values with `DATA_SAVER_STORAGE_FAILED`.
- This normalizes the known ledger representation at its owner boundary; it does not teach TypeScript to infer safety from missing transport data. The strict same-identity receipt/policy checks and explicit `dispatched === false` start gate remain intact. Terminal/interrupted/unverified phase restrictions remain.
- `providerRecord` still preserves raw ledger information; native `requireStart` reaches strict `operationView` before a new action. This review found no new path through the delta that turns malformed dispatch information into a grant or repeats an already-dispatched write.

## Thread and stop scope

After initialization, `NativeInputBridge.execute` runs actions on its writes/source executors and only delivers results on the Activity thread. The wait is before entering the action; it does not retry an action, COMMIT or response. The default store stays fail-fast. `input.stop` still uses `NativeStopController.request` and its separate original store, with no new automatic stop retry; native notification stop admission still runs in the existing `:control` service. Ordinary UI requests retain their existing writes queue, so this is not evidence of a new priority queue or latency guarantee.

Reviewed root log `t13-ui-lease-green01-device.log`: one freeze request/response, freeze227ms; unreleased lease fails visibly at1016ms, no SDK owner/model/send. Root's original native projection RED (0.221s, false versus absent) and frozen RUN were also inspected. This reviewer did not rerun Android tests and does not certify the final whole ticket. Earlier runtime-fix review remains a separate result; actual React and final combined-device results remain root-owned.

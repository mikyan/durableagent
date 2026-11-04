# Scoped follow-up review — native UI wait configuration

Reviewed 2026-11-04, source worktree `C:/Users/AI_BA/.codex/worktrees/t13-data-saver/durableagent`. Scope: the construction-time configuration concern from `final-native-fixes-review.md`, the actual Android regression fixture, and the evidence README's eleven-criterion mapping. No ADB, source edits, credentials, model requests or remote actions by this reviewer.

## Source finding

The minimal production fix is sound by inspection: `leaseWaitMs` remains a per-instance Long with default zero, is now volatile, and the validated `withLeaseWait(0..2000)` assignment no longer acquires the companion-wide storage monitor. All inspected production call sites configure immediately after constructing the store. Other mutable storage state (`helper`, `closed`) remains protected by the original monitor.

`locked` reads the value once to compute an absolute acquisition deadline before entering the operation. A later configuration assignment cannot extend that in-flight deadline. OS lease acquisition, action/transaction execution, failure behavior, user-stop routing and commit handling are unchanged. There is no action, COMMIT or response retry introduced by this delta.

## Actual test credibility and results

The new test uses a real OS storage lease and an ordinary NativeInputStore inspect operation on a dedicated thread. It waits until that reader is sleeping in its acquisition loop, then posts construction of a new NativeInputBridge onto the actual Activity main looper. It requires construction to return within500ms while the original read is still pending; only then does it release the original lease and require the same read to complete. It does not invoke a private method or emulate the monitor. The `input-only` mode does not instantiate ApplicationClient, and this fixture submits no model request or send.

Frozen test SHA256: `497e5f215392dd2a2fa7ccd8d0a1c784227cccf698e54155fcb229d51599a72f`.

Root's retained `t13-ui-config-red01-device.log` confirms1/1 failure in3.797s on unchanged FEDF main at the intended construction assertion. This reviewer has inspected that log. GREEN is pending at this checkpoint; this report must be updated before final disposition.

Scope: this is a regression test of bridge construction on the main thread. It does not prove that all Activity lifecycle methods, all main-thread storage paths, or every possible unrelated monitor wait are nonblocking. It also does not measure real-device incidence of the original contention.

## Evidence mapping

The README's eleven-row mapping correctly states separate development slices and preserves controlled-boundary, emulator4KiB, actual-network, real-model and OEM limits. It retains initial failures and the stale next-row PNG from UI07. No concrete overclaim was found in the inspected mapping, subject to updating the pending UI08/09 and final native configuration rows as their evidence arrives.

## UI08 test investigation, separate from the production delta

`visible`/`touch` currently require viewport visibility and DOM hit-testing but do not require the grant button to be enabled. The production button is intentionally disabled while its exact prepared final digest is unavailable, while another policy action is pending, or while policy state is unconfirmed. A native operation can already be waiting while the UI has not received its prepared digest; such a visible disabled button must not be treated as an actionable grant.

The parent/root reports UI08's actual waiting screenshot shows that disabled button. This is stronger evidence than the speculative coordinate/timing explanations. Requiring the same operation's button to become enabled before the one physical touch, and recording passive trusted pointer/click events, is an appropriate test correction. It must not retry the grant, reopen the failed input, or convert the failed UI08 run into a pass. This reviewer has not yet inspected the PNG or the corrected test; those remain separate pending observations.

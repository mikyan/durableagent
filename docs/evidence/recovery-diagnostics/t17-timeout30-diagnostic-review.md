# T17 timeout30 diagnostic: bounded static review

Reviewer: `/root/t12_complete/recovery_native_read`

This note records the completed read-only static review of three test-only files in `C:/Users/AI_BA/.codex/worktrees/t12-resume/durableagent` and their frozen copies in `D:/durableagent-validation/t17-timeout30-diagnostic01/snapshot`. No source changes, tests, ADB commands, credential reads, or model requests were performed by this reviewer. Actual Android observer and real-model results remain for root to verify separately.

## Exact source correspondence

Each working file matched its frozen snapshot by SHA-256:

| File under `android/app/src/androidTest/java/dev/durableagent/probe/` | SHA-256 |
| --- | --- |
| `RecoveryFailureObservation.kt` | `85e4c1cd6b132a4739f4bf7a8be45ece6e5c9cafb4eb94509452e405b700343c` |
| `RecoveryFailureObservationTest.kt` | `4a543a412caa820223414ed85083f4f0536e165686db04ad37ad662d72e44e6f` |
| `RecoveryRealApplicationTest.kt` | `d9687a34c12fa6d14a265fb6d464b4b056d41dbbb10ecade9ebd14dd4f26d0c2` |

The frozen manifest records main APK `dd7dd5ca97c130ff4ef95b59ae53c95910999d35c3664f6bee99f7490e6e5e5a` and test APK `22fb7d972a01dae5725663c940aab9b8f6672a440c03f5cc89144748c3c35a9e`. These are manifest identities, not a new APK execution or packaging verification by this reviewer.

## Findings

No concrete blocker was found within the requested scope.

- `fixedRequest` uses SQLite `OPEN_READONLY`, a read transaction, `SELECT`, and rollback. It does not instantiate a Harness, execution transport, input store, or credential vault. The referenced canonicalization and SHA-256 helpers are pure static calls.
- Selection requires exactly one active session/family document at the exact intent key. The reader starts at the latest version-1 base and consumes subsequent version-1 deltas in sequence order.
- Complete root or request replacements update the candidate. Unknown verbs, empty paths, and unsupported modifications or deletion of the request are rejected. The reader therefore does not report an old base through an unsupported partial request rewrite.
- Before returning a verified result, the candidate is checked against the existing authenticated receipt digest, execution ID, product ID, SDK conversation ID, and exact expected command. Output is limited to binding identity, digest, timeout, revision identifiers, and verification flags; command and environment contents are not emitted.
- The timeout assertion is after the partial-file observation and binding identity extraction, but before the `before-owner-death` diagnostic, `wire.state()`, UI/connection closure, and `Process.killProcess`. A model parameter mismatch follows the existing failure/stop cleanup path without resending that input.
- The added Android observer test statically covers base-null to complete-request delta, unrelated deltas, wrong digest/execution/command, rejection of a partial request rewrite, later base and complete-root replacement, output redaction, and unchanged main-database bytes. This review does not claim those assertions have executed successfully.

This is a bounded diagnostic-fixture review, not approval of the complete recovery implementation or a finding about the cause of MiMo01.

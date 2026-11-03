# T05 recovery test implementation results

Scope: Windows desktop Node v24.14.1, real Pi SDK 1.5.0, real SqliteStorage/Node SQLite and production Application + ModelConnections. Controlled Provider/HTTP endpoints only; this does not claim MiMo deferred or Android scheduler compatibility. Child owner `t05_vault`; no production runtime edits, commits, ADB or real secret access.

New files in T05 worktree:

- `runtime/test/model-recovery.test.mjs`
- `runtime/test/fixtures/model-recovery-worker.mjs`

Final executed command from runtime/: `node --test test/model-recovery.test.mjs`. Result: 9 passed, 0 failed, 0 skipped, 16,141 ms. The existing dist was built by the parent from the production implementation; rerun npm test for the final combined branch after any production change.

| Public observed case | Result |
| --- | --- |
| Retryable 503 on generation A, select B while durably waiting | Exactly A then B; B uses its independent request-time synthetic key; one original user entry |
| Hold A request, commit current B, await normal close receipt, start new PID | Resumed request still A; resolves rotated A credential at new request time; current B and exact user entry remain |
| Identical held-A/current-B setup, force child termination with child.kill('SIGKILL'), await exit, start new PID | Interruption retry prepares B; exact user entry remains; no orderly close invoked |
| Start deferred H once, enter A/H poll, select B, force child termination, reopen | Poll A/same H resumes; exactly one initial start, current B retained |
| Same deferred crash window with A credential generation changed on reopen | Explicit old-response account-compatibility failure; no additional transport entry/new start through 1,400 ms observation (retry backoff 1,200 ms) |
| Same deferred crash window with A disabled durably | Explicit old-connection-disabled failure; no additional transport entry/new start through same enabled-retry observation |
| Actual manual compaction through public Harness/Conversation API | Four original user turns; A summary entered, current changed to B, retryable response, A retry entered, normal close/reopen, A summary resumed/completed. Three A summary requests, final real summary entry, original user IDs unchanged, current B retained |
| Overdue retry behind configuration load barrier | No transport during configuring barrier; releases only after explicit load completion; one retained user entry |
| Secret audit positive control | Detector rejects deliberately planted synthetic marker before relying on clean real DB/WAL scans |

Transport entry is observed by the parent HTTP server, not a scheduler mock or a child's counter that resets on death. Parent counts all requests across child generations and holds actual HTTP responses. Real final checkedFetch adds independent synthetic credentials; parent compares them in memory and never logs raw headers. Normal close waits the Application/Harness close completion and IPC receipt before process exit. Force termination never calls close and asserts a nonnormal exit plus replacement PID. On this Windows host Node reports forced termination via the SIGKILL request; this is not a claim about POSIX kernel signal delivery.

Every held generation/compaction/deferred checkpoint window audits actual DB plus live WAL before close, all three synthetic credentials (A/B/rotated), and audits again after reopening and close. A positive control demonstrates a detector failure. Test data are independent temporary databases; no existing product table or scheduler state was patched. Only external model transport/credential fixture is controlled; real scheduling, checkpointing, retries, observations, storage and publication are retained.

The compaction worker imports public Harness, Conversation.configure/compact/entries/agent/waitForTask and uses real ModelConnections. It adds no product compact button and imports no private scheduler methods. The ordinary scenarios use the production public Application Interface. Separate direct test helper operations (rotate/close/kill/release configuration) are fixture orchestration, not new product actions.

Initial red executions were observed for missing child worker, unsupported compaction fixture command and missing configuration-gate fixture command before implementing those fixtures. Two task-result assertions were corrected after consulting published TaskRecord/TaskOutcome types (state.status terminal, state.outcome.status completed); this was a test shape error, not a production defect. No uncovered production failure remained in the final 9 cases.

Remaining project-wide acceptance: parent combines UI/native and real MiMo tests; root owns Android final APK/Keystore first-unlock evidence and final log/secret audits. No desktop result here replaces those rows.

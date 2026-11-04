# Durable submission boundary (T07)

The product `send` action accepts only a native `intentId`. Draft text, source URIs, mutable attachment selections and arbitrary SDK submissions are not alternative admission paths. UI, routing and bundled Agent extensions use the same Application Interface.

## Authorities and commits

1. The UI flushes its current native draft, freezes complete supported representations, then saves a new explicit native action. The independent Android input database binds `actionId === intentId` to product ID, SDK association, opaque workspace expectation, fixed token/revision/digest, queue policy and control generation. A repeat of that action must match its original payload; an explicit second send gets a new action even when its text is identical. Restoring a draft creates no action.
2. The sole SDK owner reads the durable intent and checks existing admission first. New admission reads product/configuration, current binding, admission document and SDK request ID before any table write. `conversation.submit(tx, ...)` is the first table write; the same SDK commit writes the admission family member, immutable binding record and current binding reference. Product creation is a separate commit with its existing stable creation identity.
3. Native confirmation is a different database transaction. It stores the verified SDK receipt and clears the draft only when author revision, text and every ordered ready representation still match the fixed input. Repeated confirmation returns the same receipt with the current draft and `draftCleared:false`. A changed revision, including A→B→A, or a newly prepared representation preserves the later draft.

SDK `requestId` alone does not validate payload equality. A replay verifies the native intent, optional native receipt, SDK admission, original binding and actual SDK submission together. Missing or conflicting parts are `ADMISSION_INCONSISTENT`; the application does not repair them by inventing a new identity or editing SDK tables. An already accepted retry returns its original binding even when current location metadata later changes. New admission with a changed expectation is refused. T08 owns editable projects and binding release.

`sendStatus` and `sendList` are read-only. They do not call SDK submit, wait or resume and do not write native confirmation. A lost response is repaired using the same intent. An uncertain COMMIT can have persisted every SDK record even when the Session fails; reopen queries the original identity before deciding whether admission is still absent. No cross-database transaction or exactly-once cloud billing is claimed.

## Readiness and stop

Missing native input/control authority fails startup before writable SDK open. Configuration loads and pending native stop scopes are checked before public readiness. Normal startup only reconsiders persisted explicit pending intents; cancelled intents and unsent drafts never dispatch. Unavailable model/credential/input conditions preserve the intent for visible inspection.

Native `stoppedThrough` is a durable cancellation fence, not proof that SDK execution already ended. A new explicit action after a stop advances the control generation. Old action retries and late ACKs cannot advance it or clear a pending abort. A new generation waits for the exact old abort scope to be verified; malformed existing control rows fail closed rather than defaulting to an unstopped state.

The SDK's abort and submit methods can implicitly resume its scheduler. `DispatchGate` therefore holds new model invocation during startup maintenance and the cross-database admission window. Every actual chat stream, deferred fetch and complete/compaction call checks native pending stops before entering Models; concurrent callers share the check. SDK abort signals can end a waiting invocation, including when the check itself aborts that invocation. No application task scheduler or second inbox is introduced.

The gate's boundary is admission into a Models invocation. A request already inside a Provider, including one awaiting credential resolution before HTTP, is an in-flight invocation. T07 does not claim atomicity between a native stop transaction and a network request. T11 owns native emergency control and the full external-effect cancellation path. Current T07 checks cover stop during SDK admission, either edge of native ACK, startup with due retry work, and concurrent model dispatch.

## State and retention

Native delivery (`pending`, `uncertain`, `acknowledged`) and cancellation are shown separately from SDK input progress (`queued`, `placed`, `done`, `unanswered`). Queued does not mean the model read the input; placed only establishes transcript placement. Input settlement does not imply the conversation, after-run tasks or external effects have finished. The UI can reread durable state after lost notifications. A stream is not a durable event log.

Intent-held frozen objects remain pinned in every state, including acknowledged or cancelled. `input.discard` refuses an intent-held token and GC cannot remove its bytes. Conservative retention is intentional until a later verified lifetime/cleanup policy; T07 does not delete a user's source or make backups include private data.

The native schema 2→3 migration adds intent/control/action records without reconstructing sends from old drafts. Native metadata and fixed representations remain CE-private with the existing WAL/FULL/FK and backup exclusions.

## Validation entry points

- `npm test` includes 13 shared submission callbacks using the fixed real SDK and two actual SQLite databases, plus three dispatch-gate race tests. `validation/submission-authority.mjs` is a test platform adapter; production uses Kotlin NativeInputStore. Older T04–T06 tests use `validation/application-fixture.mjs` to perform draft/freeze/intent steps, not a production text-send bypass.
- Android `NativeSubmissionStoreTest` and `NativeSubmissionCrashTest` cover native transactions, pins, CAS, migration and six native intent/ACK/stop process-death barriers. Native-only ACK fixtures use synthetic receipts and do not independently establish SDK acceptance.
- Android `NativeSubmissionEndToEndTest` uses actual Application/SDK associations and receipts at four native intent/ACK process-death windows. `SubmissionApplicationTest` adds the two actual SDK SQL COMMIT process-death windows, the shared SDK callbacks, real React and opt-in real MiMo.
- Debug controls 36/37/38/40 are not WebView actions: arm a known synthetic boundary, observe its owner PID/stage, kill only a halted owner, or run shared policies. Actual SQLite before/after-COMMIT hooks are enabled only in explicit validation fixture/hang domains. `ack-drop` withholds confirmation after actual SDK acceptance; it does not mock a model reply.

Device pass/fail results, exact candidate hashes and platform limitations belong in `docs/evidence/t07/README.md`. This interface description is not device acceptance evidence.

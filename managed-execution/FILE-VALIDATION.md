# T10 implementation evidence (in progress)

This journal records incremental engineering checks. T10's twelve acceptance criteria are not yet accepted. The T09 execution evidence in `VALIDATION.md` remains distinct.

## Actual Termux batches

These batches run on the existing Android 16 / 4 KiB emulator in the official Termux terminal. Each frozen batch has a SHA-256 manifest, an immutable launch marker, a retained log and an exit-status file. The temporary test executor and target files are separate from the production executor, pairing and accepted command ledger. A fixture that launches a worker confirms its own execution scope through public `list`/`query`/`cancel` before removing its temporary files; an unconfirmed scope retains the directory and fails.

| Batch | Actual result | Evidence |
|---|---|---|
| Python RED02 → GREEN02 | Expected missing fd metadata; then 2/2 pass | Binary pages and precise failures; an opened fd retains the original inode after rename and replacement. |
| Python RED03 → GREEN03 | Expected missing path metadata; then 3/3 pass | `lstat`, strict canonical path, symlink refusal for `noFollow`, missing and not-directory errors. |
| Setup RED04 → GREEN04 | Expected rejection of the new module; then 5/5 pass | Add the manifest-owned file module to a known v1 installation, preserve existing ledger/pairing bytes, refuse downgrade, modified/unmanaged/symlink files and actual live server/guardian locks, resume only a known partial installation. |
| Python GREEN05 | 4/4 pass | Executor dispatch returns file data from its own namespace. Host RED was `INVALID_METHOD`. |
| Python RED06 → GREEN06 | Expected missing write plan; then 5/5 pass | Actual supervised fixed helper writes the original inode, fsyncs and reads it back, returns a real bounded diff, and does not repeat on the same execution identity. Only fixture cleanup changed between RED and GREEN; behavioral assertions stayed. |
| Python RED07 → GREEN07 | Expected missing verification after the effect; then 6/6 pass | Kill the actual helper after target fsync but before result persistence. Verify current original bytes after separately confirming execution scope. Repeated execution identity does not overwrite a later user edit. File observation explicitly does not claim process scope. |
| Python RED08 / RED08b | Capability failures, not the intended feature RED | Python 3.14.8 has no `os.link`; actual `ln` between two fixture-owned private files returns permission denied. The precise rejecting platform layer was not established. Hardlinks are not claimed supported on this target. |
| Python RED08c → GREEN08 | Expected missing capability description; then 7/7 pass | Actual symbolic-link aliases resolve to the same canonical path/object identity. A missing leaf resolves its real existing parent without creating the leaf. |
| Python RED09 → GREEN09 | Expected missing directory reader; then 8/8 pass | Bounded directory pages hold the opened directory after it is renamed and replaced; 152 actual entries include a symlink and directory. |
| Python RED10 → GREEN10 | Expected missing append plan; then 9/9 pass | Binary `O_APPEND` preserves the prefix and repeats the same execution identity without a second append. |
| Python RED11 → GREEN11 | Expected missing staging; then 10/10 pass | 153,600 actual binary bytes are staged in bounded chunks, survive service reopen and duplicate chunks, reject changed chunks, and reach the original through one supervised write. Large diff is explicitly unavailable. |
| Python RED12 → GREEN12 | Expected missing mutation plan; then 11/11 pass | Actual truncate shrinks and zero-extends the same inode, fsync preserves contents, and missing/invalid targets return precise errors. |

The most recent full Python batch is `t10-python-green12`: file module `535f37c3be774b1c84d3249b5ed1887f1ba7b1ab03d2657c3421be60e5a399ff`, executor `6683b8c1975274197d41d058587e8e1f2e7353757cf7132d87424c5ff3db18e9`, unchanged test since RED12 `0caf5c178b0616e7ec835b8eb574ba80d02c87ddefbe3d017c211a2ca78603d4`. It passed eleven tests in 2.629 s. Full logs are retained outside the public repository as `t10-python-*-termux.log` and `.exit`. The owner's limited temporary-test device lease was returned to the root agent after GREEN12 with all runners idle and all own scopes confirmed.

## SDK and UI checks

The host uses the real pinned SDK, Harness and SQLite. Only the external execution/file peer and model transport are controlled in these tests; they do not stand in for actual Termux or SAF proof.

- SDK binary readers assemble 32 KiB transport pages, preserve opened-handle identity, fail on lost handles instead of reopening a path, and use the SDK's public `LineScanner` for BOM/invalid-UTF-8 semantics.
- The actual installed SDK read tool returns selected original text. One initial expectation omitted the SDK's continuation diagnostic; the expectation was corrected without changing production behavior, and the failed log remains.
- Durable writer reservations survive close/reopen, distinguish environment-wide shell occupation from known local paths, include canonical/inode/ancestor overlap, and prevent a queued whole-environment writer from starving. Cancelling a queued claim never grants it later and cannot release an active/unknown claim. A draft-object mutation bug was caught by the reopen test and corrected.
- Two actual SDK conversations now queue arbitrary shell commands in the same writer domain. The inherited cleanup test was updated to expect this intentional serial ordering while retaining the assertion that cleanup cancels only its owning conversation.
- The actual SDK write tool persists a fixed file plan and exposes its original-file evidence after reopen without another external start. An ended command with unconfirmed file effects still blocks project relocation. Later matching original bytes combined with confirmed command scope release that occupation without repeating the write; the missing before-image is reported as unavailable diff.
- UI execution parsing displays the durable writer queue and retains independent native cancellation. Targeted UI controller/render tests: 7/7. Targeted runtime files/coordinator/execution tests: 26/26, including the inherited four actual host-process kill windows. TypeScript and UI production build pass.
- Subsequent reader contracts pass split UTF-8 across 32 KiB, BOM/CR/final-newline behavior, whole-file bounds, and directory pagination (5/5). Full binary writes are bounded to 16 MiB, transport pages to 32 KiB and retained peer staging to 128 MiB; exceeding a bound returns an explicit error, never a successful truncated result.
- Actual SDK write/append/truncate/flush and large staged content tests pass (5/5); external peer remains controlled. Each uses the persisted task/call/ordinal and separate original-file identity. Completed append survives reopen without appending again. T11's four trusted native effect adapter methods are wired; the native effect fixture proves separate file versus command identities and original+scope evidence. Actual Android native-file stop proof awaits the merged T11 candidate.
- A real SDK queue-stop test first failed because the confirmed never-started command still appeared queued. Only a matched `not_started`/`neverStarted`/`scopeConfirmed` receipt now releases the waiting claim. The test verifies no prepare/start for the cancelled identity, the first writer remains occupied, and a later explicit writer proceeds. Related queue/abort/cleanup tests pass 4/4. Logs `t10-queued-stop-{red,green}08.log` retain both outcomes.
- Checkpoint 2 combined runtime file/execution/coordinator suite passes 33/33 (10.922 s), including the existing four actual owner-process kill windows. Log `t10-runtime-checkpoint02.log`. This is host logic evidence, not the combined device acceptance matrix.

## Remaining work

The native original-document adapter, rename/directory mutations/watch contracts, durable edit replay, file-change UI, combined real Android tool flows, actual local/shell write-order directions and queued cancellation, representative actual dependency install/build and shared-filesystem limitations, actual native T11 file-effect integration, and final real model proof are still pending. No production daemon or installed application has been updated for T10 yet. Final OEM/device acceptance remains a separate T17 gate.

The root agent has an external plan `t10-build-capability-plan.md`: install/check real Termux clang/make/pkg-config/zlib, build and execute a C zlib roundtrip in a new private UUID workspace, then separately record authorized shared-storage direct execution and link limitations. This is pending device evidence, not a host substitute or a claimed noexec result.

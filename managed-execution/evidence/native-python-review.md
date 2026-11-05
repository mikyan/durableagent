# T09 independent native / Python review

Date: 2026-11-04. Reviewed fixed owner commit
`21fc11f9cf179556f9e8bef5cf6725734280e73b` against integration base
`fc0ab3dd9b8609ac4f00add235645824b14d70bb`.

**Conclusion: no additional blocking correctness finding on this narrow axis.**
This is not whole-ticket acceptance, a review of subsequent T14 merge changes,
or the final review of all seventeen tickets. SDK/Interface recovery and the
known UI unknown-state projection finding belong to the parallel reviewer.

The owner worktree advanced to f7baf0e during review. Python and Android
Execution*.kt files were therefore extracted with `git show 21fc11f:<path>` to
the external `t09-independent-21fc11f/` snapshot. Setup tools, AgentActivity,
manifest, documented contracts and test coverage were read from the same commit.
No owner source, device, credential or remote state was modified.

## Spec review

The eleven T09 criteria were read together with domain/glossary rules and the
execution, stopping and storage sections of the total spec. The following are
source conclusions; actual device claims remain bounded by VALIDATION.md and
the root's immutable production02/03/04 evidence.

- **Admission identity and replay (criteria 2, 3, 9):** prepare stores the exact
  canonical request, fixed final parameters and stable context in one SQLite
  commit. Same ID with changed request is rejected. Start records the starting
  fact before launching a guardian; the inherited execution lock covers that
  handoff and is not passed to the user executable. Loss of the lock after a
  possible start yields unknown and blocks new identities. The daemon does not
  replay on startup. An authenticated missing receipt permits a durable cancel
  tombstone, not an assertion that no in-flight prepare existed.
- **Truthful process evidence (criteria 4, 8, 9):** cancel of a possibly started
  command first reports stop_requested. The live guardian signals only
  descendants, opens pidfds before rechecking ancestry, and confirms completion
  only after the command exits, pipes drain and waitpid reports ECHILD. Guardian
  disappearance, socket expiry, exceptions and a numeric PID's absence are not
  converted into confirmed stop. ProcessScope.close is intentionally not such
  proof. App cleanup and full T11 stop semantics are a separate review axis.
- **Final parameters (criterion 5):** shell text and argv remain separate;
  inherited environment is frozen at acceptance, with a 64 KiB final JSON
  ceiling. Cwd realpath/device/inode is fixed at prepare, then checked against an
  opened directory descriptor used for child chdir. Missing legacy location
  snapshots and changed directories refuse execution rather than adopting a
  new location.
- **Output (criteria 6, 7):** raw bytes and SQLite chunks retain stream and
  sequence. Raw append requires the recorded offset, a full write and fsync
  before committing its receipt. Failed/partial capture therefore cannot be
  called complete merely because a shortened file hashes successfully. Raw
  reads check the committed range length. Per-command/global raw and chunk
  limits, request/final-parameter limits and retained record limits are present;
  exceeding output budgets requests cancellation and marks captureIncomplete.
  read_output has LIMIT 64 plus byte budgeting; the previously withdrawn
  tiny-chunk frame concern is not repeated here. The 128 MiB figure is correctly
  documented as raw retention, not a whole-directory physical disk ceiling.
- **Transport and native boundary (criteria 1, 10):** the listener binds only
  127.0.0.1:47193 and requires the exact paired client certificate. Android pins
  the server SPKI, verifies its certificate, executor/ledger identity and nonce;
  each operation checks the ephemeral session and request ID. Both directions
  bound framing and timeouts. Native UI has only fixed connect/setup/query/cancel
  actions; trusted Javet has the separate command seam. AgentActivity checks the
  bundled page and blocks external loads. Mutation requests are not retried by
  the socket client; deadline/connection loss remains unconfirmed.
- **Bootstrap and stored trust:** RUN_COMMAND contains only the fixed
  bootstrap/serve launcher and public certificate/nonce. The pinned Termux
  package/hash/signature and permission are checked. The explicit non-exported
  one-shot callback uses a boot/deadline-bound SQLite mailbox. Existing server,
  client and ledger identities are not silently replaced. Android signing keys
  remain in Keystore and pairing/mailbox data is CE/no-backup; Termux private
  keys stay in its UID. Installation preserves existing ledger/workspace/trust,
  rejects modified or unowned scripts, and refuses live server/guardian locks.
- **Independent native control (criteria 8, 11):** cancellation has a separate
  bounded native executor and authenticated socket. UI teardown discards local
  observations without acknowledging remote termination. Actual Node-busy
  cancellation and UI/SDK/Termux scenarios are device evidence supplied by root,
  not inferred from this static inspection.

The historical review findings are addressed in the fixed code: raw allocation
after durable acceptance, short-write/read refusal, actual cwd pinning, truthful
lost supervision, and persistent output-row/final-parameter budgets. No claim is
made that this review injected every filesystem fault or independently reran the
Termux process supervisor.

## Independent bounded checks

Ran exactly three existing public Executor tests against the extracted source
and temporary real SQLite stores on Windows Python 3.14, **3/3 PASS**, 0.172s:

1. Same stable execution identity and receipt survive reopen; changed request
   content is refused without changing the prior receipt.
2. Invalid namespace, command, environment, generation and options never publish
   accepted execution.
3. Cancellation before acceptance survives reopen and rejects late prepare.

Log: `t09-independent-21fc11f/t09-independent-host-metadata.log`.
No command process was launched by these checks. They do not establish Linux
flock, pidfd/subreaper, cross-UID mTLS or Android behavior; those rely on the
already recorded actual Termux/device tests.

## Standards review

No blocking violation of the repository's documented standards was found on
this axis. Naming follows the shared domain distinctions; fixed native and
Python modules own storage/identity/process facts, while SDK scheduling stays
in the application. Tests use public operations and observable receipts/effects;
the private process/crypto diagnostics are limited to opt-in fixtures. No raw
credential logging or portable-CPython-as-Android-proof claim was found.

Dense formatting and module size were not treated as tool-mandated defects: the
repository does not prescribe a different formatter or complexity threshold.

## Remaining acceptance scope

VALIDATION.md at this exact commit still says production04 same-environment raw
output reading is pending. Root reports its actual 1.2 MB pass; the final evidence
record must reconcile that scope and hashes before ticket acceptance. This is a
documentation handoff, not a newly reproduced production failure.

Subsequent T14 integration, the parallel SDK/UI correction, final APK/setup
mapping and public/credential audits remain root/owner gates. No new S23/Xiaomi,
16 KiB Termux bootstrap, T10 file/locking, T11 complete stop, T12 background or
T17 OEM conclusion follows from this review. The established Android 16 / 4 KiB
x86_64 Termux development evidence is preserved without broadening it.

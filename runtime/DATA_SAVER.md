# Data Saver execution policy

T13 is an application policy over registered capabilities. It is not a VPN,
firewall, arbitrary-code sandbox, or promise that a network transition instantly
stops every byte. Model communication continues through configured model
connections; a tool cannot acquire that exemption by declaring a purpose.

## Authorities and identities

`dataSaver.get/configure/operations/grant` are public application actions.
Configuration uses a version check. Android supplies a fresh network identity,
metered flag and access restriction; unknown facts are restricted. Neither UI
state nor a persisted previous Wi-Fi observation authorizes dispatch.

`NativeDataSaverStore` keeps policy and operation records in the application's
private, credential-encrypted, backup-excluded namespace. Its separate durable
initialization marker detects loss of policy storage. A missing or corrupt
previous policy does not silently become disabled. Native database acquisition
may wait before beginning an action; an action or uncertain commit is not replayed.

An execution grant binds the original execution ID, request digest, prepared
final digest, control generation and current restricted-network period. The
prepared digest includes final arguments, working directory and environment.
Reconnection may read the same grant. A new execution, changed request, expired
period, or user-stop fence cannot reuse it. Granting does not disable Data Saver.

Native policy v1 stored rows omit the dispatch flag until the committed start
boundary sets it true. The native public projection makes that known default
explicit as `dispatched: false`, preserves true, and refuses malformed values.
Runtime callers still require explicit Boolean evidence; an absent field in a
transport response is not interpreted as permission to retry.

The final native check samples network and user-stop facts immediately before
transport dispatch. It durably marks that dispatch boundary. A missing response
is resolved against the same execution identity, never by creating another start.

## Controlled local capabilities

Arbitrary Bash, mutable script paths, ordinary executable names and arbitrary
arguments remain unknown. The limited local contracts are checked against the
authenticated executor identity and packaged implementation hashes:

- Fixed built-in working-directory inspection with its exact arguments and clean
  environment.
- Bounded core file RPCs running in the authenticated daemon implementation.
- The fixed file mutation helper with captured implementation bytes, isolated
  Python startup, explicit environment and immutable final arguments.

The executor captures the runner/helper source used by the worker. Modifying
their filesystem paths after admission does not change the accepted operation.
This is a bounded capability contract, not an assertion that a hostile Termux
installation or interpreter is isolated. Legacy persisted file operations retain
their original environment semantics and do not acquire a new local exemption.

The existing app-wide writer coordinator remains authoritative. A verified
`accepted_not_started` operation whose native dispatch flag is false may wait
for policy in `eligibility-waiting`; that state neither occupies the writer nor
blocks eligible local work behind it. Unknown or possibly dispatched effects
cannot use it. Qualification restores the same reservation identity. The
published `app.workspace-writes` v1 document migrates to v2 without losing holds.

## Network changes and stopping

The Android network callback and native sweep do not depend on the JavaScript
event loop. A restricted transition invalidates affected grants and targets only
the recorded managed executions. Cancellation uses authenticated identity and
bounded paged work. An unknown first row does not prevent later rows from being
examined. User stop has higher priority and retains its original generation fence.

`network_policy` cancellation and user cancellation remain distinct evidence.
Interrupted work stays in its original SDK tool continuation. Returning to an
unrestricted network can qualify a confirmed never-started operation; it does not
replay an interrupted or uncertain external effect. The UI explains waiting,
temporary grants and unverified results, and offers conversation stop/new input
without pretending that stopping a wait proves an external effect ended.

The native channel polls an existing operation before applying its elapsed
deadline. This allows a response already completed during a blocked JavaScript
event loop to be collected. It does not extend the deadline of an operation
still pending, repeat `begin`, or replay a side effect.

## Selected original documents

A `content://` URI, Provider package name, write flag or filename does not prove
local access. Generic Provider metadata, reads, writes and verification are
unknown I/O and use their own immutable observation identities.

Selection first retains the actual URI/system grant and a pending metadata
observation without contacting the Provider. `document.list` is a cached catalog
with current system grants and current observation policy state. It does not
claim current original availability. The explicit metadata-resume action grants
only that URI observation; it does not authorize a subsequent SDK read or write.

The original-file verification button also creates a separate fixed read-only
observation. Restricted access is shown as policy waiting, with an explicit
single-observation resume action. Repeating that resume returns the same cached
observation and timestamp. It neither grants a write nor turns matching bytes
into proof that an uncertain write scope ended. Reader descriptors are closed
even when a later policy or authorization check refuses access.

`document_read` commits an `app.document-observation` v1 session-family document
before native I/O. It has no history/fork copying and no checkpoint cleanup.
The original task/call, resource, binding and control generation determine its
fixed observation. A successful observation publishes a private synced snapshot
and complete digest only after whole-file verification. Safe replay returns that
same snapshot, not a new observation. The tool returns at most 32 KiB of text and
explicit truncation metadata; the fixed snapshot is bounded at 16 MiB. Snapshot
pages are at most 32 KiB and the runtime checks their complete digest.

`document_write` has a separate grant over the already-fixed original plan,
expected digest and replacement bytes. It waits outside writer occupancy while
not dispatched. The existing T10 original precondition check, writer reservation,
native generation check, write/readback verification and uncertain-outcome
receipt remain in force. A read grant is not a write grant. Provider file effects
are not sent to the Termux command canceller.

Each native observation owns a stable OS lease before marking dispatch. A
dispatched observation without a result or live lease is unverified; inspection
does not rerun it. A live lease is not mistaken for a lost host. A confirmed
original-file ledger receipt can repair a lost policy-result commit after exact
identity/digest checks. The SDK queries that same original operation after a lost
start response. It only retries the same start when both the matching native
receipt is `accepted_not_started` and the current matching policy explicitly
proves `dispatched: false` with eligibility. A dispatched or uncertain scope is
not restarted. Current native receipt sequences are
read before eligibility checks, so a public file-list/recovery observation cannot
make a still-safe wait submit an obsolete staging sequence.

Transient policy database acquisition uses the actual native `DATA_SAVER_BUSY`
code and keeps the same tool waiting. It can occur before or after dispatch, so
the error code alone is never proof that a write can be retried.
`DOCUMENT_CHANNEL_BUSY` is reserved by the native service for refusal before a
worker is accepted. Both paths recheck the original identity and policy before
any further dispatch. Fixed snapshot page reads retain their operation and byte
offset through temporary authority/storage contention or a lost page response;
each retry checks the control generation and reads only the cached snapshot.

## Validation boundaries

Host integration tests use the real pinned SDK and SQLite, with controlled
external boundaries. Android results, actual network transitions, paired Termux
process evidence and real MiMo calls are separate evidence. The evidence report
must retain candidate hashes, failed runs and their limits; no host fixture is
described as a real device/network result. OEM and physical-device background
coverage remains part of T17.

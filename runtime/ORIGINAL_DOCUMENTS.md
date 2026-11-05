# Original document capability

T10 agent refinement within the accepted native/core split. The core owns one
workspace writer coordinator for both Termux and SAF. Native workers implement
the actual document capability; they do not create another writer scheduler.

The production namespace is CE `no_backup/document-v1`; validation uses
`document-<run>`. Resource identity is SHA-256 of the actual content URI and the
effect namespace is `saf:<resourceId>`. Neither is a shell pathname. The native
registry never supplies a guessed filesystem path to Termux. The separate test
provider's own MediaStore location is only a controlled same-object fixture.

## Boundaries

`NativeDocumentStore` owns platform grants, original FD access, immutable plans,
staged content and operation receipts. `NativeDocumentService` runs bounded I/O
outside the Javet thread with separate Provider-free query/cancel workers.
`NativeDocumentAccess` binds only the trusted Javet adapter. ApplicationService
installs it as `__nativeDocuments`; the fixed core consumes that adapter.

`NativeDocumentBridge` exposes only system selection and observations to the
WebView: `document.select`, `document.list`, `document.describe`,
`document.query` and `document.verify`. A page cannot stage or start an original
write through this bridge. These observations do not wait for the model loop.

Selection uses real ACTION_OPEN_DOCUMENT and only actual returned grant flags.
Persisted permission is reported separately from current permission. A URI
reference does not promise continued access. Metadata can contain unknown
size/time fields; a valid cursor with a null optional timestamp is still a
valid result. No cached contents substitute for a missing or revoked original.

All general Providers currently have `networkAccess: unknown`. A content URI,
authority, file name or write flag is not evidence of offline access. Metadata
queries can also involve a remote Provider. T13 owns the network policy, not a
second document-local policy flag.

## Trusted channel

`beginJson(method, payloadJSON)` returns `{ok:true,value:{operationId:token}}`.
`pollJson(token)` returns a pending value or
`{ok:true,value:{pending:false,result:{ok,value|error}}}`. A token is transient;
the persistent mutation identity is always the caller's fixed `operationId`.
Lost tokens are not permission to replay an original write.

| Method | Contract |
| --- | --- |
| list | Stable resourceId order, at most 20 resources and 60 KiB per page; optional cursor and nullable nextCursor; current grant/status, no body |
| describe | Actual URI identity and current capability/status; no URI-to-path conversion |
| open | Retains a seekable original FD, hashes the whole bounded original once, returns readerId/contentDigest/byteLength |
| read | At most 32 KiB at an explicit offset from that same FD |
| closeRead | Rehashes that FD, reports whether its content/length stayed unchanged, then closes it |
| prepare | Fixes original resource, product, control generation, SDK conversation, expected digest, content digest and byte length; registers native file-effect authority before acknowledging the durable plan |
| stage | Contiguous chunks; only identical acknowledged chunks can repeat; a complete digest is required before sealing |
| start | Requires the core's existing shared claim and the native stop fence; dispatches the fixed operation at most once after its original I/O boundary |
| query | Durable receipt and actual scope proof, independent of a Provider call or the Node loop |
| cancel | Confirms no-start only while original write I/O has not begun; active/possibly active work stays unconfirmed |
| verify | Read-only original observation beside the existing receipt; matching bytes cannot release unknown effects |

Native whole-original access is bounded at 64 MiB; core document tools use a
stricter 16 MiB whole-read/write bound. Eight transient opened readers are held
per store. Non-seekable Providers are explicitly unsupported. Retained FDs are
not durable across process loss and a lost reader is never silently reopened.
External apps and Providers are not globally frozen by the application.
Each retained-reader read and close-time verification rechecks the current URI
grant. Android may keep a previously opened FD readable after revocation; the
application rejects further use. Closing still removes the handle and closes
its descriptor when authorization fails.

## Original write boundary

The immutable request digest canonically covers the fixed plan. Registration
uses the accepted T11 file effect API with `kind=file`, `source=saf`, the same
operation/digest/namespace and the persisted product/generation/SDK relation.
The input-store namespace is fixed by the native host and retained with the
operation, not taken from an untrusted page payload. Native and SDK commits,
native document/control commits and external file writes are distinct commits.

A read-only preflight rejects a stale original digest before opening for
write. Actual original access uses `rw`, never implicit `rwt`. The opened FD is
checked again before the first byte write, including current permission and
the native stop fence after a potentially slow Provider open. The worker
writes/truncates, flushes and syncs, closes the write descriptor, then reads the
actual URI back in full. Only a confirmed return and matching readback produce
`completed` with `scopeConfirmed=true`.

Opening the original for write is the conservative effect boundary. Errors
after that point remain `unknown`; the same ID cannot execute again. The
same-operation OS lease only prevents duplicate dispatch and detects a lost
writer. Losing that lease or observing process death is not proof that a
Provider's effects have ended. A surviving native effect index with a missing
document receipt is reconstructed as unknown instead of receiving new dispatch
eligibility. Historical adoption alone never grants execution permission.

`cancel` persists a no-start tombstone for a prepared operation. For an active
operation it records `stop_requested` with unconfirmed scope; it does not kill
or pretend to kill a Provider. If actual work then returns and passes readback,
the receipt may truthfully become completed. Once a terminal receipt is
confirmed, repeating start returns that history rather than overwriting a
later external edit.

Every persistent receipt includes the complete fixed identity, actual URI,
original marker, state, scope confirmation and sequence. Available before/after
UTF-8 text produces bounded whole-file line differences; binary, over-budget or
unavailable before content is explicitly unavailable. It is never example data.
The public diff uses `available: true` with at most 16 KiB UTF-8 `text`, or
`available: false` with a bounded `reason`. Earlier v2 receipts using only
`state` receive a read-time projection into that contract; oversized old diffs
are reported unavailable. Their append-only snapshots, operation identity,
sequence and scope proof are not rewritten by this projection.

A Provider's absent metadata cursor does not identify the cause. Android can
fold a document-not-found query exception into that same null cursor. Metadata
therefore reports unavailable when that is all the evidence. Opening the actual
URI separately distinguishes a not-found result from a temporary Provider
failure; no stored content is returned as a successful original read.

## Read-only verification

Verification returns the full current operation receipt plus a non-persistent
`verification` object. Stable opened-original reads report `status: read`,
currentDigest, byteLength, matchesExpected, matchesContent and observedAt.
Changing content reports `changed_during_read`; inaccessible content reports
`unavailable`, with a bounded reason/code and no match claim. The receipt is
queried again after reading, so only actual operation evidence may advance its
state. Neither byte equality nor this observation's wall-clock time is terminal
scope proof. A successful read describes the opened original at that observation,
not an eternal promise about a URI or external writers.

## Storage and retention

Document database v1 contained the original-resource registry. v2 adds fixed
operations and append-only `(operationId, sequence)` receipt snapshots. The
supported v1→v2 SQLite migration adds those tables while retaining resources.
Future or unsupported versions fail closed and preserve the database; corruption
does not invoke a destructive reset. SQLite WAL and FULL synchronization are
used with the native storage-domain lease. This is not a hard-power-loss claim.
Cross-process ledger contention waits at most 1.5 seconds before admission.
Only lock acquisition is retried; a transaction or external operation is never
replayed by that wait. Provider calls remain outside the metadata lease.

Private staging bytes are separately synced before acknowledged staging offsets.
Unknown/pending operations retain their necessary plan, bytes, control relation
and receipts. There is no automatic time expiry or document-history deletion.
Reader handles and request tokens are transient; losing them does not delete
the registry, operation evidence or original. No registry/receipt cleanup also
deletes a user's original or a workspace file. These app-owned CE records and
staging bytes fall under the existing private-data backup exclusions; external
Providers, MediaStore originals and Termux remain their own storage owners.

Actual component evidence and explicit limitations are maintained in
[T10 SAF evidence](../docs/evidence/t10-saf/README.md). SDK/coordinator/Termux and
real model acceptance belong to the complete T10 owner, not this native slice.

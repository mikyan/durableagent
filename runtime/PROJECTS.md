# Projects and adopted execution positions

T08 extends the public application Interface with the data-only descriptor in
`project-protocol.ts`. React and extensions use the same `projects.get`,
`projects.create`, `projects.rename`, `projects.select`, `workspaces.create` and
`workspaces.update` actions. Mutations carry an operation identity and the expected
catalog version. Reusing an identity with different arguments is an error.
Receipt lookup uses own properties, so valid identities such as `constructor` and
`__proto__` are not mistaken for inherited object members.

Project names, workspace names and current associations are shared application
documents in the one SDK Storage/Session. A project references a workspace; a
product conversation references a project or the common default workspace. No
conversation directory is created. Name changes do not change the adopted
position version. Successful position changes advance the workspace or association
version and release only the current binding pointer; historical receipts and
bindings remain unchanged.

## Configuration is distinct from actual access

The configured locator contains a stable workspace ID, version, environment and
absolute path. The native send expectation hashes the workspace ID and configured
path to detect changes. This hash is **not** a filesystem identity or proof of
access. `LocationAdapter.inspect` supplies the separate actual identity and one
of available, unverified, missing, revoked, environment-changed or ambiguous.
Absent an adapter, the UI reports unverified. Binding resolution rechecks actual
access before returning an execution environment; changed or unavailable access
does not redirect to the default directory. Ordinary model conversation does not
require filesystem access.

`ApplicationOptions.workspacePath` initializes a new catalog once. T09 can supply
the executor's authoritative default path at setup. Existing T04–T08 development
catalogs may contain an app-private path that Termux cannot access. They retain
that configured fact until an explicit, version-checked `workspaces.update`
succeeds; no migration silently redirects accepted work. T08's controlled adapter
and `location_witness` validation tool perform no filesystem or shell operation.
Real Termux access and real alias/write coordination belong to T09/T10.

## Admission and lifetime

The T07 submission transaction resolves current shared configuration, checks the
native expectation and creates/reuses an immutable Binding before calling the
SDK's public `conversation.submit`. Submission, admission map, binding and the
conversation execution pointer commit together. Queued work, followups and SDK
recovery use the adopted binding, not a fresh global path lookup. Reconciliation
of an old accepted intent returns its original receipt after a later position
change and creates no new input.

An association with an adopted current binding is checked against related
workspaces and actual aliases. Shared workspace relocation checks every related
product and inherited conversation. A fresh conversation without an adopted
binding may select another workspace while another conversation uses the default:
that action does not relocate the shared directory. Its own pending intent and
stop barriers still block the change. Once it adopts work, the full lifetime
checks apply.

The guard reads SDK inbox, live-run documents and every page of nonterminal tasks
in the same SDK transaction as the proposed change. Background, sleeping, waiting,
blocked and completing work cannot be treated as idle. Durable execution-binding
documents retain internal descendants after a terminal owner disappears from the
live task graph. Native pending/uncertain intents, unresolved aborts and unsettled
SDK submissions are additional blockers. Settled history alone is not occupancy.
Unknown actual identities are conservatively related; different record IDs do not
prove disjoint locations.

`EffectAuthority.withSnapshot` must hold a stable admission/receipt lease across
its callback and SDK commit. It supplies whether managed-effect knowledge is
complete and which binding IDs still have unresolved effects. Unknown knowledge
blocks changes. T08 has no effectful executor in production; its validation adapter
tests the contract. T09's durable execution ledger must implement this seam before
its environment is installed. A snapshot taken and unlocked before the callback
is not a valid implementation.

## Two-store fence and recovery

The trusted native authority persists a location-edit fence in independent native
SQLite before any location precondition reads. New send intents are refused while
the fence exists; exact old actions can still be read/replayed. Draft saves,
durable stops and late admission ACKs continue. Application creation, admissions,
stop maintenance and project mutations share the application coordinator; no
second SDK scheduler or submission state machine is introduced.

After SDK commit, trusted `finishLocationEdit` validates the complete known-product
context set, updates it and clears the fence in one native transaction. Ordinary
snapshot/subscription publication cannot install another context while fenced or
regress versions after release. A lost finish response is checked from the current
fence. Exact operation replay and startup recovery publish the canonical SDK
configuration that actually committed, never a remembered proposed edit. A failed
or uncertain SDK commit retains the fence until reopening determines the durable
result. Explicit business refusal releases the fence without saving a delayed
proposal; the user must retry after the blocking work is resolved.

Native schema 4 preserves v2/v3 drafts, objects, operation receipts, intents and
stop facts. Missing or malformed fence state fails closed. Existing T07 current
bindings gain a location only when their stored expectation exactly matches the
provable current product/configuration; missing or conflicting associations do
not receive an invented default or replacement receipt.

## Internal conversations and execution integration

The public SDK `conversationCreated` hook inherits the execution document without
registering a product conversation. An ordinary task child takes its owner's
binding. A fork retains the history source's binding; its control domain follows
the actual task owner, which may differ from the history parent. An ownerless fork
retains the copied control domain. `submitBoundInternal` accepts later input only
for an inherited, verifiable binding; product user input still uses native intent
admission.

The adapter receives `AdoptedBinding` with `id`, `location`, `projectId`, optional
proven `actualIdentity`, `sourceProductId`, `controlProductId` and target
`sdkConversationId`. `sourceProductId` is location provenance; `controlProductId`
is the root control association. Neither freezes a control generation. T09 must
capture the command/task's control generation with its own durable execution
intent and validate the current native control gate. Tool task identity and call
identity come from the actual SDK tool context.

## Verification

`validation/project-policy.mjs` registers 16 public Interface checks against real
SDK 1.5.0 and SQLite. The same callbacks run in desktop `npm test` and the Android
debug owner through control 42, using an explicit private temporary directory.
They include SDK commit response loss, native finish replay, busy background
descendants, fork ownership, alias/effect refusal, fresh-conversation escape,
legacy binding migration, actual provider parsing of the bound witness tool, and
late position/product reads that must not mix configuration versions. Whole-view
version validation retries after a concurrent catalog change; an old position
inspection cannot overwrite the current catalog's identity projection.

Android additionally exercises actual native transactions and four independent
process kill barriers, the real React project controls and an opt-in MiMo tool
roundtrip. The witness proves which adopted environment reached the SDK tool; it
does not prove Termux access. Exact APK hashes, results, initial failures and device
scope are recorded in `docs/evidence/t08/README.md`.

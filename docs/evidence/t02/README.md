# T02 SQLite contract validation

Validation date: 2026-11-04. This report covers the T02 candidate/storage foundation, with dedicated synthetic data. It does not select all production tables or claim power-loss testing.

## Fixed implementation and reproduction

- Runtime/native packaging and SDK closure remain T01's pinned Javet Node Android **i18n 6.0.3**, Node **26.13.0**, Pi Durable/Pi AI/pi-schema/Chord **1.5.0**. The exact dependency lockfile is unchanged.
- Storage is the actual published `SqliteStorage`, with actual `@earendil-works/chord/sqlite/node` `NodeSqliteDatabase` over `node:sqlite.DatabaseSync`. No SQLite schema constraints or SDK files are patched.
- Official adapter initialization selects WAL/NORMAL. The application seam explicitly sets **FULL**, reads back `journal_mode=wal` / `synchronous=2`, and records actual engine/source/build options before opening/migrating Storage. The native host holds a process-exclusion file lock before Node/SQLite/Session creation, through teardown.
- `createStorageConformance` is the fixed SDK's runner-independent set used by `registerStorageConformance`, with all 32 cases and real Node assertions. It is run unchanged. Fifteen additional shared cases cover the driver, failure/receipt windows, migrations, Session failure and deferred dependencies.
- Run `npm ci --ignore-scripts --prefix runtime`, `npm test --prefix runtime`, then build the Android APK pair as described in [runtime README](../../../runtime/README.md). Select only `dev.durableagent.probe.StorageProbeTest` for T02. Add `realProvider=true` after explicitly provisioning its encrypted validation capsule to include the bounded two-request MiMo conversation.

Agent refinements within the agreed seams: select and verify FULL rather than accepting the adapter default; acquire a stable native lock before migrations; keep fault fixtures in UUID-named private directories; use immutable test record identities to inspect uncertain outcomes. These are validation/storage-foundation decisions, not a new product message store or production migration/backup design. [Published SDK file hashes](sdk-source-hashes.json) and [APK inspection](apk-inspection.json) tie the tested files to the fixed dependency closure.

## Test design and actual results

Desktop validation: **62 tests passed**, including the six existing T01 behavior tests, 47 shared SQLite checks, six real child-process kills/recoveries, persisted Harness conversation/reopen, canonical-domain ownership, and a synthetic secret audit against live WAL. Red/green steps included a missing storage seam and a persisted-conversation test that returned an empty transcript before real SQLite was connected; both then passed. [Raw desktop output](desktop-tests.log).

The final second-pair suites passed **5/5 Android tests on each device, no skips**, including the live Provider case. This clears T02's specified storage/transaction/process-recovery gate on these conditions; it is not a background-survival or power-loss certification.

| Environment | Conditions | Final result |
|---|---|---|
| Galaxy S23 / ARM64 | Android 16/API 36, OS page size 4,096 bytes; display awake, keyguard still showing after initial user unlock; fingerprint `samsung/dm1qzcx/dm1q:16/BP2A.250605.031.A3/S9110ZCS7EZCI:user/release-keys` | 5/5 passed in **20.467 s**; [raw awake result](s23-final-awake.log) |
| Official Google API 36 16 KB emulator / x86_64 | Android 16, OS page size 16,384 bytes; fingerprint `google/sdk_gphone16k_x86_64/emu64xa16k:16/BE2A.250530.026.F3/13894323:userdebug/dev-keys` | 5/5 passed in **44.852 s**; [raw result](emulator-final.log) |

Each device passed all 47 shared checks and all six actual process-death/reopen windows. The real MiMo case made two requests, stored five transcript entries, reattached every UI binding to the same host, then gracefully closed and replaced the host; the new host read the identical entry IDs/text with zero model requests and no credential. Abrupt-crash evidence comes from the six dedicated barriers, separately from that graceful conversation test. Terminal snapshots now report `nativeOwners=0`, `domainOwned=false`. No physical ARM64 16 KB device was available; ARM64 ELF/ZIP alignment plus the actual 16 KB x86_64 run are separate evidence.

Independent review checked the implementation, reran the targeted second-batch-precheck and live-WAL-marker tests (2/2), verified the final APK against all compiled sources, and parsed/asserted both final device logs. All review findings are resolved. [Independently reviewed metrics](reviewed-metrics.json).

Root's exact-key audit scanned 24 T02 external/versioned evidence files with **zero matches**. On both devices the encrypted capsule was consumed/deleted; only public DER remained in the credential provision directory. The two live runs used the same request-time-only authentication seam as T01, with added pre-commit and pre/post-close storage checks.

Actual Android engine: **SQLite 3.54.0**, source ID `2026-10-09 15:46:58 be8d059e9a49089ab2dce5ed26dd87aaf598fdc5fbe0b107c0dd758464bcd5e3`. The selected owned connection reports WAL, FULL (`2`), busy timeout 5,000 ms and WAL autocheckpoint 1,000 pages. [Full build options and binding diagnostic](engine.json). Low-level isolated driver tests use the SDK factory's default NORMAL except where the failure/crash fixture explicitly selects FULL; they do not establish the application's durability policy by themselves.

Final second-pair APK SHA256: app `1bee8a2c9da254f4c97af700cbebab3d6520ab863083fdf03c119116b0b638a9`; instrumentation `3226c5a9035865fc356eeb1be28042c03339e3c4198caf4f15cd3e29806a4e39`. Independent inspection verifies both APKs with `zipalign -c -P 16 4`; both native libraries are uncompressed, 16 KB ZIP-aligned, and byte-identical to the T01 i18n AAR's inspected ELF. All ten compiled runtime modules, package.json and lockfile match the worktree. Embedded runtime archive SHA256 is `609b6090097bb1724f9bec517b3381f0cbdd9ea2db4704157a2cb3842d253e86`.

| Contract | Verification |
|---|---|
| SQL compatibility | Real STRICT table, JSON CHECK, partial unique index, UPSERT and bindings for string/Chinese/emoji, number, bigint, blob and null. Actual SDK schema migration/read/write also runs. Out-of-contract boolean behavior is recorded separately. |
| Count and isolation | Database and transaction `runCounted` exclude two trigger writes. Reads, writes and another transaction queue behind a held transaction. Handles reject after success and each failure path. |
| Failure semantics | Callback error identity survives successful rollback. Failed rollback preserves both errors. Pre-COMMIT failure rolls back; post-native-COMMIT response loss leaves a durable row. No rejection is relabeled as absence. |
| Batches/receipts | Upstream prefix-refusal, ordering, sequence and receipt-time visibility cases pass. Nth apply error rolls back all batches. The second batch's database precheck fault proves the first batch had already written inside the transaction, then verifies both are absent after rollback/reopen. A thrown receipt consumer does not invalidate the receipt already delivered or rows already committed. |
| Session failure | A post-COMMIT communication fault permanently fails/closes that Session. Further commit is rejected; reopening finds the same stable entry once. There is no blind replay. |
| App metadata | A Session callback changing an app document and appending an entry either commits both or neither. Normal close/reopen retains both. Native input and Termux effects are outside this transaction. |
| Ownership | Native stable-inode file lock precedes migration/Session open. Independent-process contention, duplicate starts, UI unbind/rebind, process death and reacquisition are exercised on Android. JS canonical-domain guard covers concurrent host callers and holds reservation until actual storage close. |
| Process death | Six exact barriers: before entry write; after write inside transaction; after native COMMIT before receipt; after receipt; after deferred progress publication without storage receipt; during schema 1→2 after old task table dropped inside the uncommitted migration. Reopen checks the same IDs without repeated logical writes. |
| Schema/version | Real SDK migrations create schema 1 then upgrade to 2, retaining a conversation and pending task. Both injected error and process death during migration preserve old data; reopening performs the supported migration. Newer schema rejects unchanged. App document version mismatch rejects while retaining original content. |
| Deferred progress | Existing latest/initial conversation document changes only in memory and is visible to an observer, with zero stored publications. Process death drops that progress; admitted input, stable request ID and prepared execution intent remain. A dependent commit reading that progress forces persistence; entries cannot be deferred. |
| Real Provider | Explicit MiMo scenario uses encrypted capsule/request-time auth, persists real tool/follow-up conversation, checks exact-secret rejection before every storage commit and scans DB/WAL/SHM bytes before and after close. A synthetic marker test verifies the audit catches a secret in WAL before checkpoint/truncation. A fresh host then reads the same transcript without a key or network call. |

## First Android run and correction

The [first 16 KB emulator run](emulator-first-failure.log) executed five tests: four passed (including live MiMo persistence and all six process-death windows); the shared suite failed on an extra negative assertion that boolean binding must reject. The public Chord 1.5 `SqliteValue` contract is `null | number | bigint | string | Uint8Array`, so rejection of boolean was not a required contract. Node 24.14.1 rejected it, while Android Node 26.13.0 bound `true` as integer `1`. [Node 26's primary documentation](https://nodejs.org/api/sqlite.html#type-conversion-between-javascript-and-sqlite) explicitly maps JavaScript boolean to SQLite INTEGER. The final suite retains every contracted binding/constraint assertion and records boolean behavior as diagnostic data. The first failed run remains evidence; it is not reported as a gate pass.

Independent review also strengthened the batch-precheck fault to occur after a written prefix, added live-WAL credential auditing before close, and corrected the terminal native ownership snapshot after releasing its lock.

The S23's [first second-pair attempt](s23-dozing-failure.log) began with display dozing/keyguard locked. Its app UI process stopped progressing in platform state `D`; after screen wake it returned to `S`, and the one live request settled as unanswered/timeout rather than a successful conversation. Root stopped only the validation package, preserved its data/log, supplied a fresh encrypted capsule and started a fresh UUID test run while the screen was awake. See [initial screen state](s23-initial-screen-state.txt) and [platform observations](s23-platform-state.txt). This is recorded as an OEM/background execution limitation, not erased as a storage success. No claim of T12 background survival, wake scheduling or successful model cancellation while suspended follows from this storage gate.

## Durability limits

`receive` confirms the selected SQLite transaction has returned from COMMIT under WAL/FULL. A document watch can publish deferred state earlier and is not such a receipt. A crash after COMMIT but before receipt has an unknown caller outcome until reopening inspects stable identity. The experiments terminate an application process; **device power removal was not performed**. SQLite documents that FULL adds a WAL synchronization at each commit; this requests a stronger synchronization policy but does not independently prove this device's hardware/controller/filesystem guarantees or zero loss under power failure. See the primary [synchronous pragma](https://sqlite.org/pragma.html#pragma_synchronous) and [WAL behavior](https://sqlite.org/wal.html#performance_considerations).

Files are dedicated validation data under a fresh run UUID. Tests never wipe the app's data, an existing user database, or Termux. Known live secrets are held only in memory; public evidence excludes secret values and device serial numbers.

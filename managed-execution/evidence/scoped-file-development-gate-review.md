# T10 scoped development-gate review

Decision: **PASS within the documented development scope.** All twelve T10 criteria have implementation and evidence mapped below. This accepts the original-file and writer-coordination development gate; it does not complete T17 device/OEM acceptance or the final all-ticket code review.

## Reviewed integration

- Accepted integration base: `4914bb88dbd73a8f4c02673a4ae7f71bc34dd739`.
- Final owner commit: `6465c0f49cf9df41637d52410a1c90034108850c`, containing that base, with a clean owner worktree.
- Independent no-fast-forward merge: `f91685b621a6eb3b4416626bbed7e7a8d90b3511`.
- Merge tree: `cb1c59eb4debdf588945849da7f6f800ba0150fc`, exactly equal to the owner commit's tree. No merge conflict or production source adjustment was necessary.
- This record is a subsequent documentation commit. Its only non-document change removes an extra blank EOF line from `ui/test/execution-page.test.tsx`; it changes neither test behavior nor the packaged application.

The earlier [independent source review](t10-independent-gate-review.md) records the actual cleanup defect and its independent counterexamples. Its pending-handoff status, and the equivalent pending inspection language in the owner's journal, describe the earlier review checkpoint. This record completes those handoff checks without changing their historical facts.

## Acceptance map

| Criterion | Reviewed evidence and limits |
| --- | --- |
| 1. Queryable original changes and real bounded diff | [First tracer](t10-android-first-tracer.json), [shared-original trace](t10-android-shared-original.json), and SAF canonical-diff checks. Unknown shell scope, binary data and unavailable before-images remain explicitly unavailable; no illustrative diff substitutes for evidence. |
| 2. Default/project location binding | Accepted T08 immutable binding and relocation guards, integrated with actual file operations. Workspace identity, execution namespace and current access remain separate checks. |
| 3. File and Bash access to the same original | Actual binary/canonical/readback tracer and [real model file chain](t10-android-real-files.json); root separately verified exact original bytes through normal Termux. |
| 4. Authorized original, independently verified | Distinct-UID SAF system selection, persisted grant and read/write/readback checks; the actual held-Provider trace and independent Bash/Provider readers inspect the same original. |
| 5. Honest SAF capability failures | [SAF component journal](../../docs/evidence/t10-saf/README.md): revoked permission, unsupported Provider behavior, original failures, retained reader identity, storage classification and Node-busy native/UI observation. Each run keeps its own artifact identity. |
| 6. File Interface contracts | Four pinned SDK file cases across separate 3+1 actual runs; actual Python 14/14 plus binary, append, truncate, fsync, regular-file rename, held-fd and directory-reader checks. Public watcher tests cover reconnect overflow; unsupported directory/temp mutations are not advertised. |
| 7. Real dependency/build/exec constraints | [Private zlib build](t10-build-private.json), [actual additive uthash installation/build](t10-uthash-install.json), and [shared-storage observations](t10-build-shared.json). Actual shared noexec and link restrictions remain limitations; private symlink success does not imply universal hardlink support. |
| 8. Common alias/local/environment coordination | Real SDK/SQLite canonical/object/ancestor and FIFO claim cases; actual Provider write held in flight while conflicting Bash waits. Unknown shell and SAF writes share the conservative file domain. |
| 9. Both queue directions and stopped waiters | [Local-first stage](t10-android-local-first.json), [Production06 shell-first and queued-local cancellation](t10-android-writer-queue.json), and held-Provider-first trace. Pure tools continue; cancelled queued writes never start. |
| 10. Durable unknown occupation | Persistent coordinator/reopen tests, [actual file-owner death](t10-android-file-owner-death.json), and native Provider owner-death evidence. Disconnect, idle, lease expiry and process death are not proof that future writes are impossible. |
| 11. Configuration and outstanding effects | T08 accepted guards plus pending binding/control-owner integration and real SDK original-effect relocation refusal. Historical references alone do not hold a location forever; other applications are not globally locked. |
| 12. Effect before result persistence | Actual file-owner death verifies original bytes once with zero added execution; native Provider observation can match bytes while scope remains unknown. Neither path blindly repeats an original write. |

The [complete implementation journal](../FILE-VALIDATION.md) preserves commands, test identities, intermediate failures and the narrower scope of each result. Workspaces remain execution context, not a safety sandbox.

## Cleanup correction and verification

Independent review found that environment cleanup could overlook an active SAF operation and permit a later original write. The final implementation applies the existing owner identity `(bindingId, actualSdkConversationId)` to both command and original-document operations. It queries/cancels immutable identities, requires confirmed terminal scope, and does not release unknown effects. A synchronous final closed-owner check fences preparation/start after awaited policy reads.

The unchanged independent counterexample now observes zero Provider starts and unchanged original bytes. Two additional real SDK/Application/SQLite probes confirm a held preparation response cannot dispatch after cleanup, and another actual SDK owner sharing the binding is unaffected. Owner regressions separately verify active unknown scope, queued no-start, command cleanup and reader cleanup. See the [red/green and full-check ledger](t10-cleanup-checks.json): four owner cleanup cases, three independent checks, **221/221 runtime tests and 81/81 UI tests**, no skips. Transport/model fixtures are synthetic; these host tests are not labelled actual Android Provider runs.

Ordinary T11 stop does not call environment cleanup. The SDK tool/generation lifecycle does not automatically call it either. Thus this correction does not close a valid newer native control generation merely because an ordinary stop occurred; deliberate cleanup retains the previously accepted T09 closed-owner contract.

## Final artifact correspondence

Production07 was built from the final owner source. **Production07 was not rerun on a device.** Its focused cleanup correction changes two product runtime modules and is covered by the real SDK host proofs above. Earlier Production05/06 and SAF device checks retain their original APK identities. The merged SAF final storage-failure classification has its own dedicated component device proof.

| Artifact | SHA-256 |
| --- | --- |
| Production07 app | `209554436fc72db1a2909241b9534eb437ec7784d714452e27514c6de317f80c` |
| Production07 test; identical to the actual final Production06 stop fixture | `550249bf7e4e4a993c7c0fff9135ce619a571c49afcfc6d31678b8716e490ea3` |
| Embedded runtime ZIP | `8e6c3a072f35117aa4477b60d458bd26601b88592e147a23c126c0d81d16fc43` |
| Packaged `dist/document-writes.js` | `ed2d1d840cf58710a398784e2f13588e55a9f8b16c6b5da095682a7e98b2c9da` |
| Packaged `dist/managed-execution.js` | `9be4bc502d1b03b1e08d7747dc12bb3c6a7b47e4431800f119331335881825c6` |
| Unchanged execution setup asset | `94db1e48a3d39ff52beafd31243dcab07a41d4a81fc89ea862c82ebadbdb3ff8` |

Root's `t10-production07-root-inspection.json` verifies all 66 runtime entries, 11 UI assets, four SDK packages pinned to 1.5.0, exact setup/Python bytes and the pinned ARM64/x86_64 Javet native libraries with 16 KiB ZIP/ELF alignment. This reviewer independently checked all 193 recorded source hashes, the actual app/test hashes, runtime ZIP hash and the two packaged cleanup modules against the reviewed working bytes. No mismatch remained. The artifacts and inspection files remain in the external `durableagent-implementation/t10-production07-android` evidence directory and its sibling root inspection record.

## Retained failure and device boundaries

- Production04 shared-original and real-model failures remain failures. The former led to bounded metadata-lease admission before actions, without replaying transactions or writes; the latter exposed the insufficient opt-in validation HTTP budget. The subsequent Production05 whole passes are independently attributed.
- Production05's whole queue failure is not relabelled a pass. Its immutable missing-target position correctly refused a changed identity; a later no-start proof is retained. Production06 establishes a fresh stable original before the new race and passes shell-first in 31.828 s and queued-local cancellation in 22.111 s.
- The original T11 compatibility fixture failed with `INPUT_STORAGE_BUSY`. Later observations prove the old target and independent witness stopped with confirmed scopes and the next draft saved, but the exact failed freeze/create boundary is unknown. The revised test-only bounded lease admission/diagnostics passed in 18.383 s; no action retry or established production root-cause fix is claimed.
- Actual T10 Termux/file evidence here primarily concerns the documented Android 16, x86_64, 4 KiB emulator and separate SAF component runs. Native library packaging alignment is not proof that the pinned Termux bootstrap works on a 16 KiB x86_64 image.
- Physical S23 locked/visible-UI limitations, Xiaomi device coverage and remaining T17 OEM acceptance are unchanged. The reviewer performed no ADB, credential, remote or existing Termux mutation during this gate review or merge.

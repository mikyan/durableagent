# T15 scoped development gate review

2026-11-04: **pass for the recorded T15 development scope**. Reviewed final
owner `461fbe9c66a38ad3e4e8c7bc30ffb4620be6e430` and merged without conflict as
`7dd31d9968eb4459a857f840184d31014f72c578`. The merge tree exactly equals the
owner tree. Root retains GitHub publication and execution-status ownership.

Pinned comparison: integration `a0b161c119a3ad0fafd7eb652289ac86f5904e84`
to candidate 16 source `c44d8ceeae3c2bf740891d09f1a4f95ee2dcc2d2`.
Final production `c868f0c60bd3336525ea5024d07181742ef87351` changes only
file diff text, association-summary and path colors over candidate 16. Final
owner adds evidence, a read-only observer and README scope clarification, with
no further product-source change. This is a scoped independent merger review,
not whole-product acceptance or T17 physical/OEM acceptance.

Read implement-spec and code-review workflows; repository AGENTS, tracker,
domain rules, glossary, parent spec/index, T15, prototype explanation, WebView
ADR and SDK data-authority research. Read current GitHub #16/#1 and both comment
lists (none); #16 still had thirteen unchecked criteria. This task explicitly
prohibited further subagents, so the standards/spec axes below were inspected
by this reviewer; it does not claim the final two-agent all-ticket code review.

## Standards

No actionable documented-standard violation found in the inspected scope.
React consumes the existing application Interface. Native input remains the
draft/send authority; the SDK remains the history/context/execution owner.
No direct private SDK-table access, prototype fixture display in product mode,
general approval queue, file scanner, or independent runtime scheduler was
introduced. Existing compact source style is not treated as a new blocker.

Native camera capture uses an opaque private JPEG, a non-exported provider and
temporary URI grants; cancellation preserves the native draft. Target intents
validate exact namespace URI and stable ID, then resolve only existing
conversations, without create/send. The original independent picker finding is
closed by releasing the picker writer before resuming pending autosave, while
preserving the cancellation result.

The inset listener is installed before page load and owns actual system bars,
display cutout and visible IME occlusion. Child handled types/cutout are cleared
to avoid applying the same geometry twice. The earlier independent native
review and final candidate 16 cold/reused WebView and IME evidence retain their
own scope; no renderer-cache cause or universal WebView behavior is inferred.

## Spec

No remaining source/spec blocker or scope expansion found within the recorded
development scope. The final readable diff gate passed; T12/T17 boundaries
remain explicit. Context
comes from public SDK Conversation.context() and the resolved model limit; it
is explicitly a UTF-8-byte/3 estimate of committed messages, not cumulative
usage or a provider token count. Images degrade to unavailable. Search states
its loaded-page scope and uses stable IDs. Auxiliary UI unmount only releases
its own subscription; application execution continues.

## Thirteen-criterion mapping

| Criterion | Implementation and bounded evidence |
| --- | --- |
| 1. Current-session search, jump and previous/next | HistoryNavigator searches loaded public history, labels missing pages and focuses stable message identity. Console component regressions cover earlier-page search and independent drafts; candidate 14 real tablet search/jump records supplement them. |
| 2. Home and shared detailed-page navigation | Independent home plus conversation/list/projects/tools/models/settings routes use the shared top bar. Component navigation makes no send/create/execute call; candidate 14 phone navigation and real rotated settings reachability cover visible access. |
| 3. Default creation and separate conversations | Top-right create uses the existing default-session action. Stable activeId and native per-session drafts remain; component switching, native Console intents and actual UI SIGKILL recovery retain separate histories/drafts. |
| 4. Context/model/YOLO and system authorization | Composer metadata and detail panel label all three; YOLO text distinguishes operation approval from Android authorization. Position/status warnings remain independent. Narrow, large-font and candidate 16 IME screenshots show the metadata. |
| 5. Real context projection | Public context.get reads SDK active context/model, estimates committed content with explicit exclusions, degrades images to unavailable, and displays a separate model limit. Real SDK integration and component tests cover the contract. |
| 6. Independent bounded detail panel | Grid button precedes attachment plus; same entry on both layouts. Panel has bounded height, internal scrolling and a reachable close bar, with current model/workspace/context/status. Large-font RED and corrected real screenshots are retained. |
| 7. Compact attachment menu/camera/cancel | Nearby image/file menu and only available camera; system selectors own access. Actual Camera2 capture/cancel and candidate 15 actual DocumentsUI cancellation plus injected concurrent edit/UI death preserve unsent native text. |
| 8. In-session input anchor | QuestionAnchor measures the latest user input against the transcript viewport, jumps to its stable ID and can dismiss. Phone pixels and physical jump/dismiss records plus focused UI tests cover it; no system overlay exists. |
| 9. Responsive sidebars/IME/font/rotation | 900px content breakpoint defaults wide navigation/auxiliary panels; phone opens the same panel on demand. Candidate 14 1280dp and 360dp/150% font records, candidate 16 cold/replaced WebViews and real portrait/landscape IME/rotation cover the reported emulator scope. |
| 10. Genuine file changes and limits | Existing T10 receipts feed original/copy markers, bounded diff and unknown/binary explanations. Candidate 16 actual Termux roundtrip, four SDK contracts, independent normal Termux read and unchanged retained-run history/intents establish the facts. Its dark-text screenshot and candidate 17 summary failure remain retained; candidate 18 actual native screenshot visibly resolves body/path/summary contrast without resending. |
| 11. Honest input/send/stop/failure states | Existing durable projections remain; short-window summary retains known stop facts when a read fails. T15 real MiMo 401 uses one explicit invalid-key request with Chinese guidance/raw category, and navigation preserves the same intent/history. Candidate 16 visible Data Saver wait/grant/next wait/stop covers the accepted T13 integration. T12 recovery is not claimed. |
| 12. Auxiliary UI extensions | AuxiliaryPanel mounts existing ExtensionPage/real timeline through the application client. UI tests and actual mounted/closed-running timeline screenshots preserve draft/execution and release only UI resources. |
| 13. Approved Console visual/interaction baseline | Real phone, narrow/large-font, tablet-shaped emulator, camera, navigation and IME screenshots were retained separately from synthetic SDK content and actual MiMo/Termux facts. This reviewer visually inspected phone anchor, large-font details, expanded tablet, real 401 and final candidate 16 landscape IME; candidate 18 retained diff was also inspected and is readable. |

## Verified artifact and evidence facts

- Independently hashed frozen candidate 16 app, test and source ZIP and checked
  byte counts against ARTIFACTS-candidate16.json: all three match. App SHA-256
  `c77c95e6a61f5bfd8194e1ae6b2cb2bb1a6cb8286c8e6e380012aec23adbf074`, test
  `b9722ecd598de73d4a158a3b7d7c7c9506bd12b009c8328abef20c8d168f937e`.
- Read retained candidate 16 UI 99/99 and focused runtime 33/33, build success,
  actual Console grant 1/1 (17.317s), actual Termux full file run 1/1 (65.2s),
  four SDK file contracts and host reopen zero added requests. Root's original
  source/APK report covers 70 runtime, 11 UI and 221 source entries plus pin and
  ZIP/ELF 16 KiB alignment; this is packaging, not 16 KiB execution evidence.
- Independent normal Termux read reports 19 bytes, `真实修改-after\n`, digest
  `e2a6658f4505bef21e5d7df7e4911130eecd466a54a82635aa0d25cda9fd451e`.
  Retained-diff02 before/after are done with the same seven intents and 21
  history items, no next page. Reviewer inspected its unreadable PNG and
  agrees it cannot count as visible acceptance. Candidate 17 made body/path
  readable but its summary was still dark; final candidate 18 explicitly colors
  the summary and the real retained-diff04 PNG is visibly readable. Its done
  phase, seven intents and 21 history items remain unchanged, with no next page
  and no send step. See [candidate 18](CANDIDATE18.md), [actual observer
  record](raw/t15-candidate18-retained-diff04-observation.json) and
  [actual screenshot](screenshots/t15-candidate18-retained-diff04-retained-original-diff.png).
- Independently verified final frozen candidate 18 app, source ZIP and retained
  candidate 16 test APK hashes/byte counts: all three match
  [ARTIFACTS-candidate18.json](ARTIFACTS-candidate18.json). Final app SHA-256
  `ce24d14f10310f4f0323e19cc91118a804e01a03cd2d3f17be7e884f8b54ea45`.
  Root's [independent entry comparison](raw/t15-candidate18-root-entry-comparison.json)
  records 21 non-UI entries byte-identical to candidate 16, and identical JS/HTML
  after actual generated asset-name normalization. Only CSS foreground colors
  differ; no fresh file execution, model request or Data Saver run is claimed.
- Independently checked retained evidence manifests in the final owner:
  candidate 16 **112/112**, candidate 17 **10/10**, candidate 18 **11/11**,
  total **133/133** hashes and byte counts, then rechecked all 133 after merge.
  Seven evidence checkout files initially differed only by CRLF/LF; restored
  their exact committed LF bytes without a Git content change. The final owner
  README distinguishes current gates from its candidate 14 historical snapshot.
- Root reports its final owner publication audit passed **1244 files and 465
  unpublished objects**, exact UTF-8/UTF-16LE/UTF-16BE checks at every offset,
  with positive controls and zero actual-credential/private-serial matches.
  The private audit stays root-owned; this reviewer did not inspect credentials.
  Final integration audit and publication remain root-owned.
- Candidate 14/15 UI/native/runtime, camera, picker, process recovery and real
  MiMo evidence remain attached to their own source/APKs. Original failures,
  testing-driver failures and intermittent inset experiments are preserved.
  T06's original selection-preference cause remains unknown.
- No ADB, model request, credential operation, Termux mutation, remote mutation
  or broad repeated test was performed by this reviewer.

## Remaining bounds

Android 16/API36 x86_64 4KB emulator and resized tablet layout are the actual
reported environment. Physical tablet, S23 unlocked visible/lifecycle matrix,
Xiaomi 15 and other OEM/WebView versions remain untested here. T12 integration,
its retained completion notification opening the exact conversation in the
final joint build, recovery and the final all-ticket review belong to their
later gates. Do not turn these batches into one final-APK all-green matrix.

Standards: no actionable finding. Spec: no remaining blocker within this
recorded development scope; later T12 joint notification and T17 OEM gates remain.

# T10 SAF component evidence — work in progress

2026-11-04. Component of T10, not whole-ticket acceptance. Device checks use a
dedicated `dev.durableagent.saf` application and separate-UID
`dev.durableagent.documentsfixture` provider on Android 16 emulator-5584
(4 KiB pages). Only synthetic provider files are changed. No existing user
documents, main application data or Termux installation are changed by these
SAF component traces.

The public native document capability and real system picker are the test
boundaries. The provider owns its original bytes under a different application
UID. Its independent control reader is the external observation; it is not an
application-private attachment copy or a mock ActivityResult.

| Trace | Actual target RED | Actual GREEN | Scope |
| --- | --- | --- | --- |
| System picker and retained original | 1 failure, 52.164 s, DOCUMENT_UNAVAILABLE after actual DocumentsUI selection | 1/1, 52.18 s | Persisted read/write grant, actual URI and original marker, 9 binary bytes including NUL and non-UTF-8, registry close/reopen, independent provider unchanged |
| Held reader across provider replacement | 1 failure, 0.4 s, DOCUMENT_READER_UNAVAILABLE | 1/1, 0.309 s | Same opened FD reads original inode after provider renames it and replaces the URI target; a new reader sees the new object; a closed reader does not reopen silently |
| Immutable original write and readback | 1 failure, 0.358 s, DOCUMENT_WRITE_UNAVAILABLE | 1/1, 0.655 s | Same fixed operation, immutable plan, staged bytes, original write, independent provider readback, receipt reopen and no duplicate write after external replacement |
| Queued and active cancellation | 1 failure, 0.603 s, DOCUMENT_CANCEL_UNAVAILABLE | 1/1, 0.95 s | Queued cancellation durably prevents a write FD and indexes confirmed no-start; cancellation after independently observed original bytes while Provider readback is held stays unconfirmed until actual readback returns |
| Trusted Javet channel | 1 failure, 0.593 s, DOCUMENT_CHANNEL_UNAVAILABLE | 1/1, 0.704 s | Actual Javet binding and bounded begin/poll read requests access the independently owned original |
| Native writer process death | Phase A expected process crash; phase B 1 failure, 0.121 s, verify unavailable | Same interrupted run phase B 1/1, 0.232 s | Independent Provider observed 26 changed bytes before root killed only the writer; reopen stays unknown/scope false, matching actual bytes do not release it, same ID never writes again |
| URI grant revocation | 1 failure, 0.207 s, held application reader still returned bytes | 1/1, 0.434 s | Actual permission revocation denies fresh and retained app reads and close verification; the separate raw platform FD remains readable, so no OS descriptor-cancellation claim |
| Canonical bounded original diff | 1 failure, 0.759 s, actual write completed but `available` missing | 1/1, 1.18 s | Literal small before/after text matches; a real 17 KB write has unavailable/text_budget, with independent Provider readback |
| Provider failures and stale precondition | Initial test failed in 0.672 s on an over-specific metadata expectation | Corrected observation 1/1, 0.762 s | Real moved original/open not found, temporary Provider error, non-seekable pipe, unsupported write flag and stale original are distinguished; rejected writes open zero write FDs |
| Native observations while Node busy | Initial 15.143 s failure: preceding fixture failure left original moved away | Same observation test 1/1, 23.785 s after explicit fixture restoration | Actual React original panel and native receipt bridge return while real Node busy loop is still active; independent native barrier has ended=0; zero model requests |
| Native storage admission | Corrected fixture target 1 failure, 0.383 s, raw IllegalStateException for occupied storage path | Same test 1/1, 0.538 s | v1 resource upgrade, future v99 byte-preserving refusal, resource retained after fixture compatibility restoration, occupied namespace returns storage failure and preserves the existing file |

RED preconditions passed separately: genuine picker grant, distinct UID,
independent literal binary bytes and real bundled page where relevant. Reader
and write traces reuse the grant actually obtained by the first trace. They do
not grant a synthetic URI permission to themselves. Store close/reopen is not
process-death validation. The later two-phase native writer trace proves its
explicit interrupted boundary, not SDK Session reconstruction or OEM behavior.
These results do not establish restart, hard power-loss or final device acceptance.

## Shared original and preserved failures

The separate fixture creates and publishes its own MediaStore Downloads file
through normal Android APIs. `shared01` failed after actual picker entry because
the fixture unboxed a nullable timestamp (156.593 s). `shared02` fixed that
listing but failed after real selection (44.459 s): a valid metadata cursor with
a null timestamp incorrectly triggered the application's unavailable fallback.
Both original failures remain in this directory. With explicit cursor handling,
`shared03` passed 1/1 in 32.446 s using the same shared test and fixed Provider.
The actual granted URI is still a document capability; the product does not map
it to a shell path. Root separately verified that the fixture-owned MediaStore
file is readable from normal Termux. Whole T10's combined same-object write and
coordinator acceptance is recorded by its owner, not inferred from this trace.

## Interrupted native writer and reauthorization

`t10-native-death-20261104-01` changed the actual original to the 26-byte literal
`written before host death\n`. Root killed SAF writer PID 14614 after the marker;
Provider PID 14631 remained unchanged. Phase B retained the original operation
at `unknown`, `scopeConfirmed=false`, sequence 3. The GREEN read-only observation
matched content but did not change that state or open another write descriptor.
The root kill record and both phase failures are retained beside the GREEN log.

Revocation tests used a real previously persisted system-picker grant. After
RED07 revoked it, root selected the original again through DocumentsUI; the
same picker test passed 1/1 in 23.901 s. GREEN07 then revoked it again. The raw
platform FD observation is deliberately separate from the app's policy of
checking authorization before each subsequent use.

## Provider failure and observation prerequisites

`failures09` expected a missing-file classification from metadata alone. Android
instead folds `queryDocument`'s FileNotFoundException into a null cursor, so the
application truthfully reported unavailable. The corrected test still requires
the actual open to return not found, and a temporary Provider exception to return
unavailable. It also exercises a real pipe, missing write capability and an
actual changed original. This was a test expectation correction, not a product
change. The original failure is retained.

That first failure left the dedicated original at `retired.bin`; the following
observation10 attempt therefore failed before its Node busy marker. Explicit
`restore-moved` returned `restoredMoved=true` and the original nine bytes before
09b. This fixture operation moves the same inode back only when the original is
absent. It cannot overwrite an existing original or operate on the shared backend.
After 09b passed, the exact original observation10 test APK passed. The actual
[phone screenshot](t10-saf-observation10b.png) shows the expanded original panel,
actual URI, current read/write grant and four-byte original; this is a component
observation, not the final T15 console or T17 device acceptance.

## Native format and storage diagnosis

The fixed v1 registry fixture upgrades through the public store. The first
future-version preservation test failed its strict byte comparison (0.35 s).
A diagnostic run found exactly four changed bytes in the same 36,864-byte file:
offsets 18/19 changed from rollback mode to WAL, and offsets 27/95 advanced the
header counters. The test had changed the version marker using Android's plain
read/write open, which switched the fixture out of its production WAL mode.
These offsets match the [SQLite file format](https://www.sqlite.org/fileformat.html#the_database_header);
the remaining bytes were unchanged. This is not evidence of lost records.

With the fixture marker edit explicitly retaining WAL, v1→v2 public resource
retention, future version 99 refusal and unchanged database bytes all passed.
The same trace then reached its actual target failure in 0.383 s: an existing
file occupying the native namespace path escaped as raw IllegalStateException.
The product fix reports DOCUMENT_STORAGE_FAILED without replacing that evidence.
The same frozen test then passed 1/1 in 0.538 s on the corrected app. This checks
the stated native format and path failure boundaries; it is not an ENOSPC or
hard-power-loss experiment.

## Final component regression candidate

GREEN11's app, Storage11b's test and Failures09b's Provider were verified by
hashing the actually installed `base.apk` files. On those exact artifacts, the
storage trace above and seven further selected test invocations each passed:

| Check | Result | Seconds |
| --- | --- | --- |
| Immutable actual original write/readback/reopen | 1/1 | 0.649 |
| Retained original reader across replacement | 1/1 | 0.203 |
| Queued/active cancellation scope | 1/1 | 0.697 |
| Actual trusted Javet original channel | 1/1 | 0.662 |
| Actual small/over-budget text differences | 1/1 | 0.638 |
| Provider failures and stale original | 1/1 | 0.797 |
| Actual React/native observation while Node busy | 1/1 | 26.593 |

These were selected individual runs, not one all-tests instrumentation run.
Picker, revocation and actual writer death retain their separately frozen
RED/GREEN evidence above; they were not silently counted as rerun on GREEN11.
The final dedicated original is `NEW\n`, four bytes, with zero write opens in
the final failure-test fixture state, and its system grant remains held. There
was no application data clear or uninstall. The complete T10 SDK, shared writer
coordinator, Termux and real-model gate remain the whole-ticket owner's work.

## Source and frozen artifacts

| Candidate | Source | App SHA-256 | Test SHA-256 | Provider SHA-256 |
| --- | --- | --- | --- | --- |
| RED01 | dcf7d0b0aa9fa56a336b4b0e95bee35e6da7cfb5 | B6DA833443A235C80A1EBAFB86F0CFDA9C77F1D85692732EBD5E3C640C43AB50 | 4B19E4781342F06969486B9679ADB146DC39DC6FDE8B8CF3EA47630375613EAE | CA11C58F173F0407ED9099AAB47A901998C6FE19628478F3FCA23A0489AC699A |
| GREEN01 | e389841678f4c94810653ffa9178009fa78ea022 | C8191CFEF8AF309C087EE669050F0E536D70C2B924B567451A3949F470F51A42 | Same RED01 | Same RED01 |
| RED02 | ce3d100e6d11ec2ea2f776dcf04a29b39ab97e93 | 5D4AFFFB1692D67DD962FE8150F22CF06EB9AC47E0590BB53C66CE493E0EC22A | BF239FC42E53E71804DA900FD15419F1F792599B7A6153E7E12C59C5CBE315CE | 0D0A8199E9D68AA3A0905076C3224875A7C155388F9EED6C9E1D9427B114C24F |
| GREEN02 | 4be7cf5c5b664b705b42e8f888b2dcbe83f497af | F8F07E0F6E39220CD82A80E146F75C3DA5042DBB9E42165EA76A4FB194D39209 | Same RED02 | Same RED02 |
| RED03 | 84de0985700f62474c15348ff3f35ba84537e29e | FE2DB475596188B1919063D8995DC5835320E385F7056CA0286A79BC85F9139A | 4453A01FA578775566A7E36F7C10C2FC9797BADAF99701F5FC3FAC0019802514 | Same RED02 |
| GREEN03 | d674e9209d28e25455584ee0a382d810eef0f273 | 0F5F830AEE66977418414469D684273143B554DDD4BD05795A1962303D9CFF00 | Same RED03 | Same RED02 |
| RED04 | b25a48e7c19f905eb2a014850d5598c61edd9a44 | BFB07C294F287009B805509B8FCE6F3A9788F76B20039926675ABFD726B23044 | D0B8A8BB1EF8BE31FF3F349144B67E3150009E3668D352AEE9DB1929734A36A4 | 2D222A07BEDBFCAC38899CDFCEE7C39FFC0B6BC2E2881CE932EDAE1F7A888FCF |
| GREEN04 | 58c970487e6c751c3ace4eda56d86c8508cdd099 | FB7AB023A3EA061553225D96B64D63FCB330C085131C3590EF497B963B1C3931 | Same RED04 | Same RED04 |
| GREEN05 / shared03 app | dfcc7c3d3a58ab9fff5714e8bb3a2af84957ee42 | A93C77DE5C5FDA2CF7DC64CC549C11854A91A0EF181A75F4B08826035725FA6F | Javet: A9BB685412286A517ED2B94CBF79C6C84708A8FC4EEB2185555753EFD9CC942B | Javet: B4EE2BCB10491F808962C34C3A6FE00EF8CBACDBB5046FAB7EEDEA18B1C7F6DA |
| Shared03 test / provider | Same GREEN05 app | Same GREEN05 | 37CE09DE1BECA184298ECB454C99D83CB39775DB635CB9F613EDB2B8703465CC | 39C0478E5D76FCEF5680A1AF62251D56BBF03469FF41971DDF97BB3DF8104C38 |
| GREEN06 phase B | 4d36c53e3f82157616154965581c040393c9ba9f | DBA19B9204A817F651FAF50FBF75FDB200758923683FDE58ABC78850BA97E8DF | C99E1D3B76F89A3270D7E9D8AA5B10DC15148F2B11542DF4CC5F533A52B3CFC1 | EC32040FB95A29E6291EA3C3A1C3EEE35893664710CD6867BEC44C16ABEF0D26 |
| RED07 | fc7b052428a707f0cac152d4006936e062e538cf | Same GREEN06 | 9CA5EDB813B39CBFA44FAD4984817D6CCF6A98902628BFB2DDA07B682992EA87 | Same GREEN06 |
| GREEN07 | 2a3d9e3 | 8C747848039D5522E6CB9F6F0C93BA5CAA0AE82C834BFC6666C609F173E2EA35 | Same RED07 | Same GREEN06 |
| RED08 | 418bf1e | F7101C958C9C76BE438B26A0F522D81229CBC08CF4C3583A5B81F7BC1C4549A1 | AF8C22BB13D842FD897FD91FEA8AD4440133FE4AECEA7C4475336D502875B79B | Same GREEN06 |
| GREEN08 | f9751f1 | FACDBF59511A81B93714495B6F5FD1441E7BA620F8D6C0248172E00A1145CCA9 | Same RED08 | Same GREEN06 |
| Failures09 | dc31def | Same GREEN08 | 14E9473314A17D488E362381AAB48FE54A3037D8DB660EDEBE52F910AF07516E | 03D0050FA68567243AC464881F7575608D04C2D98A39AF4C16C43B8F3BEFF066 |
| Failures09b | 44365c6 | Same GREEN08 | 1B5A59EC8BF7247F9220EB9067218FAE43C08FC0FCEAF55677347C2691496687 | 10A0D34008BBD5B28D6F03F2426108D3D423D5FCAA5F52CB3F08F93E8DFDCDDA |
| Observation10 / 10b | ab3a3c1 | Same GREEN08 | 2A1DD005E5406A4B262589AAA861E4668336A7512CD0EE2658FFCCD1C6C39419 | 10: same Failures09; 10b: same Failures09b |
| Storage11 initial fixture | 0127524 | Same GREEN08 | 3F5D403AED5E46BDAF8FC03B698F0B0A50471B967E2043C1FF3A48DD79F16A17 | Same Failures09b |
| Storage11b target RED | 2e95ec6 | Same GREEN08 | 0CCF19E74E57C8AF4ECCF5CA855BC80E1A9BD2C084B0F9013BAE20E80053F693 | Same Failures09b |
| GREEN11 | c953079 | F740DD8D1399B2523E0C0AFCB8D4AA49F816D7C9880FF89BF4AC94B557127729 | Same Storage11b | Same Failures09b |

GREEN03 incorporates accepted integration 4914bb8 through merge 16ca0b0.
Its native input authority is the accepted v7 API. Document registry v1 to v2
adds operation and append-only receipt tables without deleting resource rows;
the write trace itself uses a fresh namespace and is not migration evidence.

Initial build configuration failure (unquoted validation application ID) and
the deliberately interrupted build after the AgentActivity merge conflict are
not behavioral failures or successful candidates. The corrected builds
completed. The AgentActivity merge retains both notification permission routing
and original document picker/lifecycle routing.

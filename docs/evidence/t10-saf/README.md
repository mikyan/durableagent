# T10 SAF component evidence — work in progress

2026-11-04. Component of T10, not whole-ticket acceptance. Root runs all device
commands. Dedicated `dev.durableagent.saf` application and separate-UID
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

RED preconditions passed separately: genuine picker grant, distinct UID,
independent literal binary bytes and real bundled page where relevant. Reader
and write traces reuse the grant actually obtained by the first trace. They do
not grant a synthetic URI permission to themselves. Store close/reopen is not
process-death validation. These results do not establish OEM, restart, hard
power-loss or unknown-effect recovery behavior.

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

GREEN03 incorporates accepted integration 4914bb8 through merge 16ca0b0.
Its native input authority is the accepted v7 API. Document registry v1 to v2
adds operation and append-only receipt tables without deleting resource rows;
the write trace itself uses a fresh namespace and is not migration evidence.

Initial build configuration failure (unquoted validation application ID) and
the deliberately interrupted build after the AgentActivity merge conflict are
not behavioral failures or successful candidates. The corrected builds
completed. The AgentActivity merge retains both notification permission routing
and original document picker/lifecycle routing.

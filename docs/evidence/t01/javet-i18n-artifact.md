# Javet Android Node i18n 6.0.3: independent artifact review

2026-11-04. Read-only repository inspection; no device operations. This supplements the standard-variant report `javet-artifact-review.md`; it does not erase the runtime owner's observed standard-variant Unicode-property-regex failure.

**Finding:** The exact i18n AAR has 16 KB-compatible ELF layout in both ABIs and embeds ICU 78 data in each native library. The fixed upstream Android build selects full ICU. Start the i18n runtime without an external ICU directory, then confirm the actual Unicode property regex, Intl, and SDK probes on device. Static inspection does not establish that those runtime checks pass.

## Artifact provenance and identity

- Coordinate: `com.caoccao.javet:javet-node-android-i18n:6.0.3`.
- [Official Maven Central AAR](https://repo.maven.apache.org/maven2/com/caoccao/javet/javet-node-android-i18n/6.0.3/javet-node-android-i18n-6.0.3.aar): **104,963,592 bytes**, SHA256 **`39a9c290cf6636e6473b60b4e6321106d3fad7ff5dcc13ffad474e29a3a067c9`**. Matches the [published SHA256 sidecar](https://repo.maven.apache.org/maven2/com/caoccao/javet/javet-node-android-i18n/6.0.3/javet-node-android-i18n-6.0.3.aar.sha256).
- The actual Gradle-resolved AAR at `C:\Users\AI_BA\.gradle\caches\modules-2\files-2.1\com.caoccao.javet\javet-node-android-i18n\6.0.3\4005db155e8b7fd4e3294dfc70b69db3f473d227\javet-node-android-i18n-6.0.3.aar` has the same SHA256.
- Integrity comparison is against the same repository; no detached-signature verification or reproducible-build attestation is claimed.
- Saved AAR, POM, checksum sidecar, extracted libraries, scripts, source snapshots, and raw results: `%TEMP%\durableagent-implementation\javet-i18n-6.0.3\`.

Only ARM64 and x86_64 native libraries are present. Empty directories for other ABIs do not provide native support. No separate `.dat` or assets directory is included. `NodeRuntime.class` has class-file major version 52.

| ABI | Native bytes | Native SHA256 | Build ID |
|---|---:|---|---|
| arm64-v8a | 163,785,752 | `266e732b71daed5897d430e99d20b46a1f87968f935c89795832d411f17f9414` | `597b15c7c6317e36ad352ecb7f8af22b355d1bcd` |
| x86_64 | 163,119,784 | `2a46d00797e2339353a4146d27df641b1f6679df771d95e1959812097e0e3e69` | `3b4c12a27f1d14671242a49bcf4661dc441beb9d` |

## ELF layout and dependencies

Each library has three LOAD segments, all with `p_align = 0x4000`, with file offsets congruent to virtual addresses modulo 16 KB. RELRO owns its entire LOAD segment. Rounding to a 16 KB boundary does not overlap the following writable LOAD; this includes x86_64 where the unrounded RELRO end is not itself 16 KB-aligned. These observations satisfy the inspected static ELF conditions in the [Android page-size guidance](https://developer.android.com/guide/practices/page-sizes).

| ABI | RELRO start–end | End rounded to 16 KB | Next writable LOAD |
|---|---|---|---|
| arm64-v8a | `0x614eaa0–0x62d0000` | `0x62d0000` | `0x62d4000` |
| x86_64 | `0x63715d0–0x64f3000` | `0x64f4000` | `0x64f8000` |

Both libraries declare only `liblog.so`, `libm.so`, `libdl.so`, and `libc.so` as DT_NEEDED; there is no additional shared ICU or C++ runtime dependency and no RPATH/RUNPATH. All **449 strong versioned imports per ABI** match the NDK API 24 stubs for those four system libraries. Weak imports number 14 on ARM64 and 19 on x86_64. Android notes record API 24, NDK r30 build 16248370; these are observed markers, not build attestations.

## ICU data: direct observation and source corroboration

Both ELF symbol tables contain a defined global object **`icudt78_dat`, size 33,107,960 bytes**, plus `icudt78_dat.c` and ICU 78 function symbols. ARM64 object address is `0x162ad38`; x86_64 is `0x1697150`. Therefore the AAR's lack of a separate data file is not evidence of missing ICU data. Raw matching symbols are saved per ABI as `icu-symbols.txt`.

The [fixed Javet 6.0.3 patch source](https://github.com/caoccao/Javet/blob/5d51b4eb0bfd4869436c906ce0748b325f445959/scripts/deno/patch_node_build.ts#L424-L435) selects `--with-intl=full-icu` for Android i18n. Its [fixed build workflow](https://github.com/caoccao/Javet/blob/5d51b4eb0bfd4869436c906ce0748b325f445959/.github/workflows/android_node_build.yml) builds Node v26.13.0 with that patch. [Node's initialization source](https://github.com/nodejs/node/blob/v26.13.0/src/node_i18n.cc#L514-L532) leaves linked full ICU data in place when the directory is empty. These sources corroborate the inference that this exact Android variant should not require external ICU data. Device initialization still supplies the final verdict.

The [generic Javet i18n tutorial](https://www.caoccao.com/Javet/tutorial/advanced/internationalization_i18n.html) describes setting a data directory before first runtime creation. Its generic guidance must not override the observed embedded data and fixed Android build configuration for this artifact. Do not introduce an unverified ICU file/version merely to follow that general example.

## Reproduce and remaining gate

From the artifact directory, run `python inspect-javet.py` to recompute AAR/native hashes and ELF LOAD/RELRO checks, and `python check-native-symbols.py` to compare strong imports against installed NDK API 24 stubs. Both scripts are outside the repository. To repeat the embedded-data check:

```powershell
$reader = 'C:\Users\AI_BA\AppData\Local\Android\Sdk\ndk\28.2.13676358\toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-readelf.exe'
& $reader --symbols '.\jni\arm64-v8a\libjavet-node-android-i18n.v.6.0.3.so' | Select-String 'icudt78_dat|InitializeICUDirectory|udata_setCommonData_78'
& $reader --symbols '.\jni\x86_64\libjavet-node-android-i18n.v.6.0.3.so' | Select-String 'icudt78_dat|InitializeICUDirectory|udata_setCommonData_78'
```

## Final APK inspection update

The completed APK SHA256 is `4d60020c8f15dbc2d4f45bc97295605225ffa1a51791b5e8c91b07376ab587a4` (432,019,602 bytes, debug artifact containing both validation ABIs). SDK 36 `zipalign -c -P 16 4` exited 0. Both uncompressed native libraries start at 16 KB ZIP boundaries and match the AAR SHA256 values above exactly; ARM64 data offset is 3,276,800 and x86_64 is 268,894,208. Thus the inspected ELF conditions apply directly to the APK's native files.

All five compiled probe modules and the complete npm lockfile inside `assets/runtime.zip` match the worktree; Pi Durable/AI/schema/Chord are 1.5.0. The packaged package.json differs only by absence of the later-added host-only `scripts.pretest` command; dependencies and runtime fields match. This metadata difference does not change executed Android code and is recorded rather than hidden. Raw machine-readable inspection is [final-apk-inspection.json](final-apk-inspection.json).

Actual startup/ICU/SDK/lifecycle results are separate evidence in the [gate report](README.md). The earlier standard-variant APK result was not reused for this i18n check.

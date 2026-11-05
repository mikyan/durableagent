# Javet Android Node 6.0.3 binary inspection

Date: 2026-11-04. No device operations or repository changes. The exact pinned Maven Central artifact was inspected independently first. After the runtime owner's build completed, the actual Gradle-resolved AAR and final debug APK were compared; results are recorded below.

## Artifact and provenance

- Coordinate: `com.caoccao.javet:javet-node-android:6.0.3`; project declares this exact version and `mavenCentral()`.
- Retrieved over HTTPS from the [Maven Central AAR](https://repo.maven.apache.org/maven2/com/caoccao/javet/javet-node-android/6.0.3/javet-node-android-6.0.3.aar). HTTP Content-Length: **74,172,483 bytes**; Last-Modified: `Mon, 02 Nov 2026 19:41:13 GMT`.
- AAR SHA256: `68e5de97dd8d149d12fa49792915b5646e9fef9f1b34a53c8d11574a56ab6db9`, matches the [published SHA256](https://repo.maven.apache.org/maven2/com/caoccao/javet/javet-node-android/6.0.3/javet-node-android-6.0.3.aar.sha256).
- AAR SHA1: `4116d4043583cfc5d1e283cd142867dc2947cb32`, matches Maven's SHA1 sidecar. These are integrity comparisons to the same repository, not a detached-signature verification or reproducible-build attestation.
- [POM](https://repo.maven.apache.org/maven2/com/caoccao/javet/javet-node-android/6.0.3/javet-node-android-6.0.3.pom) SHA256: `0d7239a97f70f91472da0df3a0f5b0affcd2c45d4ab3762d646cd103de9c9a29`; packaging `aar`, source tag `6.0.3`, no runtime Maven dependencies (only test-scoped JUnit 4.13.2).
- [Release 6.0.3](https://github.com/caoccao/Javet/releases/tag/6.0.3), published `2026-11-02T20:18:30Z`, points to commit `5d51b4eb0bfd4869436c906ce0748b325f445959`, the same revision used by the project research. Release-declared Node is `v26.13.0`, V8 `15.7.112.19`. Actual runtime versions still require execution.
- Saved AAR and all raw evidence: `%TEMP%\durableagent-implementation\javet-6.0.3\`.

## Actual AAR contents

Exactly two native libraries are present, both named `libjavet-node-android.v.6.0.3.so`:

| ABI | ELF machine | Bytes | SHA256 |
|---|---|---:|---|
| arm64-v8a | AArch64 | 123,089,768 | `35431f8f8851d7ca7713b2b916e401794bc3dac54381e5d9de20cf89afabcc54` |
| x86_64 | AMD x86-64 | 122,609,648 | `a3fb46d784fc7faee1404e373f47406e8a7e3c4b869515fb054caa9c9abb3ad2` |

Both are ELF64 little-endian `ET_DYN`. `classes.jar` is 563,626 bytes, SHA256 `d88807fae6ae2a60b2603cbf013a9b99e7317cf586d79ee92e60d2a238879b82`; `NodeRuntime.class` uses class-file major 52. AAR manifest versionName is `6.0.3`, minSdk 24. The native Android note also records API 24 and NDK `r30` build `16248370`; this embedded marker is observed metadata, not a full build attestation. Library build IDs: ARM64 `4aecd781f1e5e68030b6adc642b0eb69fbcc4f8c`; x86_64 `b4d7c72e6aab30f40e5a82d944cf7780343a9712`.

## ELF alignment and native dependencies

**Both ABIs pass the inspected static 16 KB ELF conditions.** Each has three `PT_LOAD` segments, all `p_align = 0x4000` (16,384), with file offsets congruent to virtual addresses modulo 16 KB. This matches Android's [ELF alignment check](https://developer.android.com/guide/practices/page-sizes#elf-alignment).

The GNU_RELRO end is not itself 16 KB aligned, but RELRO occupies its own entire LOAD segment, and rounding does not touch the next writable LOAD. This is the dedicated-segment case described by Android's [RELRO guidance](https://developer.android.com/guide/practices/page-sizes).

| ABI | RELRO start–end | End rounded to 16 KB | Next writable LOAD |
|---|---|---|---|
| arm64-v8a | `0x3c0d4d0–0x3d61000` | `0x3d64000` | `0x3d68000` |
| x86_64 | `0x3e42190–0x3f95000` | `0x3f98000` | `0x3f9c000` |

For both libraries, `DT_NEEDED` is exactly **liblog.so, libm.so, libdl.so, libc.so**. There is no separate `libnode.so`, `libc++_shared.so`, RPATH or RUNPATH requirement in the inspected dynamic sections. Comparing versioned strong undefined symbols to those four Android NDK 28.2 API 24 stubs found **438 strong imports and zero unmatched imports per ABI**. Optional weak imports: 14 ARM64 / 19 x86_64. This checks declared ELF imports; runtime `dlopen`/feature paths and actual Android linker execution remain untested.

## Reproduce and finish the packaging check

Raw outputs: `arm64-v8a-readelf.txt`, `x86_64-readelf.txt`, `artifact-summary.json`, `elf-checks.json`, `native-symbol-checks.json`. Analysis scripts: `inspect-javet.py` (stdlib ELF parsing) and `check-native-symbols.py` (NDK symbol comparison), beside the AAR. Tools: Python 3.14; `llvm-readelf` 19.0.1 from installed NDK `28.2.13676358`.

```powershell
$artifactDir = Join-Path $env:TEMP 'durableagent-implementation\javet-6.0.3'
python (Join-Path $artifactDir 'inspect-javet.py')
python (Join-Path $artifactDir 'check-native-symbols.py')
$reader = "$env:LOCALAPPDATA\Android\Sdk\ndk\28.2.13676358\toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-readelf.exe"
& $reader --file-header --program-headers --dynamic --notes (Join-Path $artifactDir 'jni\arm64-v8a\libjavet-node-android.v.6.0.3.so')
& $reader --file-header --program-headers --dynamic --notes (Join-Path $artifactDir 'jni\x86_64\libjavet-node-android.v.6.0.3.so')
```

## Actual Gradle cache and debug APK follow-up

- Actual resolved AAR: `C:\Users\AI_BA\.gradle\caches\modules-2\files-2.1\com.caoccao.javet\javet-node-android\6.0.3\4116d4043583cfc5d1e283cd142867dc2947cb32\javet-node-android-6.0.3.aar`. SHA256 **matches the independently downloaded Maven artifact exactly**.
- Inspected APK: `C:\Users\AI_BA\.codex\worktrees\t01-runtime\durableagent\android\app\build\outputs\apk\debug\app-debug.apk`, 268,894,336 bytes, SHA256 `0b9a9cbebd3969afbaf19053894b5c102ee5fd0f0ecda96e9df0bb99a7ea88d3`.
- APK contains exactly the two native libraries above, uncompressed (`ZIP_STORED`). Their SHA256 and sizes match the AAR libraries; all inspected LOAD segments still align to 16 KB with congruent offsets.
- SDK 36 `zipalign.exe -c -P 16 4 <apk>` exited **0**. Raw APK inspection: `javet-6.0.3/apk-inspection.json`; extracted library readelf outputs: `javet-6.0.3/apk-native/lib/<abi>/readelf.txt`.

These results apply only to that APK hash; subsequent builds need their own packaging check. Runtime execution in a verified 16 KB environment remains outstanding. The known S23 has 4 KB pages. Static native packaging passes; T01 runtime acceptance is not established by this report.

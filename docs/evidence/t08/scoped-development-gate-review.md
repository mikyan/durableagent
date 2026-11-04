# T08 final review addendum and local merge

2026-11-04. Supersedes the two pending conditions in `t08-final-gate-review.md` for owner commit `9bdb2015b3e642ec4a73d0c4e96e37f58b797201`.

Decision: CLEAR within the documented T08 scope. Both operation receipt lookups now use Object.hasOwn. A real SDK/SQLite regression covers constructor/toString/__proto__, exact replay, differing-payload rejection and reopen. The unchanged independent public probe is GREEN in archived identity-review-green.log. Android fixture now waits for the exact second text to be saved, uses the existing explicit keep-local control if conflict appears, and sends once; all original request/witness/history assertions remain. Final device evidence records recoveredDraftConflict=false, so it does not claim the recovery button was exercised.

Final exact APKs independently hash-matched:
- app `3c6989139cfc0725111167fe27a491c13be56eedee6e3aea3cccc52a5307c8ac`
- test `cb395a68a6c48a04d77f5660e094054e00fb13909963c6e63b4198c059524ddf`

All 94 source-manifest hashes match owner checkout. Compared actual fourth and fifth runtime ZIPs: only dist/projects.js (the two own-property guards) and validation/project-policy.mjs changed. The source-only project-validation.ts difference is EOF whitespace; compiled bytes are unchanged. Final manifest reports 36 runtime entries, 9 UI assets, 16 shared project callbacks, pinned native bytes and 16KiB ZIP/ELF alignment. The corrupt old helper was not executed.

Read final archived raw results: Android final 3/3, zero skipped, 40.525s; all 16 shared policies, actual MiMo four requests/two witnesses, actual React fresh-host reopen zero additional requests. Targeted host 17/17, zero skipped, 4883.8324ms. Prior native-only 17/17 retains its own artifact attribution. Root's bounded final credential audit records zero matches in 58,967,040 app-data and 4,763,930 UID-log bytes. Reviewer did not access credentials or devices or repeat unrelated successful tests. No binaries added in the 66-file commit; root's public scan remains the secret/serial audit authority.

Local authorized merge completed in D:/Code/durableagent, integration/android-agent-v1, with --no-ff and no conflicts:
- prior clean integration HEAD `2eb80c8d385ebed876fb886bdb3cc52381fa794c`
- exact owner second parent `9bdb2015b3e642ec4a73d0c4e96e37f58b797201`
- merge `66ee0bed585f4c77053b7646abcfac88a25603a5`
- merged tree equals owner tree: `3d7ff5b60842e29e0cfd0e2c8f99e40bcbe0b684`
- git diff --check PASS; root working tree CLEAN.

No push, GitHub change, ADB, credential helper or device action. New T08 application evidence is Android16 x86_64/16KiB emulator only; no S23/Xiaomi or T09/T10 real execution/alias acceptance is inferred. Existing T03 scoped acceptance and pending OEM/T17 rows are preserved.

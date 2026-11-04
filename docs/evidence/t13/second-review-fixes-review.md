# Independent targeted review — final two Provider policy fixes

Scope: two runtime source changes in the T13 worktree relative to frozen `t13-provider-review-green01` (B945), checked against `t13-provider-review-final02` (main APK SHA256 `d92fad39bf074264db081089906aac44a7ee566e39367b5b0caa1673930297cc`). GitHub issue #14 was fetched on 2026-11-04. This is a targeted review, not a whole-ticket or final integration gate. No repository source, device, credential or remote state was changed.

## Result

No new confirmed defect found in these two changes. The original two independent reproductions now pass, unchanged. The new after-dispatch regression also passes independently. Two additional public Application / real SDK / dual SQLite tests verify a multi-page fixed snapshot and a user stop while its second page remains busy.

| Check | Result | Evidence |
|---|---|---|
| Original pre-admission DATA_SAVER_BUSY reproduction | 1/1 PASS, test 764.3373 ms, process 991.4898 ms | `pre-admission-policy-busy-independent-green02.log` |
| Original fixed snapshot DATA_SAVER_BUSY reproduction | 1/1 PASS, test 881.9665 ms, process 1099.1746 ms | `fixed-read-snapshot-policy-busy-independent-green02.log` |
| Owner after-dispatch BUSY regression | 1/1 PASS, test 741.8198 ms, process 958.7112 ms | `after-dispatch-independent-green02.log` |
| Independent repeated BUSY on a nonzero snapshot offset; full digest preserved | 1/1 PASS, 626.779 ms | `fixed-snapshot-page-stop-independent-green02.log` |
| Independent durable user stop while snapshot page stays BUSY | 1/1 PASS, 638.1393 ms | same log; two-case process 1461.1039 ms |

Commands used `node --test --test-name-pattern` for the exact first three cases, with counts checked as one test each. The two extra checks are in `fixed-snapshot-page-stop.test.mjs`; that file is external to the repository. Node was v24.14.1. They use controlled native adapters, not an Android Provider or real LLM, and do not replace the root's device work.

## Source reasoning

- `DocumentWrites.network` refreshes the original native receipt, checks request identity and nondecreasing sequence, and allows re-entry into `start` only for `accepted_not_started` plus the matching `writePolicy` identity with phase `allowed`/`granted` and explicit `dispatched === false`. Unknown/dispatched policy remains in the existing tool. A fresh query showing running/completed exits the start loop and follows the retained original result. The native `start` path also rechecks its ledger and calls `NativeProviderPolicy.execute`, whose durable dispatched flag and observation lease prevent another Provider action after a lost response.
- The error code alone no longer determines whether the write is safe to retry. Original same-ID checks, control generation and shared-writer reservation remain on the re-entry path. The after-dispatch test verifies one start and one model request while uncertainty remains, followed by exactly one model continuation after completion.
- `DocumentReads.readSnapshot` retries only selected transport/storage busy conditions. Offset increments only after a valid matching page is decoded and checked; it does not return to `observeRead`. Each loop rechecks abort signal, owner lifecycle, native control generation/pending abort, and SDK task abort. Page/base64/eof/size and final SHA256 checks are unchanged. The independent 84,000-byte case observed offsets `[0,32768,32768,32768,32768,65536]`, one original observation and a matching whole-content digest. The durable-stop case observed no further page or model request after stop settled.

## Identity checks

Working source and generated dist hashes equal final02 snapshot:

- `runtime/src/document-writes.ts`: `374384500D5753B1EDF3F9D2B47AA4F7503A4329EFB4F7323268F8ABD8A05295`
- `runtime/src/document-reads.ts`: `67E07CB329BF9845B2D45F5FD59961A9C7D34DC4D482B736692C45974317D0A4`
- `runtime/dist/document-writes.js`: `05AD1977D44CB83559F81996C3230E3BE2A6A08B7B059EE30208B35C9FBA072B`
- `runtime/dist/document-reads.js`: `8759F152E8A097F7E46E4C00E930C8A9CB016A8C2BDE754DBB7AB620BCBA8BC2`

Unmodified original reproduction hashes:

- `pre-admission-policy-busy.test.mjs`: `654A42C4C0B655C7BB2D1D6AF682E31B8CBDF29B3727839EB2AE5F97ECADE6C6`
- `fixed-read-snapshot-policy-busy.test.mjs`: `55311FE11B949086AC85F21892E6365E609659B5B5BF67A3B70EC9573B9CBA2C`

The pending real React send/grant validation and final ticket acceptance remain outside this conclusion. Earlier device failures are not rewritten as passes.

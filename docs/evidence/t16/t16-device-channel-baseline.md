# T16 device channel baseline — root, 2026-11-04

Read-only preparation; no backup/restore was performed and no settings changed.

Both existing Android 16/API36 emulators expose LocalTransport, GMS BackupTransportService and GMS D2dTransport. GMS cloud transport is selected; Backup Manager is disabled on both. Actual `bmgr help` prints Unknown command followed by command help; this was a read-only usage query, not a failed product test.

- emulator-5580: google/sdk_gphone16k_x86_64/emu64xa16k:16/BE2A.250530.026.F3/13894323:userdebug/dev-keys; 16 KB.
- emulator-5582: google/sdk_gphone64_x86_64/emu64xa:16/BE2A.250530.026.F3/13894323:userdebug/dev-keys; 4 KB; production Termux daemon and retained execution receipts remain here.

Root proposes a NEW empty AVD for channel experiments, with only the dedicated T16 synthetic installation and a permissive positive-control fixture. Existing main apps have actual validation history/credential ciphertext and should not be exposed to global backup enable/scheduling. Host has 32 GB total and about 3.8 GB available at inspection; suspend 5580 gracefully when needed rather than run a third memory-heavy emulator alongside all builds. No AVD has yet been created. Existing system image is already installed at SDK/system-images/android-36/google_apis/x86_64; no download required.

Verification scope: match the dedicated candidate to production source, storage layout and backup manifest/rules; seed identifiable synthetic records in every relevant domain, plus positive control proving the transport actually captured/restored allowed data. Observe raw channel outcomes, not only status Success: allowBackup=false/cloud rejection can be correct exclusion but does not alone exercise XML. Inspect archive/restore marker absence and retention of current installation separately. No main app/Termux clearing or real API key. No cloud account sign-in/upload implied. Single-device D2D test mode is not OEM two-device migration.

Primary documentation inspected 2026-11-04:

- https://developer.android.com/identity/data/testingbackup : official local transport test and GMS D2D single-device test mode. Local transport saves test data locally, so report as cloud-rule/local-transport exercise rather than actual remote Google cloud backup. D2D test-mode channel requires settings backup_enable_d2d_test_mode=1 and selecting com.google.android.gms/.backup.migrate.service.D2dTransport. The official example initializes the whole transport; that is acceptable only on our new synthetic emulator, not existing installations. Restore/reinstall must name only the dedicated test package.
- Existing repo docs/research/android-private-data-and-backup.md inventories cloud, D2D and Android36.1 cross-platform rules. Our current base API36 images do not by themselves prove 36.1/OEM channels. Keep untested scope explicit.

The web tool could not fetch the pinned android-16.0.0_r1 LocalTransport Java files; do not claim their exact code was inspected. No production changes made by this preparation.

Update: root successfully created fresh AVD `durableagent-t16-backup`, path `%TEMP%/durableagent-implementation/avd-t16-backup`, using the already installed standard Android36 Google APIs x86_64 image. It has not been started. New config is2GB RAM/4cores/default10GB userdata; launch can constrain2cores. Intended adb port5584. No existing AVD was copied/cleared/replaced. Owner plans independent production-equivalent `dev.durableagent.retention` plus separate `rules` (production XML with allowBackup=true to exercise rules) and permissive `control` fixtures.

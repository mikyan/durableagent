# Independent input source fixture

This standalone Android application supplies **synthetic documents only** for T06. Its application ID is `dev.durableagent.inputsource`; the Agent validation application is `dev.durableagent.probe`. They run under different Android UIDs, even when signed with the same debug key. The native test checks that distinction before asserting URI access behavior. This fixture is not included in the Agent APK and has no model transport or credentials.

The exported `DocumentsProvider` authority is `dev.durableagent.inputsource.documents`. It requires the platform `MANAGE_DOCUMENTS` permission and allows individual URI grants. The Agent does not receive that platform permission: access comes from the system picker or a deliberately issued fixture URI grant. Both applications declare only the precise test visibility they need: the fixture queries the fixed Agent package; the Agent's **debug** manifest queries this provider authority. Package visibility does not grant permission to read a document.

## Build and install

Use JDK 17, Android SDK platform 36 and build-tools 36.0.0, with `JAVA_HOME` and `ANDROID_HOME` configured. The fixture uses AGP 8.13.2 and the main Android project's Gradle wrapper; it has no separate wrapper or dependency on the Agent app module.

From the repository's `android` directory:

```powershell
./gradlew.bat -p fixtures/input-source build
```

The debug APK is `fixtures/input-source/app/build/outputs/apk/debug/app-debug.apk`. On an authorized validation device, install both the Agent test APK pair and this fixture. Launch the fixture once so its provider can appear in the system document picker:

```powershell
$device = '<authorized-device>'
adb -s $device install -r fixtures/input-source/app/build/outputs/apk/debug/app-debug.apk
adb -s $device shell am start -n dev.durableagent.inputsource/.SourceActivity
```

## Fixed documents and controls

The picker root is **DurableAgent 外部测试资料**. It contains two generated files in the fixture's private `no_backup` directory:

| Document ID | URI | Initial content |
| --- | --- | --- |
| `text` | `content://dev.durableagent.inputsource.documents/document/text` | `fixture-note.txt`, UTF-8 `原始外部来源 UTF-8：中文🌍` followed by LF; 38 bytes |
| `image` | `content://dev.durableagent.inputsource.documents/document/image` | `fixture-image.png`, 720 × 360 pixels; initial four-character code `R7K2` |

The initial text SHA-256 is `ee9a2cd7b411f465b1251a067595cd7fceab25c5b4a78ea5f8394b9935638ff3`. The image is generated locally; tests compare the actual prepared object digest rather than assuming an encoder-independent PNG hash.

The explicit exported `dev.durableagent.inputsource/.ControlReceiver` accepts `operation` and `document` string extras. `document` is only `text` or `image`; the grant recipient is always `dev.durableagent.probe`. It accepts no arbitrary path, URI, recipient or network destination.

| Operation | Effect |
| --- | --- |
| `inspect` | Return safe metadata: IDs, URI, bytes, SHA-256 and grant diagnostics. |
| `reset` | Restore both generated originals. |
| `mutate` | Replace the chosen text with a second synthetic UTF-8 version, or the image code with `V8D3`. |
| `seed-image` | Generate an image from the `challenge` extra, restricted to four characters matching `[A-HJ-NP-Z2-9]{4}`. |
| `grant` | Call Android `grantUriPermission` for READ and PERSISTABLE on the chosen document. |
| `revoke` | Call Android `revokeUriPermission` for the fixed recipient and document. |

Example, from a separate device-runner terminal:

```powershell
adb -s $device shell am broadcast -n dev.durableagent.inputsource/.ControlReceiver --es operation inspect --es document text
```

An ordered broadcast returns result code `0` on success and `1` on failure. `ExternalInputFixture.control` in the Agent instrumentation tests performs the same explicit broadcast with a bounded wait. Returned `providerUid`, `targetUid`, `targetLookup` and `targetReadPermission` help distinguish missing package visibility from a real OS grant. A successful control response alone is not proof of readable content: tests separately require the permission check and an exact byte read.

## What the tests establish

`NativeInputStoreTest.realCrossUidGrantRevocationRetainsOnlyPreviouslyFixedContent` checks initial OS denial, an actual grant and complete source read, local preparation/freeze, actual revocation, renewed OS denial, and unchanged fixed bytes after reopening and cleanup. It also checks that no persisted read permission remains after revocation. The fixture's precise target-package query was necessary: without visibility, the initial fixture could report success while Android resolved no target UID. The corrected fixture retains the original provider protection.

This direct-grant test proves cross-UID access and revocation behavior. **It does not prove system-picker consent or navigation.** The separate opt-in `InputApplicationTest.actualSystemPickerImportsSyntheticText`, with `systemPicker=true` and `pickerSource=external`, opens the real picker. The device runner selects this root's `fixture-note.txt`; the test then checks the complete frozen bytes and zero model requests. See the [Android reproduction guide](../../README.md).

All controls change only the fixture's two generated files and their grants. They do not modify user documents or Termux data. Repeated builds may produce different APK hashes; use the hash recorded for the exact installed candidate when reporting device evidence.

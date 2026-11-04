# T15 Console implementation evidence — in progress

This directory records the independent codex/t15-console worktree. T10's accepted integration base is b06bfc7; 7339a5b is a development checkpoint, not the final acceptance commit. GitHub #16 remains the execution authority.

## Boundaries

The production UI is React over the existing public Application Interface, native drafts/intents, managed execution and document receipts. Search covers only the currently loaded conversation, names the unloaded history explicitly, and jumps by stable message ID. The file panel consumes T10 receipts and never scans arbitrary command effects or invents a diff. The timeline uses the existing packaged extension loader; closing the auxiliary area releases its UI observation only.

context.get reads the SDK's public Conversation.context() and resolved model. The displayed count is a rough estimate of committed model-message UTF-8 bytes divided by three, explicitly excluding dynamic instructions, tool definitions, protocol overhead, in-flight generation and unsent drafts. It is not cumulative usage or exact provider tokenization. Images make the count unavailable; the resolved model's configured context limit remains separate.

input.capabilities reports an available system image-capture Activity. Camera capture uses a narrowly scoped, temporary URI grant to a UUID-named private JPEG; the same native source admission and preparation path handles its result. Cancelled selection does not change or mark the confirmed draft as a failed save. No background camera or extra per-file approval flow was added.

Notification targets are limited to existing conversation IDs and the exact current-domain durable-conversation:<namespace>:<id> URI. Startup and onNewIntent only select/open; they do not create conversations or send input. Ordinary selected-page preferences remain optional WebView preferences; native drafts remain authoritative.

## Test seam and current observations

The accepted T15 seam is public user interaction plus the public Interface. Host tests cover navigation, history paging/search/position, per-conversation drafts, context labels, extension subscription disposal, camera cancellation, authentication guidance and notification selection. Android checks use the actual bundled WebView and native boundaries. Screenshot acceptance is separate from DOM assertions.

- UI suite before the visual follow-up fixes: 24 files, 90 tests passed.
- Runtime suite: 222 tests passed from the runtime working directory. An initial invocation from the repository root produced five missing child-fixture paths; that original run is retained and is not a product regression or a passing run.
- Initial installed-candidate UI SIGKILL replay on emulator-5584 restored both complete drafts and the last selected conversation (UI PID 18179 to 18355, Agent PID 18300 unchanged). This is a baseline reproduction, despite its temporary filename containing red. It does not establish the cause of the historical T06 failure.
- Android ConsoleApplicationTest candidate 8: 2/2 passed. It covers actual initial/updated Intent delivery, rejection of wrong namespace and unknown ID, independent retained drafts, and a controlled cancelled system-camera result. It does not claim a captured-camera success.
- First two notification test attempts passed their behavior assertions but failed ActivityScenario cleanup. AndroidX tracks the launch Intent identity; the real setIntent in onNewIntent changed that identity. The final test uses a platform Activity handle for this scenario and retains all original assertions.

## Visual defects found, with original evidence retained

The first phone floating strip overlapped the title bar because its absolute position omitted Android's safe-area inset. The strip now includes that inset. The detail close control remains sticky while the bounded detail panel scrolls. The auxiliary area also respects system-bar insets and uses the shared dark button treatment.

The first actual soft-keyboard run exposed a product failure: both layout and visual viewport reported about 915 CSS px while the IME covered the composer. An attempted physical tap on the obscured Stop coordinate inserted a keyboard character instead; the saved next draft and the still-running state make that failure observable. The run was subsequently stopped through the visible control after dismissing the keyboard. The Activity now measures the WebView inside a FrameLayout that applies the actual WindowInsets.Type.ime() bottom inset, with adjustResize. This follows the Android [software keyboard insets contract](https://developer.android.com/develop/ui/views/layout/sw-keyboard); device verification, not the API documentation, establishes whether the fix works.

tools/console-device.mjs drives the installed WebView through physical ADB taps, keyboard text insertion, public Interface calls and real device screenshots. A plan explicitly names its validation mode/run. console is a debug-only synthetic model HTTP response through the real SDK and storage, used to make long-body layout observable. These screenshots are not live-LLM or OEM background-recovery evidence. Parent-coordinated real MiMo/Termux checks remain separate.

Final wide-window, keyboard, large-font, camera, real-file and integration results will be added before T15 is handed to the independent merger. No existing SAF fixture original or unknown receipt has been reset.

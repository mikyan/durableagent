# Scoped review: native owner of WebView safe bounds

Reviewed 2026-11-04 by the independent inset reviewer. No ADB, product changes,
credentials, model calls or remote mutations. This reviews the current T15
build04 source delta and the two retained menu regressions, not the entire T15
ticket or final APK/source correspondence.

## Disposition

No concrete blocker found in the inspected production delta or the two menu
regression results. Focused IME/rotation verification remains pending and must
retain any failure separately; this report does not mark that scope passed.

## Production source

The only production delta inspected is in `AgentActivity.openPage`'s existing
FrameLayout inset listener. It reads actual `systemBars | displayCutout` insets,
applies their left/top/right values, and chooses the maximum of safe bottom and
the visible IME bottom. It therefore avoids adding navigation-bar and IME
occlusion twice. The derived child WindowInsets zeros the handled types and
clears the DisplayCutout object. Clearing the object is necessary for the
reviewed M133 implementation, which reads it directly.

The masking listener is installed before `setContentView`, the initial inset
request and page load. No `onPageFinished`, visual callback or later unmasked
root-inset redispatch remains. Thus the new WebView starts under the same native
layout owner rather than receiving nonzero CSS safe areas followed by a null
update. The listener changes only layout geometry; no application action,
credential, navigation or runtime ownership path changed.

This corresponds to the [Android native padding / zeroing approach](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets?hl=en).
The earlier diagnosis report records the M133 source limitations and the exact
unproven renderer-cache hypothesis. No claim that those internal details have
since been measured is made here.

## Actual menu evidence

Read both `t15-window-insets-native01.json` (COLD) and
`t15-window-insets-native02.json` (WARM). Each has a fresh Activity followed by
two replacement WebViews in the same Activity and UI PID. All six stages report
distinct intended targets, visible menu bounds and successful actual Android
taps opening the drawer. The observed WebView origin is (0,132), with size
1080x2205. CSS top padding is zero, and the menu top is 181.875 screen px, beyond
the actual status-bar bottom at 132. The WebView bottom is 2337 on the 2400-pixel
screen, consistent with the retained navigation-bar area.

Visually inspected `t15-window-insets-native01-reusedAgain.png` and
`t15-window-insets-native02-reusedAgain-opened.png`. The first shows the menu
below the status bar with no duplicated top safe area; the second shows the
opened navigation drawer inside the native safe bounds. These images support
the numeric measurements and actual tap result.

## Driver credibility and limits

The driver now reads the selected WebView's native screenX/screenY from its
DevTools description and adds those to CSS coordinates multiplied by the
observed devicePixelRatio. This is the correct transformation for these retained
no-zoom, zero-scroll fixtures; the records explicitly show viewportY and scrollY
zero. It is not claimed to be a universal pinch-zoom coordinate helper. The
origin is measured, not a hardcoded 132-pixel adjustment. The original physical
bar-occlusion assertion remains in place, and the actual successful taps provide
an additional end-to-end check of that transformation.

The test remains input-only and checks there is no ApplicationService. It sends
no model or tool input. Prior RED, intermittent redispatch passes and failures
remain separate evidence; six successful stages do not establish all WebView
versions, IME states, screen configurations or OEM behavior.

Owner reports build04 app SHA-256
`d2b8f9a986d32e0e9a85049181a904b8c1e43756110eaa66e7906ccdbf622072`.
This reviewer has inspected current source and actual output, but has not yet
verified a frozen source-to-APK manifest; root's artifact check remains required.

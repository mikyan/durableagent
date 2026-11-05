#!/usr/bin/env bash
# Test the documented first-init Interface in an isolated home; only Android reload is substituted.
set -euo pipefail
cd "$(dirname "$0")/.."
fixture=$(mktemp -d /tmp/durableagent-setup-test.XXXXXXXX)
case "$fixture" in /tmp/durableagent-setup-test.*) ;; *) exit 2;; esac
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/home/.termux" "$fixture/bin"
printf '#!/bin/sh\nexit 0\n' > "$fixture/bin/termux-reload-settings"
chmod +x "$fixture/bin/termux-reload-settings"
printf 'unrelated=value\nallow-external-apps=true\nallow-external-apps=false\n' > "$fixture/home/.termux/termux.properties"
env HOME="$fixture/home" PATH="$fixture/bin:$PATH" bash app/src/main/assets/setup.sh >/dev/null
effective=$(awk -F= '/^allow-external-apps=/ { value=$2 } END { print value }' "$fixture/home/.termux/termux.properties")
[ "$effective" = true ] || { echo 'FAIL duplicate property remains disabled'; exit 1; }
cp "$fixture/home/.termux/termux.properties" "$fixture/first"
env HOME="$fixture/home" PATH="$fixture/bin:$PATH" bash app/src/main/assets/setup.sh >/dev/null
cmp "$fixture/first" "$fixture/home/.termux/termux.properties"
grep -q '^unrelated=value$' "$fixture/home/.termux/termux.properties"
test -f "$fixture/home/.local/share/durableagent-probe/termux.properties.before-setup"
test -x "$fixture/home/.local/share/durableagent-probe/probe-v1.sh"
echo 'PASS duplicate properties, idempotent setup, preserved settings, executable probe'

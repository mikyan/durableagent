# Paste this entire block into the OFFICIAL Termux app after its first bootstrap.
# It only enables external calls and creates this fixture's private probe directory.
set -eu
mkdir -p "$HOME/.termux" "$HOME/.local/share/durableagent-probe"
props="$HOME/.termux/termux.properties"
touch "$props"
effective=$(awk -F= '/^[[:space:]]*allow-external-apps[[:space:]]*=/ { value=$2; gsub(/^[[:space:]]+|[[:space:]]+$/, "", value) } END { print value }' "$props")
if [ "$effective" != true ]; then
  cp -p "$props" "$HOME/.local/share/durableagent-probe/termux.properties.before-setup"
  # Last property wins; preserve existing settings and comments.
  printf '\nallow-external-apps=true\n' >> "$props"
fi
cat > "$HOME/.local/share/durableagent-probe/probe-v1.sh" <<'DURABLEAGENT_PROBE'
#!/data/data/com.termux/files/usr/bin/bash
set -eu
nonce=${1:?missing challenge}
case "$nonce" in *[!a-zA-Z0-9-]*|'') exit 64;; esac
root="$HOME/.local/share/durableagent-probe"
umask 077
# A kernel lock prevents overlapping probes after callback loss or host death.
# Closing this short-lived process releases the lock even on process death.
exec 9>"$root/probe.lock"
flock -n 9 || { printf 'busy=1\n'; exit 75; }
printf 'protocol=1\nnonce=%s\nuid=%s\ninstance=%s\n' "$nonce" "$(id -u)" "$$"
printf 'prefix=%s\nshell=%s\n' "$PREFIX" "$BASH_VERSION"
for tool in bash sh cat mkdir rm id flock timeout pkg apt dpkg; do
  command -v "$tool" >/dev/null || { printf 'missing=%s\n' "$tool"; exit 69; }
done
printf 'tools=ok\n'
mkdir -p "$root/workspace"
work=$(mktemp "$root/workspace/probe.XXXXXXXX")
trap 'rm -f -- "$work"' EXIT
printf '%s' "$nonce" > "$work"
[ "$(cat "$work")" = "$nonce" ]
printf 'workspace=%s\nwritable=yes\n' "$root/workspace"
printf 'repo_begin=1\n'
for sources in "$PREFIX/etc/apt/sources.list" "$PREFIX"/etc/apt/sources.list.d/*.list; do
  [ ! -f "$sources" ] || grep -E '^[[:space:]]*deb ' "$sources" || true
done
printf 'repo_end=1\n'
DURABLEAGENT_PROBE
chmod 700 "$HOME/.local/share/durableagent-probe/probe-v1.sh"
termux-reload-settings
printf 'DurableAgent probe v1 configured. Return to the probe app and tap 检查执行环境.\n'

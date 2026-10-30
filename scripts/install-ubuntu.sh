#!/usr/bin/env bash
# Fresh Ubuntu/Debian prerequisite provisioning for Creative Soundwerks 2.
# Node.js v22 is installed from a signed APT repository when /usr/bin/node is too old.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "Run: sudo bash scripts/install-ubuntu.sh" >&2; exit 1; }
[[ -r /etc/os-release ]] || { echo "Unsupported OS" >&2; exit 1; }
. /etc/os-release
case "$ID" in ubuntu|debian) ;; *) echo "Ubuntu/Debian required" >&2; exit 1;; esac
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
 ca-certificates curl gnupg openssl rsync zip unzip \
 postgresql nginx ffmpeg certbot

node_ready(){
 [[ -x /usr/bin/node ]] && /usr/bin/node -e '
 const [major,minor]=process.versions.node.split(".").map(Number);
 if (major<22 || (major===22&&minor<12)) process.exit(1);
 '
}
if ! node_ready; then
 echo "Configuring signed NodeSource Node.js 22.x repository."
 arch="$(dpkg --print-architecture)"
 case "$arch" in amd64|arm64) ;; *) echo "Unsupported Node.js architecture: $arch" >&2; exit 1;; esac
 install -d -m 0755 /usr/share/keyrings
 keyfile="$(mktemp)"
 trap 'rm -f "$keyfile"' EXIT
 curl --retry 3 --fail --silent --show-error --location \
  https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o "$keyfile"
 gpg --batch --yes --dearmor --output /usr/share/keyrings/nodesource.gpg "$keyfile"
 chmod 0644 /usr/share/keyrings/nodesource.gpg
 cat > /etc/apt/sources.list.d/creative-soundwerks-nodesource.sources <<SOURCE
Types: deb
URIs: https://deb.nodesource.com/node_22.x
Suites: nodistro
Components: main
Architectures: $arch
Signed-By: /usr/share/keyrings/nodesource.gpg
SOURCE
 cat > /etc/apt/preferences.d/creative-soundwerks-nodejs <<PINS
Package: nodejs
Pin: origin deb.nodesource.com
Pin-Priority: 600
PINS
 apt-get update
 apt-get install -y nodejs
 node_ready || { echo "Node.js 22.12+ installation failed" >&2; exit 1; }
fi
command -v npm >/dev/null || { echo "npm missing after Node.js installation" >&2; exit 1; }
command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || {
 echo "FFmpeg/FFprobe installation failed" >&2; exit 1;
}
printf 'Node.js: %s\n' "$(/usr/bin/node --version)"
ffmpeg -version | sed -n '1p'
ffprobe -version | sed -n '1p'
echo "Creative Soundwerks system prerequisites installed successfully."

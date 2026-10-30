#!/usr/bin/env bash
# Run once during the initial Creative Soundwerks VPS setup.
set -Eeuo pipefail
if [[ "$EUID" -ne 0 ]]; then
 echo "Run as root: sudo bash scripts/install-ubuntu.sh" >&2
 exit 1
fi
if [[ ! -r /etc/os-release ]]; then
 echo "Only Ubuntu/Debian apt-based VPS installations are supported." >&2
 exit 1
fi
. /etc/os-release
case "$ID" in
 ubuntu|debian) ;;
 *) echo "Unsupported OS: $ID. Use Ubuntu 24.04 or Debian 12." >&2; exit 1;;
esac
export DEBIAN_FRONTEND=noninteractive
echo "Installing Creative Soundwerks VPS prerequisites: FFmpeg, FFprobe, PostgreSQL, Nginx, CA certificates..."
apt-get update
apt-get install -y --no-install-recommends ca-certificates ffmpeg postgresql nginx
command -v ffmpeg >/dev/null || { echo "FFmpeg installation failed" >&2; exit 1; }
command -v ffprobe >/dev/null || { echo "FFprobe installation failed" >&2; exit 1; }
ffmpeg -version | sed -n "1p"
ffprobe -version | sed -n "1p"
if ! command -v node >/dev/null; then
 echo "Node.js 22.12+ is required. Install supported Node.js before npm install." >&2
 exit 1
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22 || (a===22&&b<12)){console.error("Node.js >=22.12 required");process.exit(1)}'
command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }
echo "All system prerequisites ready. Continue with npm install, npm run db:migrate, and first-admin setup."

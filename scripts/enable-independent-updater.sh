#!/usr/bin/env bash
# One-time integration for systemd-managed Node sites. No DevOne dependency.
set -Eeuo pipefail
umask 077
ROOT="" CONFIG="" SITE_USER="" SITE_SERVICE=""
die(){ echo "Creative Soundwerks updater: $*" >&2; exit 1; }
while [[ $# -gt 0 ]]; do
 case "$1" in
 --app-root) [[ $# -ge 2 ]] || die "Missing app-root"; ROOT="$2"; shift 2;;
 --config) [[ $# -ge 2 ]] || die "Missing config"; CONFIG="$2"; shift 2;;
 --site-user) [[ $# -ge 2 ]] || die "Missing site-user"; SITE_USER="$2"; shift 2;;
 --site-service) [[ $# -ge 2 ]] || die "Missing site-service"; SITE_SERVICE="$2"; shift 2;;
 --help|-h)
  echo "Usage: sudo bash scripts/enable-independent-updater.sh --app-root /path/to/app --config /private/path/.env --site-user appuser --site-service app.service"
  exit 0;;
 *) die "Unexpected argument";;
 esac
done
[[ "$EUID" -eq 0 ]] || die "Run with sudo"
[[ "$ROOT" == /* && "$CONFIG" == /* ]] || die "Require absolute paths"
[[ "$ROOT" =~ ^/[A-Za-z0-9_./-]+$ && "$CONFIG" =~ ^/[A-Za-z0-9_./-]+$ ]] || die "Invalid paths"
[[ "$SITE_USER" =~ ^[a-z_][a-z0-9_-]{0,62}$ ]] || die "Invalid Linux account"
[[ "$SITE_SERVICE" =~ ^[A-Za-z0-9_.@-]{2,80}\.service$ ]] || die "Invalid systemd service"
ROOT="$(realpath -e -- "$ROOT")"
CONFIG="$(realpath -e -- "$CONFIG")"
[[ -f "$ROOT/scripts/self-updater.mjs" && -f "$ROOT/scripts/update-boot.mjs" ]] || die "Missing updater files"
[[ -f "$CONFIG" && ! -L "$CONFIG" ]] || die "Private config is missing or a symlink"
id "$SITE_USER" >/dev/null || die "Linux site user does not exist"
systemctl cat "$SITE_SERVICE" >/dev/null 2>&1 || die "Node service not found"
UPDATE_DIR="$(sed -n 's/^CSW_UPDATE_ROOT=//p' "$CONFIG" | head -n 1)"
[[ -n "$UPDATE_DIR" ]] || UPDATE_DIR="$(dirname "$CONFIG")/csw-updates"
[[ "$UPDATE_DIR" == /* && "$UPDATE_DIR" =~ ^/[A-Za-z0-9_./-]+$ ]] || die "Invalid private update path"
[[ ! -L "$UPDATE_DIR" ]] || die "Update path is a symlink"
if [[ ! -e "$UPDATE_DIR" ]]; then
 install -d -o "$SITE_USER" -g "$(id -gn "$SITE_USER")" -m 0700 "$UPDATE_DIR"
fi
[[ -d "$UPDATE_DIR" && ! -L "$UPDATE_DIR" ]] || die "Update path is not a safe directory"
runuser -u "$SITE_USER" -- test -w "$UPDATE_DIR" || die "Site user cannot write update data"
runuser -u "$SITE_USER" -- test -r "$CONFIG" || die "Site user cannot read config"
runuser -u "$SITE_USER" -- test -r "$ROOT/scripts/self-updater.mjs" || die "Site user cannot read worker"
ID="$(printf '%s' "$ROOT|$SITE_SERVICE" | sha256sum | cut -c1-12)"
NAME="csw-updater-$ID"
UNIT="/etc/systemd/system/$NAME.service"
TIMER="/etc/systemd/system/$NAME.timer"
[[ ! -e "$UNIT" && ! -e "$TIMER" ]] || die "Updater already registered as $NAME"
cat > "$UNIT" <<UNITFILE
[Unit]
Description=Independent Creative Soundwerks updater for $SITE_SERVICE
After=network-online.target
[Service]
Type=oneshot
WorkingDirectory=$ROOT
ExecStart=/usr/sbin/runuser -u $SITE_USER -- /usr/bin/env CSW_INSTALL_ROOT=$ROOT CSW_CONFIG_PATH=$CONFIG CSW_UPDATE_ROOT=$UPDATE_DIR /usr/bin/node $ROOT/scripts/self-updater.mjs
ExecStartPost=/usr/bin/bash -c 'if [ -f $UPDATE_DIR/restart.flag ]; then rm -f $UPDATE_DIR/restart.flag; /usr/bin/systemctl restart $SITE_SERVICE; fi'
UMask=0077
NoNewPrivileges=true
UNITFILE
cat > "$TIMER" <<TIMERFILE
[Unit]
Description=Check approved Creative Soundwerks update requests
[Timer]
OnBootSec=45s
OnUnitInactiveSec=30s
Unit=$NAME.service
[Install]
WantedBy=timers.target
TIMERFILE
chmod 0644 "$UNIT" "$TIMER"
systemctl daemon-reload
systemctl enable --now "$NAME.timer"
echo "Enabled independent updater: $NAME.timer"
echo "Your Node entrypoint must launch scripts/update-boot.mjs (or import it from server.mjs)."
echo "Existing Node service configurations were NOT modified."

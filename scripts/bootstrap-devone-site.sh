#!/usr/bin/env bash
# Existing DevOne-managed Creative Soundwerks -> independent Creative Soundwerks updater.
# Defaults to read-only checks. Requires explicit --apply to change a site.
set -Eeuo pipefail
umask 077
ID="" APPLY=false
while [[ $# -gt 0 ]]; do
 case "$1" in
  --site-id) ID="$2"; shift 2;;
  --check) APPLY=false; shift;;
  --apply) APPLY=true; shift;;
  -h|--help) echo 'Usage: sudo bash bootstrap-devone-site.sh --site-id site_0123456789abcdef [--check|--apply]'; exit 0;;
  *) echo 'Unknown argument' >&2; exit 2;;
 esac
done
die(){ echo "Creative Soundwerks bootstrap: $*" >&2; exit 1; }
msg(){ echo "[Creative Soundwerks] $*"; }
[[ $EUID -eq 0 ]] || die 'Use sudo.'
[[ "$ID" =~ ^site_[a-f0-9]{16}$ ]] || die 'Enter the exact site ID from DevOne Websites & Files.'
USER_NAME="dvs_$(printf '%s' "$ID" | cut -c6-)"
HOME_DIR="/home/devone-sites/$ID"
PUBLIC="$HOME_DIR/public"
DATA="$HOME_DIR/data"
CONFIG="$DATA/.env"
SERVICE="devone-$ID.service"
UPDATES="$DATA/csw-updates"
for path in "$HOME_DIR" "$PUBLIC" "$DATA"; do
 [[ -d "$path" && ! -L "$path" ]] || die "Missing/unsafe site directory: $path"
done
[[ -f "$CONFIG" && ! -L "$CONFIG" && -f "$PUBLIC/server.mjs" ]] || die 'Missing private configuration or Node entry point.'
[[ $(stat -c %U "$PUBLIC") == "$USER_NAME" ]] || die 'Wrong website Linux user.'
grep -Fq 'apps/api/dist/index.js' "$PUBLIC/server.mjs" || die 'The site no longer uses the original entry point. Bootstrap may already be complete.'
[[ -f "$PUBLIC/apps/api/dist/index.js" ]] || die 'The original Creative Soundwerks API is missing.'
for cmd in git npm node pg_dump pg_restore curl runuser; do command -v "$cmd" >/dev/null || die "Missing $cmd"; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))process.exit(1)' || die 'Node.js 22.12+ required.'
systemctl cat "$SERVICE" >/dev/null 2>&1 || die 'DevOne Node service missing.'
[[ $(systemctl show "$SERVICE" -p User --value) == "$USER_NAME" ]] || die 'Service user mismatch.'
[[ $(systemctl show "$SERVICE" -p WorkingDirectory --value) == "$PUBLIC" ]] || die 'Service working directory mismatch.'
systemctl show "$SERVICE" -p ExecStart --value | grep -Fq "$PUBLIC/server.mjs" || die 'Unexpected systemd entry point.'
systemctl show "$SERVICE" -p Environment --value | grep -Fq "CSW_CONFIG_PATH=$CONFIG" || die 'Unexpected private configuration path.'
systemctl is-active --quiet "$SERVICE" || die 'Site is not running; inspect it before upgrading.'
DB_NAME="$(node - "$CONFIG" <<'NODE'
const {readFileSync}=require('node:fs');
const m=readFileSync(process.argv[2],'utf8').match(/^DATABASE_URL=(.+)$/m);
try{
 const db=new URL(m?.[1]||'');
 const name=db.pathname.slice(1);
 if(!['postgres:','postgresql:'].includes(db.protocol)||db.hostname!=='127.0.0.1'||
    db.port!=='5432'||!/^dv[a-f0-9]{16}$/.test(name)||db.username!==name)process.exit(1);
 console.log(name);
}catch{process.exit(1);}
NODE
)" || die 'Unexpected database configuration.'
[[ "$DB_NAME" =~ ^dv[a-f0-9]{16}$ ]] || die 'Unsafe database name.'
[[ $(runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'") == '1' ]] || die 'PostgreSQL database unavailable.'
TARGET="$(node <<'NODE'
const repo='developeronesw/CreativeSoundwerks2';
async function get(path){
 const r=await fetch('https://api.github.com/repos/'+repo+path,{
  headers:{Accept:'application/vnd.github+json','User-Agent':'CSW-Existing-Site-Bootstrap'},
  redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('GitHub HTTP '+r.status);
 return r.json();
}
(async()=>{
 const sha=(await get('/git/ref/heads/main'))?.object?.sha;
 if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('Invalid official GitHub revision');
 const data=await get('/actions/runs?head_sha='+sha+'&per_page=30');
 const matched=(Array.isArray(data.workflow_runs)?data.workflow_runs:[]).filter(x=>
  x.head_sha===sha&&x.head_branch==='main'&&x.name==='Creative Soundwerks CI'&&x.event==='push');
 if(matched.length!==1||matched[0].status!=='completed'||matched[0].conclusion!=='success')
  throw Error('Official main commit has not passed CI');
 console.log(sha);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
NODE
)" || die 'Latest official Creative Soundwerks commit has not passed CI.'
msg "Site: $ID; service: $SERVICE; official verified revision: $TARGET"
msg "Database and media stay in $DATA."
if ! "$APPLY"; then
 msg 'Read-only checks passed. No server changes made.'
 msg "For the one-time upgrade: sudo bash bootstrap-devone-site.sh --site-id $ID --apply"
 exit 0
fi
FREE_KB="$(df -Pk "$HOME_DIR" | awk 'NR==2{print $4}')"
[[ "$FREE_KB" =~ ^[0-9]+$ && "$FREE_KB" -ge 2097152 ]] || die 'At least 2 GiB free disk space is required.'
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGE="$HOME_DIR/.csw-stage-$STAMP"
OLD="$HOME_DIR/.csw-previous-$STAMP"
BACKUP_DIR="$HOME_DIR/.csw-dbbackup-$STAMP"
BACKUP="$BACKUP_DIR/postgres.dump"
install -d -m 0700 "$BACKUP_DIR"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0700 "$STAGE"
msg 'Fetching and compiling in a separate site-owned directory (live site remains online).'
runuser -u "$USER_NAME" -- git -C "$STAGE" init -q
runuser -u "$USER_NAME" -- git -C "$STAGE" remote add origin https://github.com/developeronesw/CreativeSoundwerks2.git
runuser -u "$USER_NAME" -- git -C "$STAGE" fetch --depth 1 --no-tags origin "$TARGET"
runuser -u "$USER_NAME" -- git -C "$STAGE" checkout -q --detach FETCH_HEAD
[[ $(runuser -u "$USER_NAME" -- git -C "$STAGE" rev-parse HEAD) == "$TARGET" ]] || die 'Fetched revision mismatch.'
(
 cd "$STAGE"
 runuser -u "$USER_NAME" -- npm install --include=dev --no-audit --no-fund
 runuser -u "$USER_NAME" -- npm run check
 runuser -u "$USER_NAME" -- npm run build
)
for file in apps/api/dist/index.js apps/web/dist/index.html scripts/self-updater.mjs scripts/update-boot.mjs scripts/enable-independent-updater.sh; do
 [[ -f "$STAGE/$file" ]] || die "Missing compiled file: $file"
done
printf 'import "./scripts/update-boot.mjs";\n' | runuser -u "$USER_NAME" -- tee "$STAGE/server.mjs" >/dev/null
runuser -u "$USER_NAME" -- chmod 0644 "$STAGE/server.mjs"
runuser -u "$USER_NAME" -- rm -r -- "$STAGE/.git"

STOPPED=false
OLD_MOVED=false
NEW_MOVED=false
DB_BACKED=false
MIGRATED=false
DONE=false
recover(){
 local rc="$?"
 trap - EXIT
 if [[ $rc -ne 0 && "$STOPPED" == true && "$DONE" == false ]]; then
  msg 'Upgrade failed; attempting to restore original application and PostgreSQL.'
  systemctl stop "$SERVICE" >/dev/null 2>&1 || true
  local good=true
  if [[ "$OLD_MOVED" == true ]]; then
   if [[ "$NEW_MOVED" == true ]]; then mv "$PUBLIC" "$STAGE.failed" || good=false; fi
   mv "$OLD" "$PUBLIC" || good=false
  fi
  if [[ "$MIGRATED" == true && "$DB_BACKED" == true ]]; then
   runuser -u postgres -- pg_restore --clean --if-exists --no-owner --no-privileges \
    --exit-on-error --dbname="$DB_NAME" < "$BACKUP" || good=false
  fi
  if [[ "$good" == true ]]; then systemctl start "$SERVICE" || good=false; fi
  if [[ "$good" == true ]]; then msg 'Original site restored.'; else
   msg "MANUAL RECOVERY REQUIRED. Preserve $BACKUP_DIR and $OLD. Do not retry."
  fi
 fi
 exit "$rc"
}
trap recover EXIT
msg 'Stopping the Node site briefly to take a consistent database backup.'
systemctl stop "$SERVICE"
STOPPED=true
runuser -u postgres -- pg_dump --format=custom --no-owner --no-privileges "$DB_NAME" > "$BACKUP"
[[ -s "$BACKUP" ]] || die 'PostgreSQL backup empty.'
DB_BACKED=true
msg 'Migrating the existing database without replacing private configuration or media.'
MIGRATED=true
(
 cd "$STAGE"
 runuser -u "$USER_NAME" -- env CSW_CONFIG_PATH="$CONFIG" npm run db:migrate
)
mv "$PUBLIC" "$OLD"
OLD_MOVED=true
mv "$STAGE" "$PUBLIC"
NEW_MOVED=true
systemctl start "$SERVICE"
PORT="$(node - "$CONFIG" <<'NODE'
const {readFileSync}=require('node:fs');
const m=readFileSync(process.argv[2],'utf8').match(/^PORT=(\d+)$/m);
const p=Number(m?.[1]||8787);
if(!Number.isInteger(p)||p<1024||p>65535)process.exit(1);
console.log(p);
NODE
)" || die 'Invalid Node port.'
healthy=false
for attempt in $(seq 1 40); do
 if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"ok":true'; then
  healthy=true; break
 fi
 sleep 2
done
[[ "$healthy" == true ]] || die 'New API health check failed.'
[[ ! -e "$UPDATES/status.json" ]] || die 'An existing update state already exists; inspect before replacing it.'
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0700 "$UPDATES"
node - "$TARGET" "$UPDATES/status.json" <<'NODE'
const {writeFileSync}=require('node:fs');
writeFileSync(process.argv[3],JSON.stringify({
 installedSha:process.argv[2],stage:'succeeded',updatedAt:new Date().toISOString(),error:null
}),{flag:'wx',mode:0o600});
NODE
chown "$USER_NAME:$USER_NAME" "$UPDATES/status.json"
DONE=true
msg "Existing site upgraded to $TARGET, with original source and PostgreSQL snapshot retained."
if bash "$PUBLIC/scripts/enable-independent-updater.sh" \
 --app-root "$PUBLIC" --config "$CONFIG" --site-user "$USER_NAME" --site-service "$SERVICE"; then
 msg 'Independent updater enabled. Future updates: Creative Soundwerks > Administrator > Software updates.'
else
 msg 'Application upgraded, but updater timer registration failed; review error and rerun that setup separately.'
fi
msg "Previous site: $OLD"
msg "PostgreSQL snapshot: $BACKUP"
msg 'Do not delete backups until you have verified the site and updater.'

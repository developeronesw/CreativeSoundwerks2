#!/usr/bin/env bash
# Creative Soundwerks 2 extracted-ZIP installer for a FRESH Ubuntu/Debian VPS.
# Usage: sudo bash install.sh --domain streaming.example.com --email admin@example.com
# Dry-run manifest check (no root required): bash install.sh --check
set -Eeuo pipefail
umask 077
SOURCE="$(cd -- "$(dirname -- "$0")" && pwd -P)"
TARGET="/opt/creative-soundwerks"
MEDIA_DIR="/var/lib/creative-soundwerks/media"
NGINX_FILE="/etc/nginx/sites-available/creative-soundwerks"
ACME_ROOT="/var/www/creative-soundwerks-acme"
DOMAIN=""
EMAIL=""
CHECK=false

die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info(){ printf '[Creative Soundwerks] %s\n' "$*"; }
usage(){
 cat <<'USAGE'
Upload creative-soundwerks2-install.zip to your Ubuntu 24.04 / Debian 12 VPS.
Unzip it into a new folder, cd to that folder, and run:

  sudo bash install.sh --domain stream.example.com --email admin@example.com

The installer provisions Node.js 22, PostgreSQL, FFmpeg/FFprobe, a dedicated
application user, an HTTPS Nginx site, a systemd service, and private storage.
After it finishes, open https://YOUR_DOMAIN/setup and create the first admin.
You will need the setup token stored privately on the server.

Checks only (no root, no changes): bash install.sh --check
This fresh-install tool will NOT overwrite an existing installation or database.
USAGE
}
while [[ $# -gt 0 ]]; do
 case "$1" in
  --check) CHECK=true; shift ;;
  --domain) [[ $# -ge 2 ]] || die "--domain needs a value"; DOMAIN="$2"; shift 2;;
  --email) [[ $# -ge 2 ]] || die "--email needs a value"; EMAIL="$2"; shift 2;;
  --help|-h) usage; exit 0;;
  *) die "Unknown argument $1";;
 esac
done
# A distribution ZIP must include everything needed; no network calls on --check.
for file in package.json package-lock.json .env.example \
 apps/api/package.json apps/api/dist/index.js \
 apps/api/src/migrate.ts apps/api/src/db.ts apps/api/src/env.ts \
 apps/api/sql/001_init.sql apps/api/sql/002_media_library.sql \
 apps/api/sql/003_images.sql apps/web/package.json \
 apps/web/dist/index.html scripts/install-ubuntu.sh \
 deploy/nginx-https.conf.template deploy/creative-soundwerks.service; do
 [[ -f "$SOURCE/$file" ]] || die "Incomplete release ZIP: missing $file"
done
bash -n "$SOURCE/scripts/install-ubuntu.sh"
if "$CHECK"; then info "Release ZIP structure and installer syntax verified."; exit 0; fi

[[ $EUID -eq 0 ]] || die "Run as root: sudo bash install.sh --domain ... --email ..."
[[ -n "$DOMAIN" ]] || die "Provide --domain, e.g. media.example.com"
[[ -n "$EMAIL" ]] || die "Provide --email for Let's Encrypt certificate notifications"
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "Invalid DNS domain"
[[ "$DOMAIN" == *.* ]] || die "Use a valid public DNS domain"
[[ $(printf %s "$DOMAIN" | wc -c) -le 253 ]] || die "DNS domain too long"
[[ ! "$DOMAIN" =~ \.\. ]] || die "Invalid DNS domain"
[[ "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die "Invalid email address"
[[ "$SOURCE" != "$TARGET" ]] || die "Extract the ZIP outside $TARGET before installation"
[[ ! -e "$TARGET" ]] || die "$TARGET already exists. Existing installs are not overwritten; back up and use the upgrade process."
[[ ! -e "$NGINX_FILE" ]] || die "$NGINX_FILE already exists. Refusing to overwrite your web configuration."
[[ ! -e /etc/systemd/system/creative-soundwerks.service ]] || die "A Creative Soundwerks service already exists"
info "Installing system packages (including FFmpeg, FFprobe, Node.js and PostgreSQL)."
bash "$SOURCE/scripts/install-ubuntu.sh"
systemctl enable --now postgresql
systemctl enable --now nginx
[[ -x /usr/bin/node ]] || die "Node.js was not installed into /usr/bin/node"
command -v openssl >/dev/null || die "OpenSSL is required"
command -v certbot >/dev/null || die "Certbot is required"
command -v rsync >/dev/null || die "rsync is required"

# Refuse to alter a previously existing database or role.
if runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_roles WHERE rolname='csw'" | grep -qx 1; then
 die "Database role csw already exists. Refusing to replace it."
fi
if runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname='creative_soundwerks'" | grep -qx 1; then
 die "Database creative_soundwerks already exists. Refusing to replace it."
fi
info "Installing the packaged application to $TARGET."
install -d -m 0755 "$TARGET"
rsync -a --exclude=node_modules --exclude=.env --exclude=storage --exclude=.git \
 "$SOURCE/" "$TARGET/"
chmod 0755 "$TARGET/install.sh" "$TARGET/scripts/"*.sh
DB_PASSWORD="$(openssl rand -hex 32)"
SETUP_TOKEN="$(openssl rand -hex 32)"
if ! id csw >/dev/null 2>&1; then
 useradd --system --home-dir "$TARGET" --shell /usr/sbin/nologin --user-group csw
fi
install -d -o csw -g csw -m 0700 "$MEDIA_DIR"
# Password and token are hex characters only; no untrusted shell/SQL interpolation.
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c \
 "CREATE ROLE csw LOGIN PASSWORD '$DB_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION"
runuser -u postgres -- createdb -O csw -E UTF8 creative_soundwerks
cat > "$TARGET/.env" <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
DATABASE_URL=postgres://csw:$DB_PASSWORD@127.0.0.1:5432/creative_soundwerks
CSW_SETUP_TOKEN=$SETUP_TOKEN
COOKIE_SECURE=true
PUBLIC_APP_URL=https://$DOMAIN
MEDIA_ROOT=$MEDIA_DIR
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
ENV
chown root:csw "$TARGET/.env"
chmod 0640 "$TARGET/.env"
cd "$TARGET"
info "Installing release dependencies and migrating database."
npm ci --no-audit --no-fund
npm run db:migrate
[[ -f apps/web/dist/index.html && -f apps/api/dist/index.js ]] || die "Compiled application is missing"
info "Configuring HTTPS with Let's Encrypt."
install -d -m 0755 "$ACME_ROOT/.well-known/acme-challenge"
# On port 80, expose ONLY ACME verification until the certificate is issued.
cat > "$NGINX_FILE" <<HTTP
server {
    listen 80;
    server_name $DOMAIN;
    location ^~ /.well-known/acme-challenge/ { root $ACME_ROOT; }
    location / { return 503; }
}
HTTP
ln -sfn "$NGINX_FILE" /etc/nginx/sites-enabled/creative-soundwerks
nginx -t
systemctl reload nginx
certbot certonly --webroot -w "$ACME_ROOT" --non-interactive --agree-tos \
 --email "$EMAIL" -d "$DOMAIN" --keep-until-expiring
# Fill only validated DNS values, never eval arbitrary shell values.
sed -e "s/CSW_DOMAIN_PLACEHOLDER/$DOMAIN/g" \
    -e "s|CSW_ACME_ROOT_PLACEHOLDER|$ACME_ROOT|g" \
 "$TARGET/deploy/nginx-https.conf.template" > "$NGINX_FILE"
nginx -t
systemctl reload nginx
install -m 0644 "$TARGET/deploy/creative-soundwerks.service" /etc/systemd/system/creative-soundwerks.service
systemctl daemon-reload
systemctl enable --now creative-soundwerks
info "Verifying local API health."
healthy=false
for _ in $(seq 1 30); do
 if curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then healthy=true; break; fi
 sleep 1
done
"$healthy" || die "Service health check failed. Inspect: journalctl -u creative-soundwerks -n 100"
info "Installation finished. Open https://$DOMAIN/setup to create the first administrator."
info "On the VPS, obtain the one-time setup token with:"
printf '  sudo grep "^CSW_SETUP_TOKEN=" %s/.env\n' "$TARGET"
info "KEEP THE SETUP TOKEN PRIVATE. This is a fresh install, not an upgrade mechanism."

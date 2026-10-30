# Creative Soundwerks 2 — ZIP installation on a VPS

**Fresh installation only.** This is a Node.js/PostgreSQL streaming application, not a PHP plugin. Uploading and extracting the release ZIP does not launch the backend on its own. One terminal command with sudo is required to provision services; the admin account is then created in a WordPress-style browser wizard.

## 1. Prepare

- A fresh Ubuntu 24.04 / Debian 12 VPS with sudo access and sufficient space for your media catalog.
- DNS A/AAAA record for your streaming domain pointing to the VPS.
- Ports 80 and 443 open; port 5432 (PostgreSQL) must stay private.
- Download the successful main-branch GitHub Actions artifact named creative-soundwerks2-install. GitHub places the actual file creative-soundwerks2-install.zip inside an artifact-download ZIP. Extract the *inner* installer ZIP onto your VPS via SFTP, your VPS file manager or SSH.

## 2. Extract and launch the installer

Run from the directory where you extracted the inner ZIP:

    mkdir -p ~/csw-install && cd ~/csw-install
    unzip /path/to/creative-soundwerks2-install.zip
    bash install.sh --check
    sudo bash install.sh --domain media.example.com --email you@example.com

The ZIP has install.sh at its root (not buried in a nested folder). The --check option does not need root or make system changes; it validates that the release contains the built frontend, API, database migration files, a lockfile and installer scripts.

## 3. Automatic VPS provisioning

The root installer:
1. Installs PostgreSQL, Nginx, FFmpeg, FFprobe, Certbot and supporting utilities.
2. Installs Node.js 22 from a signed NodeSource APT repository if /usr/bin/node is below 22.12; no curl-to-shell execution.
3. Creates a restricted csw system user, dedicated local PostgreSQL database and secure per-server credentials.
4. Copies the bundled built React frontend and Node.js backend to /opt/creative-soundwerks. Media storage is outside Nginx in /var/lib/creative-soundwerks/media.
5. Installs the npm dependency lockfile with npm ci, applies the database migrations, and obtains a free Let's Encrypt certificate using HTTP validation.
6. Configures Nginx for HTTPS, enables the systemd application service, and checks API health.

Existing installed sites, roles and app directories are not overwritten. If DNS or certificate issuance fails, the temporary HTTP server returns 503 instead of exposing the setup screen over plaintext. A partial failed install requires administrator diagnosis/recovery; it is *not* a safe upgrade or reset tool.

## 4. Complete setup in the browser

Open https://media.example.com/setup to create the first administrator. Retrieve the one-time setup token from the VPS terminal (do not send it to anyone):

    sudo grep '^CSW_SETUP_TOKEN=' /opt/creative-soundwerks/.env

The wizard checks FFmpeg/FFprobe readiness and securely creates the first administrator. Set membership prices/upload limits in the admin dashboard, and separately configure Stripe server secrets before accepting payments.

## Operations and limitations

- API service: sudo systemctl status creative-soundwerks
- Logs: sudo journalctl -u creative-soundwerks -n 100
- API check: curl -fsS http://127.0.0.1:8787/api/health
- Web server check: sudo nginx -t
- Verify TLS renewal: sudo systemctl status certbot.timer
- Keep encrypted, synchronized backups of PostgreSQL and /var/lib/creative-soundwerks/media; run disaster recovery tests before production.
- HLS, large-scale encoding/transcoding, payments/payout audit and full production hardening remain separate development milestones.
- A ZIP installer for *fresh installations* does not replace the need for a future backups-aware upgrade and migration workflow.

# VPS deployment notes (Ubuntu 24.04)

**Install and verify on a staging VPS before sending traffic.** These are infrastructure templates, not a completed one-command installer.

1. Install current Node.js 22 LTS (22.12+), PostgreSQL 16+, Nginx and FFmpeg. Use a dedicated, non-login system user `csw` and a database role `csw` with privileges limited to one application database.
2. Deploy the repository under `/opt/creative-soundwerks`. Use `npm install`, `npm run check`, `npm run build`, and `npm run db:migrate`.
3. Create `/opt/creative-soundwerks/.env` from the root `.env.example`; permissions `root:csw` and `0640`. Set a long random `CSW_SETUP_TOKEN`, the real local `DATABASE_URL`, `PUBLIC_APP_URL=https://YOUR_DOMAIN`, `NODE_ENV=production`, `COOKIE_SECURE=true`, and `MEDIA_ROOT=/var/lib/creative-soundwerks/media`.
4. Create the private media directory as `csw:csw`, permissions `0700`. Never place media inside Nginx's web root. Block direct internet access to PostgreSQL and port 8787.
5. Install `deploy/creative-soundwerks.service` to `/etc/systemd/system/` and `systemctl daemon-reload && systemctl enable --now creative-soundwerks`.
6. Copy the Nginx example to `/etc/nginx/sites-available/creative-soundwerks`, substitute the actual domain, enable the site, `nginx -t`, reload Nginx, and enable HTTPS using Certbot. Force HTTPS, HSTS, and disable unencrypted login/checkout flows.
7. Open `https://YOUR_DOMAIN/setup` and create the administrator with the private setup token. Remove/rotate the setup token after successful setup. Register Stripe webhooks at `https://YOUR_DOMAIN/api/stripe/webhook`.
8. Configure restorable encrypted snapshots of PostgreSQL and the media directory, plus server monitoring and tested recovery procedures.

**Critical:** The original file streaming route serves uploaded media with authorized byte ranges. HLS transcoding and content-rights verification are future milestones; do not market 4K adaptive streaming or DRM protection until those are implemented and tested. The Nginx config is a template and must be reviewed for your domain, SSL, and storage capacity.

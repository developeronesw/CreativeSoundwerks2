# Creative Soundwerks 2

**React + TypeScript + Vite 8 + Tailwind CSS 4 • Fastify/Node.js • PostgreSQL • Stripe • VPS-local media**

The new Creative Soundwerks is a streaming and creator-commerce foundation for music, movies, TV, episodes, short films, music videos, and advertisements. Visual contract: ivory / champagne gold / midnight charcoal, with a persistent audio player and floating mini-video player.

## Official self-updates — no DevOne dependency

Creative Soundwerks has its own **Administrator → Software updates** panel. It checks the official `main` branch and requires the exact GitHub CI run to pass, then requests a new build from a separate private updater service. The worker stages code, snapshots PostgreSQL, migrates the database, activates the new revision, and attempts automatic rollback if health verification fails. Private media and server credentials are retained. **Updates must be explicitly approved by the Creative Soundwerks administrator.**

Fresh standalone VPS installations provision their own updater service and timer automatically. Existing Node.js installations, including the `cs2.devonecms.com` testing site, need a **one-time updater service and Node launcher bootstrap**; after that, updates are managed inside Creative Soundwerks itself—not DevOne. See the [independent update and rollback guide](docs/independent-updates.md). This is a developer preview until the real-host recovery procedure has been rehearsed.

## WordPress-style installation — two supported modes

**DevOne Server, CloudPanel and any compatible Node.js hosting panel:** Download **Code → Download ZIP**, upload and extract it into a private Node application folder, then use your panel's deployment/build command:

```bash
npm install --include=dev
npm run check
npm run build
npm run setup:panel
npm start
```

Set the Node **startup file** to `apps/api/dist/index.js` (or command `npm start`). The Node process serves **both the React site and API on the same port**; point your panel's HTTPS reverse proxy to this port. `npm run setup:panel` produces a secure private installer token, and `https://your-domain/setup` guides you through PostgreSQL connection and first-admin creation. The panel supplies the PostgreSQL database, HTTPS/proxy and Node.js runtime; FFmpeg/FFprobe must be installed by the host for playable media uploads. **No root installer and no DevOne software are required.** See [panel hosting instructions](docs/panel-hosting.md).

**Fresh, unmanaged Ubuntu/Debian VPS:** Use the independent `sudo bash install.sh --domain ... --email ...` method below to provision Node.js, PostgreSQL, FFmpeg, Nginx, HTTPS and the service automatically.

## Install directly from GitHub Download ZIP

Creative Soundwerks 2 is **standalone Node.js software** and does not need DevOne Server Software. On a fresh Ubuntu 24.04/Debian 12 VPS, download this repository using **Code → Download ZIP**, upload it via SSH/SFTP or your hosting file manager, extract it, and run:

```bash
unzip CreativeSoundwerks2-main.zip
cd CreativeSoundwerks2-main
bash install.sh --check
sudo bash install.sh --domain media.example.com --email you@example.com
```

The installer installs Node.js 22, PostgreSQL, Nginx, FFmpeg/FFprobe and HTTPS; it also automatically installs npm dependencies, **builds the React/Vite frontend and Node.js backend from the extracted source**, applies database migrations, and starts the service. Complete the first admin account at `https://media.example.com/setup`. No additional distribution ZIP is required.

**Note:** Extracting files alone is not enough to run a Node application; a sudo-capable VPS with terminal or equivalent hosting-panel command execution is required. The installer deliberately refuses to overwrite an existing deployment. See [GitHub ZIP installation guide](docs/install-from-zip.md).

## Development setup

1. Install Node.js 22.12+, PostgreSQL 16+, and FFmpeg (for future transcoding).
2. Copy `.env.example` to `.env` at the repository root.
3. Create a dedicated local PostgreSQL database and database user; set `DATABASE_URL`.
4. Set `CSW_SETUP_TOKEN` to a unique random value at least 24 characters long.
5. Run `npm install`, then `npm run db:migrate`.
6. Start the API: `npm run dev:api`; start the frontend: `npm run dev:web`.
7. Open http://localhost:5173/setup and create the first admin with the setup token. Disable or rotate the token after setup.
8. Configure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` for billing; webhook endpoint is `/api/stripe/webhook`. Never place Stripe secret keys in frontend code.

### Security model

- Postgres and media files are local to the VPS, not publicly served directories.
- Uploaded media is owned by a user UUID; every private list, update, file upload, purchase and progress query is scoped to authenticated server-side identity.
- Session cookies are HTTP-only; random tokens are stored only as SHA-256 hashes. Passwords use Argon2id.
- Stripe Checkout cannot grant access through a success-page redirect. Only validated signed webhooks record purchases or activate paid subscriptions.
- Creator membership prices and upload limits are configured from the administrator panel and enforced on the API.
- Plan price edits affect **new** Stripe subscriptions; existing subscription prices are not retroactively changed.
- Playback and download endpoints use authenticated entitlement checks and byte-range support; no raw disk path is returned to clients.
- Media uploads are restricted by size and detected file signature, stored under randomized private filenames.

### Current scope and intentional future work

This first implementation provides the working platform foundation, first-admin bootstrap, user and creator accounts, pricing management, private media, playlists/streaming UI foundation, creator uploads, cart, Stripe Checkout and webhooks. Before production launch, complete media transcoding/HLS, backups, abuse scanning, moderation, licensing/DRM for premium catalogs, mail verification, password recovery, Stripe Connect/KYC and creator payouts, subscriptions portal/cancellation, live radio/AzuraCast, ad insertion/reporting, automated load/security tests, and reverse-proxy hardening.

**Do not expose the API directly to the internet without a properly configured HTTPS reverse proxy and rate limits.** Ensure `COOKIE_SECURE=true` and `NODE_ENV=production` in production.

## Legacy features slated for migration

Artist profiles, single/album releases, label management, split payouts, Stripe Connect, KYC, radio hosting and DJs, EPKs, storefront products, smart links, membership fan clubs, pay-per-view and advertising.

## Unified Media Library (audio/video only)

Uploads now go through one central `Media Library` rather than separate WordPress-like file managers for songs, movies, and TV. Each asset is linked to the authenticated uploader and kept in private VPS-local storage; a creator can see only their own assets. The admin-only `Entire library` view lists uploads across users.

The upload server accepts **MP3, FLAC, WAV, OGG, M4A, MP4, MOV and WEBM** after validating file extensions, binary signatures and FFprobe-detected playable streams. Text, PHP, JSON, images and disguised executable/document files are rejected; client filename or MIME declarations are never trusted. Existing media references are migrated to the central asset table without copying files. See [Media Library architecture](docs/media-library.md).

FFmpeg and FFprobe must be installed before attempting real uploads. Full adaptive transcoding and malware scanning remain separate production workstreams.

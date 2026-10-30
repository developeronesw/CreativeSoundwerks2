# Creative Soundwerks 2 — Hosting-panel installer (no DevOne dependency)

Creative Soundwerks is a standalone **React + Node.js + PostgreSQL** application. The same GitHub ZIP can be used with **DevOne Server Software, CloudPanel, and any hosting panel that supports an independent Node.js process**. DevOne is optional.

The project is NOT a PHP plugin. "Plug-and-play" means one extracted application with automatic npm build, a Node entry point and a browser-first database/admin installer. A PHP-only shared hosting account cannot run the API.

## Hosting requirements

- Node.js **22.12+**, with npm and permission to install dependencies and run a persistent Node process.
- PostgreSQL database created by the hosting panel or hosting provider. Keep its user/password private; the browser setup connects it.
- HTTPS domain and a reverse proxy to the Node application. The panel should proxy the **whole site** to the Node port; the app now serves React and API from the same process.
- FFmpeg and FFprobe **available on PATH** for uploading and validating playable audio/video. These are OS-level binaries and cannot safely be installed from a browser without host privileges. Ask the provider to enable them if unavailable.
- Write access to a private configuration file and a private media storage folder. Never make the project root, `.env`, uploads, databases or `node_modules` a public static root.

## A. Download from GitHub and prepare (all panels)

1. Download **Code → Download ZIP** from https://github.com/developeronesw/CreativeSoundwerks2, upload the archive to a private **Node project directory**, and extract it (or use the panel's Git deploy feature).
2. Open a terminal in the extracted directory, or set up an equivalent panel build/deploy command:

```bash
npm install --include=dev
npm run check
npm run build
npm run setup:panel
```

3. The last command creates a private `.env`, a protected external media folder and prints a **one-time setup token**. Keep this token PRIVATE; only the person installing the site should see it. The command deliberately refuses to overwrite an existing configuration.
4. Configure the hosting panel's **startup file** as `apps/api/dist/index.js`, or the startup command as `npm start`. Do **not** start the Vite development server.
5. Use the hosting panel to connect the HTTPS website/domain to the Node application. Default internal port: `8787`; change `PORT` in the private `.env` if the panel allocates a specific port. By default the app binds to `127.0.0.1`, appropriate for a reverse proxy on the same machine. For a container where the proxy is outside the container, set `HOST=0.0.0.0` and restrict network access appropriately.
6. Visit `https://yourdomain.example/setup`.

## B. Browser-guided WordPress-style setup

The installer walks through:

1. **Database connection:** Enter PostgreSQL hostname, port, database, username and password supplied by your panel, the HTTPS public site address and the private one-time installer token.
2. **Database preparation:** The server tests the credentials, checks for existing users, applies its migrations and stores the connection privately with restrictive permissions. It does not grant DB access to other users or expose credentials in the browser.
3. **Administrator:** Create the initial owner/admin account with a strong password and the same installer token.
4. **Configuration:** From the admin dashboard, set creator and listener membership prices, content limits, branding and Stripe secrets (Stripe secrets are configured in the server private environment, not the public UI).
5. **Media readiness:** The wizard checks FFmpeg and FFprobe; both must be installed by the server owner/panel for media processing and uploads.

The installer locks initial setup when the first account exists. Invalid setup tokens, repeated database configuration and attempts to connect an already populated user database are rejected.

## C. Panel-specific setup notes

**DevOne Server Software:** Create a **Node.js site/application**. Upload or sync the GitHub ZIP into its application directory. Assign domain and HTTPS in DevOne, configure an internal port and startup as above. Let DevOne handle service management, Nginx and TLS. Run the panel build commands, then use `/setup`.

**CloudPanel:** Create an appropriate **Node.js website**, upload/extract into its project directory, use the site's Node.js version and reverse proxy settings, configure the startup entry point and HTTPS. CloudPanel manages Nginx/TLS; do not run our root VPS installer within CloudPanel.

**Other Node hosting panels:** The same process works provided the panel supports Node 22+, Postgres, writable private storage, HTTPS proxying and a persistent process. If it only supports static HTML or PHP, it cannot host the API.

**No control panel (dedicated VPS):** Use the separate `sudo bash install.sh --domain ... --email ...` command from the same GitHub ZIP. That installer also provisions OS packages, PostgreSQL, service management and HTTPS.

## When setup is incomplete

- If `/setup` reports database connection pending, confirm the panel already created an **empty** PostgreSQL database and granted the user schema-creation permissions.
- If it reports an existing/broken database, fix the private server environment and run `npm run db:migrate` from a trusted terminal.
- If the Node app responds on its own port but not the domain, adjust panel proxy/domain/HTTPS, not the application code.
- If FFmpeg/FFprobe are unavailable, music/video processing cannot start; ask the server administrator to install them.
- If you use a ZIP from the **main** branch, review its GitHub Actions status before production deployment.

A panel-managed installation performs **no system package installations** and does not modify another panel's Nginx or other sites. Production hardening, backup/restore, HLS transcoding, billing and abuse prevention still require verification before public launch.

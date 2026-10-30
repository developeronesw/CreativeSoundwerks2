# Install Creative Soundwerks 2 directly from GitHub ZIP

This application can be installed on a **standard Ubuntu 24.04 or Debian 12 VPS without DevOne Server Software**. A third-party hosting panel is optional. This is not a PHP application: a Node.js runtime, PostgreSQL database and running service must be provisioned.

## 1. Prepare the VPS

- Fresh VPS (avoid an existing production VPS unless you have reviewed its web/database configuration) with root/sudo/SSH access.
- Public DNS record pointing `media.example.com` to that VPS.
- Inbound ports **80 and 443** permitted. Keep database port **5432** and internal API port **8787** private.
- On GitHub, open the [CreativeSoundwerks2 repository](https://github.com/developeronesw/CreativeSoundwerks2), choose **Code → Download ZIP**, and transfer `CreativeSoundwerks2-main.zip` to the VPS through your hosting file manager or SCP/SFTP.

## 2. Extract the GitHub ZIP

```bash
unzip CreativeSoundwerks2-main.zip
cd CreativeSoundwerks2-main
bash install.sh --check
sudo bash install.sh --domain media.example.com --email you@example.com
```

The preflight check looks for the original source files and requires no root privileges. GitHub's ZIP does **not** include `node_modules/`, `dist/` or the secret `.env`. That is expected: the installer runs `npm install`, `npm run check` and `npm run build` itself. There is no custom ZIP to download or produce.

## 3. What the installer does automatically

1. Installs Node.js 22.12+ (using a signed APT repository where needed), PostgreSQL, Nginx, FFmpeg, FFprobe, Certbot and supporting utilities.
2. Copies this GitHub source to `/opt/creative-soundwerks`.
3. Installs npm dependencies and builds the React/Vite UI and TypeScript Node API using a restricted `csw` user rather than root.
4. Makes the deployed code root-owned and creates private per-install database credentials.
5. Creates a local PostgreSQL database and private media storage under `/var/lib/creative-soundwerks/media`.
6. Applies the schema migrations, configures an HTTPS site using Let's Encrypt, enables automatic certificate renewal and starts a systemd service.
7. Checks the local API health before announcing success.

The installer is **fresh-install only**. It refuses an existing `/opt/creative-soundwerks` application directory or existing database role and does not attempt to overwrite an existing installation. If the installation partially fails, inspect logs and the generated resources before attempting recovery—do not re-run it over live data.

## 4. Finish configuration in the browser

Visit `https://media.example.com/setup`. Retrieve the private setup token in the VPS terminal:

```bash
sudo grep '^CSW_SETUP_TOKEN=' /opt/creative-soundwerks/.env
```

Create the initial administrator, configure creator/listener membership tiers and upload limits, then set Stripe server keys in the protected server `.env` before enabling payments.

## Troubleshooting

```bash
sudo systemctl status creative-soundwerks
sudo journalctl -u creative-soundwerks -n 100
sudo nginx -t
curl -fsS http://127.0.0.1:8787/api/health
```

An installation cannot obtain a free TLS certificate until DNS points to this VPS and port 80 is accessible. Never expose the initial admin form over HTTP just to bypass a certificate failure.

**Production status:** A successfully installed build does not imply the platform has completed every security, streaming, payment, backup or disaster-recovery milestone. Full HLS transcoding, DRM and advanced advertising remain future work.

# Creative Soundwerks 2 — Self-hosted VPS installation

The platform runs independently of DevOne Server Software. **Use the standard GitHub Download ZIP**; there is no separate release ZIP and no git clone is required.

From an extracted `CreativeSoundwerks2-main` directory on a fresh Ubuntu 24.04/Debian 12 VPS:

```bash
bash install.sh --check
sudo bash install.sh --domain media.example.com --email you@example.com
```

The installer installs Node.js, PostgreSQL, Nginx, FFmpeg/FFprobe, Certbot; installs npm dependencies, checks and builds the application from source, creates local PostgreSQL and private media storage, configures HTTPS and a systemd service. Complete the administrator setup at `https://media.example.com/setup`.

See [full GitHub ZIP installation guide](../docs/install-from-zip.md).

The installer is for a **fresh VPS deployment only** and does not upgrade or migrate an existing deployment. Back up the PostgreSQL database and local media storage together before any future migrations. For paid Stripe transactions, configure server-only Stripe credentials and verify purchase/entitlement behavior before launch.

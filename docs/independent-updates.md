# Creative Soundwerks 2 — Independent official GitHub updates

Creative Soundwerks has its **own** update controls in **Administrator → Software updates**. It does not require DevOne Server Software, CloudPanel, or another hosting panel to fetch, build or install releases.

## What the updater does

1. Check the official `developeronesw/CreativeSoundwerks2` **main** branch and its exact-commit **Creative Soundwerks CI** GitHub Actions run.
2. Show the installed SHA, latest SHA and whether CI passed. No arbitrary repository URL, branch, shell command or ZIP is accepted.
3. On explicit administrator approval with password re-verification, queue an update request in a **private filesystem directory**, outside the public website.
4. A separately supervised, unprivileged updater service verifies the GitHub revision again, downloads source, installs dependencies, runs TypeScript checks and builds both apps **without replacing the running files**.
5. Temporarily block application writes; take a private PostgreSQL dump, then apply versioned schema migrations and switch the active release pointer.
6. The service's narrow root-owned restart hook restarts the installed Node service. The updater's next run checks `/api/health` for the exact new revision.
7. On failure, attempt to restore the prior release pointer and PostgreSQL dump and restart again. If restore cannot be verified, leave maintenance enabled and report **needs inspection**. Media assets and the private `.env` never move.

A database upgrade may introduce application-specific migration incompatibilities; therefore **always use a staging instance first** before updating a live commercial service, and maintain separate off-server backups.

## Standalone Creative Soundwerks-only VPS

For new Ubuntu/Debian VPS installs using the repository's `sudo bash install.sh --domain ... --email ...`, the updater is installed automatically:

- `creative-soundwerks.service`: the normal Node application, using the permanent `scripts/update-boot.mjs` launcher.
- `creative-soundwerks-updater.timer`: polls private update requests every 30 seconds.
- `creative-soundwerks-updater.service`: executes the update worker under the restricted `csw` account. Only its fixed restart hook runs as root.
- `/var/lib/creative-soundwerks/updates`: private release staging, status and database snapshots, owned by `csw`.
- `/var/lib/creative-soundwerks/media`: private user media **not touched** by updates.
- `/opt/creative-soundwerks/.env`: persistent private configuration **not overwritten** by updates.

You can run Creative Soundwerks as the only application on this host, with no DevOne installation whatsoever.

To inspect updater services (without mutating the host):

```bash
sudo systemctl status creative-soundwerks-updater.timer
sudo systemctl status creative-soundwerks-updater.service
sudo journalctl -u creative-soundwerks-updater.service -n 60 --no-pager
```

## Existing Node.js hosting (including a DevOne testing site)

There is a **one-time bootstrap requirement** for existing deployments: the updated Creative Soundwerks source (including the update files) must already be deployed, and the Node entrypoint must launch `scripts/update-boot.mjs`. A version that predates the updater cannot update itself.

If you have a systemd-based Node host with sudo access, you can install the standalone update timer **without installing DevOne** using:

```bash
cd /path/to/CreativeSoundwerks2
sudo bash scripts/enable-independent-updater.sh \
 --app-root /path/to/CreativeSoundwerks2 \
 --config /private/path/to/.env \
 --site-user YOUR_LINUX_APP_USER \
 --site-service YOUR_NODE_SITE.service
```

The helper creates only a separate updater timer/service. It does **not** replace the existing Node application's service definition or rewrite its entrypoint. Before enabling one-click updates, configure your Node service's startup entrypoint as `scripts/update-boot.mjs`, or put `import "./scripts/update-boot.mjs";` in the site's existing `server.mjs`. The Node service must have a restart-on-failure policy for unexpected shutdown, and the private configuration must include the correct `PUBLIC_APP_URL` and database credentials. The update-root folder must be writable by the app's dedicated Linux user.

For the **DevOne staging deployment** at `cs2.devonecms.com`, the existing Node site remains the testing host. Once the new Creative Soundwerks code is bootstrapped there, configure the updater timer with that site's app user, `data/.env` and `devone-<SITE_ID>.service`. **Subsequent Creative Soundwerks application updates happen from its own Administrator dashboard.** DevOne is not involved in checking, downloading or applying those updates.

Other hosting panels may use different supervisors and entrypoint names. If they cannot create independent systemd services or run restricted host commands, do **not** pretend a web-only updater can restart and recover a Node process safely. Set up an equivalent external supervisor/worker first.

## Administrators and security

- Only an authenticated Creative Soundwerks **admin** can check or request installation.
- Update installation requires the admin's password again, a matching HTTPS `Origin`, an approved GitHub CI run and exact revision confirmation.
- The background worker gets only the fixed official GitHub repository and an approved SHA; no browser-supplied commands or secrets.
- Database credentials are read from the existing private configuration, not from update requests or GitHub. PostgreSQL dumps stay private.
- Failed update status and recovery requirements are visible in Administrator → Software updates.
- Do not erase the backup directory or previous release until the new build is fully verified.

## Current limitations

- This is a developer-preview update workflow. Passing automated CI does not replace a real VPS rehearsal with failure injection, backups and a restart.
- New standalone installs receive the updater automatically. Existing installs require a one-time service/entrypoint bootstrap.
- A process supervisor is still necessary because Node.js cannot reliably restart itself, and its updater must run outside the web app's own service cgroup.
- Update checks require the server to reach GitHub. If the official repo becomes private or GitHub CI cannot be verified, the updater **fails closed**.
- PostgreSQL dump/restore tools, git, Node.js 22.12+, npm and adequate disk space must be available. Updating does not replace operating-system patch management.

# Creative Soundwerks 2

**React + TypeScript + Vite 8 + Tailwind CSS 4 • Fastify/Node.js • PostgreSQL • Stripe • VPS-local media**

The new Creative Soundwerks is a streaming and creator-commerce foundation for music, movies, TV, episodes, short films, music videos, and advertisements. Visual contract: ivory / champagne gold / midnight charcoal, with a persistent audio player and floating mini-video player.

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

# Creative Soundwerks 2 Architecture Contract

## Boundaries
- Browser: React/TypeScript, Tailwind, Vite, persistent media player.
- API: Fastify/TypeScript, server-side auth/authz and media range delivery.
- DB: PostgreSQL on VPS loopback, limited database account.
- Files: private VPS directory outside Nginx document root.
- Payments: server-side Stripe Checkout and *verified* webhooks; never from the return URL.

## Roles and authorization
- Admin bootstrap requires environment secret and exclusive transaction advisory lock.
- Fans may browse the published catalog, use private carts and purchase titles.
- Creators have isolated uploads and draft libraries; upload limits require active creator subscriptions.
- Admin-only plan price modifications, app status and revenue oversight.
- No endpoint accepts owner_id or user_id from browser to select another account's data.
- Enforce content purchase checks for both stream and download, including Range requests.

## Streaming roadmap
- Phase 1: protected, byte-range origin playback and HTML5 player state that survives React route navigation, with floating video overlay and native browser Picture-in-Picture where supported.
- Phase 2: FFmpeg transcoding, audio normalization, multiple HLS renditions, streaming queues and background job workers, resume across devices, subtitles/captions and offline rights management.
- Phase 3: ad breaks with server-signed eligibility policy, impression tracking and fraud controls.
- Protect against switching two simultaneous audio outputs: one active player instance at a time.

## Commerce roadmap
- Phase 1: cart, one-time purchases and recurring membership checkout; admin prices adjustable for new signups.
- Phase 2: Stripe Connect onboarding and KYC, verified creator payout flows, configurable commissions, refund/chargeback entitlement revocation, tax and invoices, customer billing portal.
- Phase 3: creator label teams, contracts/splits, leases, pay-per-view, fan support, bundles and promotions.

## Security verification required before release
- Integration tests with two independent creator identities and two independent buyers.
- Verify no cross-account reads, writes, drafts, uploaded asset IDs, purchases, order lines or files.
- Fuzz multipart and Range input; test session invalidation, password checks and login throttles.
- Verify Stripe signature rejection, duplicate event replay and webhook out-of-order delivery.
- Configure TLS, HSTS, firewall, PostgreSQL restricted bind, strong passwords, encrypted backups and restore drills.
- Virus scan uploads, sanitize preview metadata, add content moderation and copyright/rights verification.

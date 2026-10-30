# Central Media Library — Creative Soundwerks 2

The Media Library is the one canonical place for uploaded playable files. Songs, music videos, films, short films, TV episodes and trailers all reference assets in `media_assets`; they do not each own independent upload pipelines.

## Ownership and access

- Every asset has a UUID and immutable uploader `owner_id`. Storage is VPS-local under `MEDIA_ROOT/<user-uuid>/<asset-uuid>.<verified-extension>`.
- The user's `/api/library` shows only their own uploads. Creators cannot list, inspect, download, stream, delete, or attach files uploaded by other creators.
- `/api/admin/library` provides administrators with an all-users overview, including the uploader's name/email.
- Private asset file paths are **never** included in API responses.
- Only drafts can change their referenced file. Attaching a file to a published release is not allowed. One owned asset can be reused by multiple owned releases.
- Published releases are streamed through `/api/media/:id/stream` only after publication and applicable purchase entitlement checks. This is distinct from the owner-only private Media Library preview.
- A file still in use by a release cannot be deleted from the library.

## Upload allowlist

Only actual audio and video files are allowed, and both extension and detected file signature must match. FFprobe must also find a real playable stream of the expected type.

| Category | File extensions |
|---|---|
| Audio | `.mp3`, `.flac`, `.wav`, `.ogg`, `.m4a` |
| Video | `.mp4`, `.mov`, `.webm` |

**Not accepted:** PHP, JSON, TXT, HTML, XML, CSV, scripts, executables, archives, documents, PDFs, SVGs, photographs/images, and any file disguised with a media extension. Media files are stored outside the public Nginx root and served only by checked routes.

Limit: **1 GiB per uploaded file**. Creator uploads count toward the active membership's configured upload limit. File validation relies on FFmpeg/FFprobe, which must be installed on the VPS. This is validation, not yet a transcoding or antivirus service.

## API

- `GET /api/library` — authenticated creator/admin, *own* assets only
- `POST /api/library/upload` — multipart upload, field `file`, only permitted media
- `GET /api/library/:id` — owner or admin asset metadata
- `GET /api/library/:id/stream` / `download` — owner or administrator private access
- `DELETE /api/library/:id` — owner or admin, only when no release uses the asset
- `GET /api/admin/library` — administrator's complete index
- `PUT /api/media/:id/asset` — attach an owned, type-compatible asset to an owned draft
- `POST /api/media/:id/upload` — backward-compatible route using the same centralized validator

## Migration

`npm run db:migrate` applies numbered migrations sequentially under a PostgreSQL advisory lock. Migration 002 adds `media_assets` and `media.asset_id` and imports qualifying prior audio/video file references without copying the underlying files.

Keep database and media-directory backups synchronized. Do not expose `MEDIA_ROOT` as a static Nginx alias. Do not treat FFprobe as a malware scanner, a content-rights verifier, or full media transcoding; those are separate production-release workstreams.

## Image artwork and avatars (migration 003)

The centralized `media_assets` table now also permits the `image` type (canonical stored format: WebP). Creators can upload **JPG/JPEG, PNG and WebP** for album art, film posters, TV show artwork and music-video thumbnails. All authenticated users, including listeners, can upload a profile picture to their own account. Images are limited to 10 MB, decoded and re-encoded using Sharp, stripped of original metadata, and resized inside 2400×2400. SVG, GIF, PHP, JSON, HTML, TXT and arbitrary documents remain forbidden.

- `POST /api/library/image`: creator/admin-owned image asset for use as covers.
- `PUT /api/media/:id/cover`: attach only your own image asset to your release.
- `GET /api/media/:id/cover`: published release covers are public; draft cover previews require owner/admin.
- `POST /api/profile/avatar/upload`: all logged-in users can set their own avatar.
- `PUT /api/profile/avatar`: set an existing image asset owned by the user.
- `GET /api/profiles/:id/avatar`: public profile photo of a user.
- An asset in use as a release, cover or avatar cannot be deleted until detached.

System setup: `sudo bash scripts/install-ubuntu.sh` installs FFmpeg and FFprobe automatically. The first-run administrator wizard reports media processing prerequisites. The script is intended for initial Ubuntu/Debian VPS provisioning, not a privileged HTTP request.

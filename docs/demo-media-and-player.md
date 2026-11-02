# Creative Soundwerks 2 — Responsive player and optional demo catalog

## Player improvements

The player is now designed for phone layouts instead of squeezing its desktop three-column layout into a narrow viewport.

- On **phones (up to 630 px)**, the bar has three distinct rows: media title/artwork, centered transport controls, and a seek bar spanning the entire available width. Safe-area padding keeps the seek bar above Android gesture navigation and iOS home indicators.
- On desktop/tablet, the three-column presentation remains, with additional queue/volume controls.
- Audio/video metadata and duration update the seek bar; playback errors are reported rather than displaying a dead transport.
- Previous restarts a track when playback is beyond three seconds and otherwise navigates backward. Next skips to the next playable track.
- Clicking an album or TV show now resolves its child audio/video assets through \`GET /api/media/:id/queue\`; the first playable child starts, and a queue is available from the List icon.
- The queue endpoint checks publication, ownership, and purchases per child before returning playable items.
- The bottom player remains visible for a consistent experience but its controls are disabled until a playable title is selected.
- HTTP streaming still uses the existing private media and byte-range routes.

Recommended manual browser QA: 320, 360, 390, 430, 768 and 1440 px, portrait and landscape. Check titles with long names, play/pause, previous/next, buffering, seek, a full album, video minimize/restore, safe area and keyboard focus.

## Add sample music and videos for a fresh install

Samples are **opt-in**. The production installer does not silently create fake artists, media, or unwanted catalog records.

1. Complete the normal Creative Soundwerks database and first-administrator setup.
2. Open **Administrator → Demo audio and videos**.
3. Confirm the administrator password and explicitly approve **Install demo music and videos**.
4. The server uses FFmpeg to generate **two original synthetic MP3 tracks** and **two short H.264/AAC MP4 test videos**, and Sharp to generate original WebP artwork.
5. Refresh the homepage and Music/Movies pages. The **Night Drive (Demo Album)** plays both tracks in sequence via the queue.

The generated content is clearly marked *Demo*, uses free catalog prices, and is created in the **normal private Media Library folder** with owner-scoped asset records. The audio is a procedural synthesizer test loop, not an existing licensed recording. The videos are synthetic color/test-pattern clips, not commercial films. They are only intended for player, streaming, artwork, catalog and uploader testing.

For standalone or scripted installation, after the administrator wizard you can run from the application root under its own Linux service user:

\`\`\`bash
npm run demo:seed
\`\`\`

The seed command is idempotent; repeating it does not create duplicate published titles. It needs PostgreSQL, FFmpeg, FFprobe, the MP3 and H.264/AAC encoders, Sharp, a configured \`DATABASE_URL\`, and a writable private \`MEDIA_ROOT\`.

**Security:** generating demos is admin-only, requires an explicit browser-origin check and administrator password confirmation, and runs a fixed script; the visitor cannot supply arbitrary commands, media file paths, or URLs. The script does not pull media from the public internet.

## Smoke tests

\`\`\`bash
curl -fsS https://YOUR-SITE/api/media
curl -fsS https://YOUR-SITE/api/media/00000000-0000-4000-8000-00000000d100/queue
curl -sS -D - -o /dev/null -H 'Range: bytes=0-1023' \
  https://YOUR-SITE/api/media/00000000-0000-4000-8000-00000000d101/stream
\`\`\`

The final request should return HTTP **206 Partial Content** and an \`audio/mpeg\` content type. Test the corresponding MP4 and artwork entries as well.

The CI pipeline generates these samples *after* the normal security tests, invokes the seed twice to verify idempotence and exercises the album queue, public stream byte ranges and WebP artwork.

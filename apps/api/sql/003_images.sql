-- Unified media collection now accepts only re-encoded raster artwork alongside audio/video.
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_media_type_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_media_type_check CHECK (media_type IN ('audio','video','image'));
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_extension_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_extension_check CHECK (extension IN ('mp3','flac','wav','ogg','m4a','mp4','mov','webm','webp'));
ALTER TABLE media ADD COLUMN IF NOT EXISTS cover_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS media_cover_asset_idx ON media(cover_asset_id);
CREATE INDEX IF NOT EXISTS users_avatar_asset_idx ON users(avatar_asset_id);
-- Composite keys prevent cross-user cover/avatar assignment even if an application path is missed.
CREATE UNIQUE INDEX IF NOT EXISTS media_assets_owner_pair_idx ON media_assets(owner_id,id);
ALTER TABLE media ADD CONSTRAINT media_cover_owner_fkey FOREIGN KEY (owner_id,cover_asset_id) REFERENCES media_assets(owner_id,id);
ALTER TABLE users ADD CONSTRAINT user_avatar_owner_fkey FOREIGN KEY (id,avatar_asset_id) REFERENCES media_assets(owner_id,id);

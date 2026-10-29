
-- One owner-scoped asset index for every uploaded audio or video file.
CREATE TABLE IF NOT EXISTS media_assets (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 original_name text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
 media_type text NOT NULL CHECK (media_type IN ('audio','video')),
 mime_type text NOT NULL,
 extension text NOT NULL CHECK (extension IN ('mp3','flac','wav','ogg','m4a','mp4','mov','webm')),
 storage_path text NOT NULL UNIQUE,
 size_bytes bigint NOT NULL CHECK (size_bytes > 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_assets_owner_idx ON media_assets(owner_id,created_at DESC);
ALTER TABLE media ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS media_asset_idx ON media(asset_id);
-- Preserve existing local uploads where they were previously attached directly to media.
-- Only known audio/video MIME signatures are eligible for import.
INSERT INTO media_assets(id,owner_id,original_name,media_type,mime_type,extension,storage_path,size_bytes)
SELECT m.id,m.owner_id,'Migrated media '||m.id,
  CASE WHEN m.mime_type LIKE 'audio/%' THEN 'audio' ELSE 'video' END,
  m.mime_type,
  CASE m.mime_type
   WHEN 'audio/mpeg' THEN 'mp3' WHEN 'audio/flac' THEN 'flac'
   WHEN 'audio/ogg' THEN 'ogg' WHEN 'audio/wav' THEN 'wav'
   WHEN 'audio/mp4' THEN 'm4a' WHEN 'video/mp4' THEN 'mp4'
   WHEN 'video/webm' THEN 'webm' WHEN 'video/quicktime' THEN 'mov'
  END,
  m.storage_path, m.size_bytes
FROM media m WHERE m.storage_path IS NOT NULL AND m.size_bytes>0
 AND m.mime_type IN ('audio/mpeg','audio/flac','audio/ogg','audio/wav','audio/mp4','video/mp4','video/webm','video/quicktime')
ON CONFLICT DO NOTHING;
UPDATE media m SET asset_id=a.id FROM media_assets a
WHERE m.asset_id IS NULL AND m.id=a.id AND m.owner_id=a.owner_id;

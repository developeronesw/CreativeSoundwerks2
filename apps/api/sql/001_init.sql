
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
 display_name text NOT NULL, role text NOT NULL CHECK(role IN ('admin','creator','fan')),
 creator_type text CHECK(creator_type IN ('musician','director','content_owner') OR creator_type IS NULL),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plans (
 id uuid PRIMARY KEY, audience text NOT NULL CHECK(audience IN ('creator','fan')),
 name text NOT NULL, description text NOT NULL DEFAULT '', amount_cents integer NOT NULL CHECK(amount_cents >= 0),
 currency text NOT NULL DEFAULT 'usd', interval text NOT NULL DEFAULT 'month',
 upload_limit integer NOT NULL DEFAULT 0, features jsonb NOT NULL DEFAULT '[]'::jsonb,
 active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subscriptions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plan_id uuid NOT NULL REFERENCES plans(id), stripe_customer_id text,
 stripe_subscription_id text UNIQUE, status text NOT NULL DEFAULT 'pending',
 current_period_end timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS media (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('track','album','music_video','movie','short_film','tv_show','episode','trailer')),
 title text NOT NULL, description text NOT NULL DEFAULT '', genre text NOT NULL DEFAULT '',
 visibility text NOT NULL DEFAULT 'draft' CHECK(visibility IN ('draft','published','unlisted')),
 price_cents integer NOT NULL DEFAULT 0 CHECK(price_cents >= 0),
 parent_id uuid REFERENCES media(id) ON DELETE SET NULL, season_number integer, episode_number integer,
 storage_path text, mime_type text, size_bytes bigint,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_owner_idx ON media(owner_id);
CREATE INDEX IF NOT EXISTS media_catalog_idx ON media(visibility,kind);
CREATE TABLE IF NOT EXISTS orders (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), stripe_session_id text UNIQUE,
 amount_cents integer NOT NULL CHECK(amount_cents >= 0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','failed','refunded')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_items (
 order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 media_id uuid NOT NULL REFERENCES media(id),
 unit_amount_cents integer NOT NULL CHECK(unit_amount_cents >= 0),
 PRIMARY KEY(order_id,media_id)
);
CREATE TABLE IF NOT EXISTS purchases (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 media_id uuid NOT NULL REFERENCES media(id),
 order_id uuid NOT NULL REFERENCES orders(id), purchased_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,media_id)
);
CREATE TABLE IF NOT EXISTS carts (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 media_id uuid NOT NULL REFERENCES media(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,media_id)
);
CREATE TABLE IF NOT EXISTS stripe_events (
 event_id text PRIMARY KEY, processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ad_campaigns (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id),
 title text NOT NULL, format text NOT NULL CHECK(format IN ('audio','video')),
 status text NOT NULL DEFAULT 'draft', starts_at timestamptz, ends_at timestamptz,
 budget_cents integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS playback_progress (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 media_id uuid NOT NULL REFERENCES media(id) ON DELETE CASCADE,
 position_seconds integer NOT NULL CHECK(position_seconds >= 0),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,media_id)
);
INSERT INTO plans(id,audience,name,description,amount_cents,upload_limit,features) VALUES
 ('00000000-0000-4000-8000-000000000101','creator','Starter Creator','Independent artists and filmmakers',900,10,'["Creator profile","10 uploads","Basic analytics"]'),
 ('00000000-0000-4000-8000-000000000102','creator','Pro Creator','Growing creator businesses',2900,100,'["100 uploads","Advanced analytics","Monetization"]'),
 ('00000000-0000-4000-8000-000000000103','creator','Studio Creator','Labels and production teams',9900,1000,'["1,000 uploads","Priority support","Team-ready features"]'),
 ('00000000-0000-4000-8000-000000000201','fan','Free','Listen and watch with advertisements',0,0,'["Free catalog","Ad-supported"]'),
 ('00000000-0000-4000-8000-000000000202','fan','Plus','Premium entertainment',999,0,'["Ad-free eligible content","HD playback"]'),
 ('00000000-0000-4000-8000-000000000203','fan','Ultimate','Premium music, movies and TV',1999,0,'["Premium catalog","4K where available"]')
ON CONFLICT(id) DO NOTHING;

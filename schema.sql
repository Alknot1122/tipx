-- =============================================================================
-- TipX PostgreSQL Schema
-- Optimized for minimal row bloat:
--   - Monetary values stored as INT (satang/cents, 1 THB = 100 satang)
--   - VARCHAR limits enforced everywhere
--   - Composite and individual indexes on hot-path lookups
-- =============================================================================

-- -------------------------
-- Extensions
-- -------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid() fallback

-- -------------------------
-- Enums (Idempotent creation)
-- -------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'streamer');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tip_status') THEN
    CREATE TYPE tip_status AS ENUM ('pending', 'succeeded', 'failed', 'refunded');
  END IF;
END $$;

-- -------------------------
-- Users (Admins + Streamers)
-- -------------------------
CREATE TABLE users (
    id                      SERIAL PRIMARY KEY,
    username                VARCHAR(50)  UNIQUE NOT NULL,         -- login handle
    slug                    VARCHAR(50)  UNIQUE,                   -- public URL slug e.g. tip.re-codex.com/al
    email                   VARCHAR(254) UNIQUE,                   -- optional, for notifications
    password_hash           VARCHAR(255) NOT NULL,
    role                    user_role    NOT NULL DEFAULT 'streamer',
    stripe_account_id       VARCHAR(255),                          -- Stripe Connect acct_xxx
    stripe_onboarding_done  BOOLEAN      NOT NULL DEFAULT FALSE,
    avatar_url              VARCHAR(512),                          -- Custom profile avatar
    bg_color                VARCHAR(7)   DEFAULT '#0B0E14',        -- Custom page background color (Hex)
    bg_image_url            VARCHAR(512),                          -- Custom page background image
    avatar_focal_x          INT          DEFAULT 50,                -- avatar focal X% (0-100)
    avatar_focal_y          INT          DEFAULT 50,                -- avatar focal Y% (0-100)
    bg_position_x           INT          DEFAULT 50,                -- background position X% (0-100)
    bg_position_y           INT          DEFAULT 50,                -- background position Y% (0-100)
    bg_scale                INT          DEFAULT 100,               -- background zoom % (100 = actual)
    is_active               BOOLEAN      NOT NULL DEFAULT TRUE,    -- soft-disable accounts
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_slug            ON users(slug);
CREATE INDEX idx_users_stripe_account  ON users(stripe_account_id);
CREATE INDEX idx_users_role            ON users(role);

-- -------------------------
-- Widget Tokens & Settings (1-to-1 with users)
-- -------------------------
CREATE TABLE widget_settings (
    streamer_id             INT          PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    alert_token             VARCHAR(64)  UNIQUE NOT NULL,           -- random token for OBS URL
    -- Alert Box config (stored as compact JSONB)
    alert_config            JSONB        NOT NULL DEFAULT '{
        "duration_ms": 7000,
        "gif_url": "",
        "sound_url": "https://assets.mixkit.co/active_storage/sfx/2568/2568-120.wav",
        "font_family": "Inter",
        "font_size": 32,
        "text_color": "#FFFFFF",
        "bg_color": "transparent",
        "min_amount_to_show": 0,
        "tts_enabled": true,
        "tts_min_amount": 0,
        "tts_volume": 1.0
    }'::JSONB,
    -- Progress Bar config
    progress_config         JSONB        NOT NULL DEFAULT '{
        "goal_label": "Tip Goal",
        "bar_color": "#7C3AED",
        "text_color": "#FFFFFF",
        "bg_color": "#1a1a2e"
    }'::JSONB,
    goal_amount             INT          NOT NULL DEFAULT 0,        -- satang
    goal_current            INT          NOT NULL DEFAULT 0,        -- satang
    goal_start_date         TIMESTAMPTZ,                            -- goal counts only tips after this date (NULL = all time)
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_widget_token          ON widget_settings(alert_token);

-- -------------------------
-- Tips
-- -------------------------
CREATE TABLE tips (
    id                      SERIAL PRIMARY KEY,
    streamer_id             INT           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tipper_name             VARCHAR(50)   NOT NULL DEFAULT 'Anonymous',
    tipper_email            VARCHAR(254),                            -- nullable = anonymous
    message                 VARCHAR(255),                            -- max 255 chars enforced
    amount                  INT           NOT NULL,                  -- total in satang (what donor paid)
    currency                VARCHAR(3)    NOT NULL DEFAULT 'THB',
    platform_fee            INT           NOT NULL DEFAULT 0,        -- TipX 0.5% in satang
    stripe_fee_estimated    INT           NOT NULL DEFAULT 0,        -- Stripe 1.65% in satang
    net_to_streamer         INT           NOT NULL DEFAULT 0,        -- amount - both fees
    stripe_payment_intent   VARCHAR(255)  UNIQUE NOT NULL,           -- pi_xxx
    stripe_charge_id        VARCHAR(255),                            -- ch_xxx (set after succeeded)
    status                  tip_status NOT NULL DEFAULT 'pending',
    is_replayed             BOOLEAN       NOT NULL DEFAULT FALSE,    -- for re-alert button
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tips_streamer_id  ON tips(streamer_id);
CREATE INDEX idx_tips_status       ON tips(status);
CREATE INDEX idx_tips_pi           ON tips(stripe_payment_intent);
CREATE INDEX idx_tips_created      ON tips(streamer_id, created_at DESC);

-- -------------------------
-- Refresh Tokens (for JWT rotation)
-- -------------------------
CREATE TABLE refresh_tokens (
    id          SERIAL       PRIMARY KEY,
    user_id     INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) NOT NULL UNIQUE,    -- stored as SHA-256 hash
    expires_at  TIMESTAMPTZ  NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_refresh_tokens_user    ON refresh_tokens(user_id);

-- -------------------------
-- Trigger: auto-update updated_at
-- -------------------------
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_timestamp_users
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_widget_settings
    BEFORE UPDATE ON widget_settings
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

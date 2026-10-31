-- GolfDay schema (SQLite / libSQL compatible, also runs on Turso)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_site_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  email TEXT,
  handicap_index REAL NOT NULL DEFAULT 0,
  golf_england_id TEXT,
  home_club TEXT,
  country TEXT NOT NULL DEFAULT 'ENG',
  gender TEXT,
  claim_code TEXT NOT NULL,
  handicap_source TEXT NOT NULL DEFAULT 'MANUAL',
  handicap_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE UNIQUE INDEX IF NOT EXISTS players_user_unique ON players (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS players_claim_unique ON players (claim_code);
CREATE INDEX IF NOT EXISTS players_golf_england_idx ON players (golf_england_id);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  club TEXT,
  address TEXT,
  city TEXT,
  country TEXT NOT NULL DEFAULT 'England',
  latitude REAL,
  longitude REAL,
  holes_count INTEGER NOT NULL DEFAULT 18,
  par_total INTEGER NOT NULL DEFAULT 72,
  tees TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'MANUAL',
  external_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX IF NOT EXISTS courses_name_idx ON courses (name);

CREATE TABLE IF NOT EXISTS course_holes (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  hole_number INTEGER NOT NULL,
  par INTEGER NOT NULL,
  stroke_index INTEGER NOT NULL,
  yardages TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX IF NOT EXISTS course_hole_unique ON course_holes (course_id, hole_number);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '08:00',
  course_id TEXT,
  course_name TEXT,
  format TEXT NOT NULL DEFAULT 'STABLEFORD',
  handicap_allowance INTEGER NOT NULL DEFAULT 95,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  max_players INTEGER NOT NULL DEFAULT 72,
  join_code TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 1,
  allow_course_clash INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE UNIQUE INDEX IF NOT EXISTS events_slug_unique ON events (slug);
CREATE INDEX IF NOT EXISTS events_date_idx ON events (date);

CREATE TABLE IF NOT EXISTS event_holes (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  hole_number INTEGER NOT NULL,
  par INTEGER NOT NULL,
  stroke_index INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS event_hole_unique ON event_holes (event_id, hole_number);

CREATE TABLE IF NOT EXISTS event_admins (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'ADMIN',
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE UNIQUE INDEX IF NOT EXISTS event_admin_unique ON event_admins (event_id, user_id);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tee_time TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE UNIQUE INDEX IF NOT EXISTS groups_token_unique ON groups (token);

CREATE TABLE IF NOT EXISTS event_players (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'REGISTERED',
  handicap_index REAL NOT NULL DEFAULT 0,
  course_handicap INTEGER NOT NULL DEFAULT 0,
  playing_handicap INTEGER NOT NULL DEFAULT 0,
  tee TEXT NOT NULL DEFAULT 'White',
  joined_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE UNIQUE INDEX IF NOT EXISTS event_player_unique ON event_players (event_id, player_id);
CREATE INDEX IF NOT EXISTS event_player_group_idx ON event_players (group_id);

CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  hole_number INTEGER NOT NULL,
  strokes INTEGER NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  recorded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE UNIQUE INDEX IF NOT EXISTS score_unique ON scores (event_id, player_id, hole_number);

CREATE TABLE IF NOT EXISTS score_audit (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  hole_number INTEGER NOT NULL,
  old_strokes INTEGER,
  new_strokes INTEGER NOT NULL,
  changed_by TEXT,
  changed_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX IF NOT EXISTS score_audit_event_idx ON score_audit (event_id);

CREATE TABLE IF NOT EXISTS event_state (
  event_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (current_timestamp)
);

-- Game settings, 4BBB pairs and side games (added in a separate table each so
-- existing databases only need these CREATE statements).
CREATE TABLE IF NOT EXISTS event_settings (
  event_id TEXT PRIMARY KEY,
  skins TEXT NOT NULL DEFAULT 'OFF',
  skins_carry INTEGER NOT NULL DEFAULT 1,
  team_format TEXT NOT NULL DEFAULT 'NONE',
  side_holes TEXT NOT NULL DEFAULT '[]',
  sponsors TEXT NOT NULL DEFAULT '[]',
  team_names TEXT NOT NULL DEFAULT '["Team A","Team B"]',
  matches TEXT NOT NULL DEFAULT '[]',
  entry_fee_pence INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (current_timestamp)
);

CREATE TABLE IF NOT EXISTS event_pairs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  name TEXT NOT NULL,
  player_a TEXT NOT NULL,
  player_b TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS event_pairs_event_idx ON event_pairs (event_id);

CREATE TABLE IF NOT EXISTS side_game_entries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  hole_number INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  distance REAL NOT NULL,
  recorded_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE UNIQUE INDEX IF NOT EXISTS side_game_entry_unique ON side_game_entries (event_id, kind, hole_number, player_id);

-- Entry fees: one row per player who has paid (or started paying) for an event.
CREATE TABLE IF NOT EXISTS event_payments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  method TEXT NOT NULL DEFAULT 'MANUAL',
  amount_pence INTEGER NOT NULL DEFAULT 0,
  stripe_session_id TEXT,
  paid_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE UNIQUE INDEX IF NOT EXISTS event_payment_unique ON event_payments (event_id, player_id);

-- Texas scramble: one card per tee group (the team), not per player.
CREATE TABLE IF NOT EXISTS scramble_scores (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  hole_number INTEGER NOT NULL,
  strokes INTEGER NOT NULL,
  drive_player_id TEXT,
  recorded_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE UNIQUE INDEX IF NOT EXISTS scramble_score_unique ON scramble_scores (event_id, group_id, hole_number);
CREATE INDEX IF NOT EXISTS scramble_score_group_idx ON scramble_scores (event_id, group_id);

-- Team-card corrections are audited too - a scramble card is easy to mistype
-- and disputes are settled hole by hole.
CREATE TABLE IF NOT EXISTS scramble_audit (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  hole_number INTEGER NOT NULL,
  old_strokes INTEGER,
  new_strokes INTEGER NOT NULL,
  changed_by TEXT,
  changed_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX IF NOT EXISTS scramble_audit_event_idx ON scramble_audit (event_id);

-- A society is the club that runs the golf days: its own fixture list, roster
-- and seasons. Everything is optional - a one-off event needs no society.
CREATE TABLE IF NOT EXISTS societies (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  home_club TEXT,
  join_code TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE UNIQUE INDEX IF NOT EXISTS societies_slug_unique ON societies (slug);
CREATE UNIQUE INDEX IF NOT EXISTS societies_join_unique ON societies (join_code);

CREATE TABLE IF NOT EXISTS society_members (
  id TEXT PRIMARY KEY,
  society_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'MEMBER',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  joined_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE UNIQUE INDEX IF NOT EXISTS society_member_unique ON society_members (society_id, player_id);
CREATE INDEX IF NOT EXISTS society_member_player_idx ON society_members (player_id);

-- One society per fixture (a golf day belongs to the club that runs it).
CREATE TABLE IF NOT EXISTS society_events (
  id TEXT PRIMARY KEY,
  society_id TEXT NOT NULL,
  event_id TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS society_event_unique ON society_events (event_id);
CREATE INDEX IF NOT EXISTS society_event_society_idx ON society_events (society_id);

-- A season / order of merit: points from the fixtures attached to it.
CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  society_id TEXT,
  name TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  scheme TEXT NOT NULL DEFAULT 'POSITION',
  best_of INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE UNIQUE INDEX IF NOT EXISTS seasons_slug_unique ON seasons (slug);
CREATE INDEX IF NOT EXISTS seasons_society_idx ON seasons (society_id);

CREATE TABLE IF NOT EXISTS season_events (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  event_id TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS season_event_unique ON season_events (event_id);
CREATE INDEX IF NOT EXISTS season_event_season_idx ON season_events (season_id);

-- Every refund (full or partial) against an entry fee, so the organiser has a
-- ledger even when several part-refunds are made against one payment.
CREATE TABLE IF NOT EXISTS payment_refunds (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  amount_pence INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'SUCCEEDED',
  stripe_refund_id TEXT,
  reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX IF NOT EXISTS payment_refund_payment_idx ON payment_refunds (payment_id);
CREATE INDEX IF NOT EXISTS payment_refund_event_idx ON payment_refunds (event_id);

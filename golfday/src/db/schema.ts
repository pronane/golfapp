import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** Users are people who can sign in. A user may be linked to one player profile. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  // site-wide administrator (can create events for anybody, manage catalogue)
  isSiteAdmin: integer("is_site_admin", { mode: "boolean" }).notNull().default(false),
  /** Social sign-in: the provider and the subject claim it issued for this user. */
  oauthProvider: text("oauth_provider"),
  oauthSubject: text("oauth_subject"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  emailUnique: uniqueIndex("users_email_unique").on(t.email),
  oauthUnique: uniqueIndex("users_oauth_unique").on(t.oauthProvider, t.oauthSubject),
}));

/**
 * A player is the golfing identity (handicap, Golf England ID, club).
 * Guest players created by an event admin have no user account until claimed.
 */
export const players = sqliteTable("players", {
  id: text("id").primaryKey(),
  userId: text("user_id"), // nullable: guest players have no login
  name: text("name").notNull(),
  email: text("email"),
  handicapIndex: real("handicap_index").notNull().default(0),
  golfEnglandId: text("golf_england_id"),
  homeClub: text("home_club"),
  country: text("country").notNull().default("ENG"),
  gender: text("gender"), // M | F | X - used for tee selection defaults
  claimCode: text("claim_code").notNull(),
  /**
   * How this golfer holds their handicap - see src/lib/handicapProvenance.ts.
   * A club is optional: WHS | GOLF_ENGLAND | IGOLF | OVERSEAS | SOCIETY |
   * MANUAL | CSV | API | NONE.
   */
  handicapSource: text("handicap_source").notNull().default("MANUAL"),
  /** True only when a national-database lookup supplied the index. */
  handicapVerified: integer("handicap_verified", { mode: "boolean" }).notNull().default(false),
  /** Free text: iGolf number, overseas federation, who maintains a society handicap. */
  handicapNote: text("handicap_note"),
  handicapUpdatedAt: text("handicap_updated_at"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  userIdx: uniqueIndex("players_user_unique").on(t.userId),
  claimIdx: uniqueIndex("players_claim_unique").on(t.claimCode),
  geIdx: index("players_golf_england_idx").on(t.golfEnglandId),
}));

/** A golf course an event can be played on. Holes live in course_holes. */
export const courses = sqliteTable("courses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  club: text("club"),
  address: text("address"),
  city: text("city"),
  country: text("country").notNull().default("England"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  holesCount: integer("holes_count").notNull().default(18),
  parTotal: integer("par_total").notNull().default(72),
  /** [{ name, colour, slope, rating, par, yardage }] */
  tees: text("tees").notNull().default("[]"),
  source: text("source").notNull().default("MANUAL"), // MANUAL | CATALOGUE | GOLFCOURSEAPI | IMPORT
  externalId: text("external_id"),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  nameIdx: index("courses_name_idx").on(t.name),
}));

export const courseHoles = sqliteTable("course_holes", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull(),
  holeNumber: integer("hole_number").notNull(),
  par: integer("par").notNull(),
  strokeIndex: integer("stroke_index").notNull(),
  /** [{ tee: "White", yards: 412 }] */
  yardages: text("yardages").notNull().default("[]"),
}, (t) => ({
  courseHoleUnique: uniqueIndex("course_hole_unique").on(t.courseId, t.holeNumber),
}));

/** An event = one golf day / outing. */
export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  date: text("date").notNull(), // YYYY-MM-DD
  startTime: text("start_time").notNull().default("08:00"), // HH:MM (local to venue)
  courseId: text("course_id"),
  courseName: text("course_name"), // snapshot in case a course is deleted
  format: text("format").notNull().default("STABLEFORD"), // STABLEFORD | STROKE_PLAY | TEXAS_SCRAMBLE
  handicapAllowance: integer("handicap_allowance").notNull().default(95),
  status: text("status").notNull().default("DRAFT"), // DRAFT | OPEN | IN_PROGRESS | COMPLETED | CANCELLED
  maxPlayers: integer("max_players").notNull().default(72),
  joinCode: text("join_code").notNull(),
  isPublic: integer("is_public", { mode: "boolean" }).notNull().default(true),
  allowCourseClash: integer("allow_course_clash", { mode: "boolean" }).notNull().default(false),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  slugUnique: uniqueIndex("events_slug_unique").on(t.slug),
  dateIdx: index("events_date_idx").on(t.date),
}));

/**
 * Snapshot of the card used for the event. Editing the course later must not
 * change historical scores, so par/stroke index are copied here on creation.
 */
export const eventHoles = sqliteTable("event_holes", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  holeNumber: integer("hole_number").notNull(),
  par: integer("par").notNull(),
  strokeIndex: integer("stroke_index").notNull(),
}, (t) => ({
  eventHoleUnique: uniqueIndex("event_hole_unique").on(t.eventId, t.holeNumber),
}));

/** Who may administer (or simply score for) an event. */
export const eventAdmins = sqliteTable("event_admins", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("ADMIN"), // OWNER | ADMIN | SCORER
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  adminUnique: uniqueIndex("event_admin_unique").on(t.eventId, t.userId),
}));

/** A four-ball / tee group inside an event. */
export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  name: text("name").notNull(),
  teeTime: text("tee_time"),
  sortOrder: integer("sort_order").notNull().default(0),
  token: text("token").notNull(), // public scoring link token
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  tokenUnique: uniqueIndex("groups_token_unique").on(t.token),
}));

/** Registration of a player into an event (requirement 5: optional to play). */
export const eventPlayers = sqliteTable("event_players", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  playerId: text("player_id").notNull(),
  groupId: text("group_id"),
  status: text("status").notNull().default("REGISTERED"), // REGISTERED | WAITLIST | WITHDRAWN
  handicapIndex: real("handicap_index").notNull().default(0),
  courseHandicap: integer("course_handicap").notNull().default(0),
  playingHandicap: integer("playing_handicap").notNull().default(0),
  tee: text("tee").notNull().default("White"),
  joinedAt: text("joined_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  eventPlayerUnique: uniqueIndex("event_player_unique").on(t.eventId, t.playerId),
  groupIdx: index("event_player_group_idx").on(t.groupId),
}));

export const scores = sqliteTable("scores", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  playerId: text("player_id").notNull(),
  holeNumber: integer("hole_number").notNull(),
  strokes: integer("strokes").notNull(),
  points: integer("points").notNull().default(0),
  recordedBy: text("recorded_by"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  scoreUnique: uniqueIndex("score_unique").on(t.eventId, t.playerId, t.holeNumber),
}));

/** Every score edit is audited - handy when a card is disputed. */
export const scoreAudit = sqliteTable("score_audit", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  playerId: text("player_id").notNull(),
  holeNumber: integer("hole_number").notNull(),
  oldStrokes: integer("old_strokes"),
  newStrokes: integer("new_strokes").notNull(),
  changedBy: text("changed_by"),
  changedAt: text("changed_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  auditIdx: index("score_audit_event_idx").on(t.eventId),
}));

/**
 * Monotonic revision per event. Bumped on every write that could change the
 * leaderboard so the SSE stream can push updates with a tiny poll.
 */
export const eventState = sqliteTable("event_state", {
  eventId: text("event_id").primaryKey(),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
});

/**
 * Per-event game settings, kept in their own table so existing databases pick
 * them up with a plain CREATE TABLE (no column migrations).
 */
export const eventSettings = sqliteTable("event_settings", {
  eventId: text("event_id").primaryKey(),
  skins: text("skins").notNull().default("OFF"), // OFF | NET | GROSS
  skinsCarry: integer("skins_carry", { mode: "boolean" }).notNull().default(true),
  teamFormat: text("team_format").notNull().default("NONE"), // NONE | FOURBBB
  /** [{ kind: "NEAREST_PIN" | "LONGEST_DRIVE", holeNumber }] */
  sideHoles: text("side_holes").notNull().default("[]"),
  /** [{ name, url? }] shown as a strip on the leaderboard */
  sponsors: text("sponsors").notNull().default("[]"),
  /** ["Europe", "USA"] for team match play */
  teamNames: text("team_names").notNull().default('["Team A","Team B"]'),
  /** [{ id, name, sideA: [playerId], sideB: [playerId] }] */
  matches: text("matches").notNull().default("[]"),
  /** 0 = free; otherwise the entry fee in pence */
  entryFeePence: integer("entry_fee_pence").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
});

/** 4BBB pairs (two partners, better ball counts). */
export const eventPairs = sqliteTable("event_pairs", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  name: text("name").notNull(),
  playerA: text("player_a").notNull(),
  playerB: text("player_b").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => ({
  eventIdx: index("event_pairs_event_idx").on(t.eventId),
}));

/** Nearest-the-pin (feet) and longest-drive (yards) measurements. */
export const sideGameEntries = sqliteTable("side_game_entries", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  kind: text("kind").notNull(), // NEAREST_PIN | LONGEST_DRIVE
  holeNumber: integer("hole_number").notNull(),
  playerId: text("player_id").notNull(),
  distance: real("distance").notNull(),
  recordedBy: text("recorded_by"),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  entryUnique: uniqueIndex("side_game_entry_unique").on(t.eventId, t.kind, t.holeNumber, t.playerId),
}));

/** Entry-fee payments (Stripe Checkout or marked paid by an organiser). */
export const eventPayments = sqliteTable("event_payments", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  playerId: text("player_id").notNull(),
  status: text("status").notNull().default("PENDING"), // PENDING | PAID
  method: text("method").notNull().default("MANUAL"), // MANUAL | STRIPE
  amountPence: integer("amount_pence").notNull().default(0),
  stripeSessionId: text("stripe_session_id"),
  /** PaymentIntent id - what a refund is issued against. */
  stripePaymentIntent: text("stripe_payment_intent"),
  /** Running total of money given back, in pence. */
  refundedPence: integer("refunded_pence").notNull().default(0),
  refundedAt: text("refunded_at"),
  paidAt: text("paid_at"),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  paymentUnique: uniqueIndex("event_payment_unique").on(t.eventId, t.playerId),
}));


/** Texas scramble: one card per tee group (the team), not per player. */
export const scrambleScores = sqliteTable("scramble_scores", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  groupId: text("group_id").notNull(),
  holeNumber: integer("hole_number").notNull(),
  strokes: integer("strokes").notNull(),
  /** Whose tee shot the team used - drives each player must contribute. */
  drivePlayerId: text("drive_player_id"),
  recordedBy: text("recorded_by"),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  scoreUnique: uniqueIndex("scramble_score_unique").on(t.eventId, t.groupId, t.holeNumber),
  groupIdx: index("scramble_score_group_idx").on(t.eventId, t.groupId),
}));

export const scrambleAudit = sqliteTable("scramble_audit", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  groupId: text("group_id").notNull(),
  holeNumber: integer("hole_number").notNull(),
  oldStrokes: integer("old_strokes"),
  newStrokes: integer("new_strokes").notNull(),
  changedBy: text("changed_by"),
  changedAt: text("changed_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  auditIdx: index("scramble_audit_event_idx").on(t.eventId),
}));

/** The club that runs a set of golf days. */
export const societies = sqliteTable("societies", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  homeClub: text("home_club"),
  joinCode: text("join_code").notNull(),
  createdBy: text("created_by").notNull(),
  /** Where this club's handicaps come from: MANUAL | DIRECTORY | WHS | CDH. */
  handicapSource: text("handicap_source").notNull().default("DIRECTORY"),
  handicapCountry: text("handicap_country").notNull().default("eng"),
  handicapApiBase: text("handicap_api_base"),
  handicapApiUsername: text("handicap_api_username"),
  /** Sealed (AES-256-GCM) - never returned by the API, only written by an owner. */
  handicapApiSecret: text("handicap_api_secret"),
  handicapClientToken: text("handicap_client_token"),
  handicapUpdatedAt: text("handicap_updated_at"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  slugUnique: uniqueIndex("societies_slug_unique").on(t.slug),
  joinUnique: uniqueIndex("societies_join_unique").on(t.joinCode),
}));

export const societyMembers = sqliteTable("society_members", {
  id: text("id").primaryKey(),
  societyId: text("society_id").notNull(),
  playerId: text("player_id").notNull(),
  role: text("role").notNull().default("MEMBER"), // OWNER | SECRETARY | MEMBER
  status: text("status").notNull().default("ACTIVE"), // ACTIVE | INVITED
  joinedAt: text("joined_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  memberUnique: uniqueIndex("society_member_unique").on(t.societyId, t.playerId),
  playerIdx: index("society_member_player_idx").on(t.playerId),
}));

export const societyEvents = sqliteTable("society_events", {
  id: text("id").primaryKey(),
  societyId: text("society_id").notNull(),
  eventId: text("event_id").notNull(),
}, (t) => ({
  eventUnique: uniqueIndex("society_event_unique").on(t.eventId),
  societyIdx: index("society_event_society_idx").on(t.societyId),
}));

/** A season / order of merit: points from the fixtures attached to it. */
export const seasons = sqliteTable("seasons", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  societyId: text("society_id"),
  name: text("name").notNull(),
  startsOn: text("starts_on").notNull(),
  endsOn: text("ends_on").notNull(),
  /** POSITION (order of merit points) | STABLEFORD (sum of Stableford points) */
  scheme: text("scheme").notNull().default("POSITION"),
  /** 0 = every fixture counts; otherwise the best N results count. */
  bestOf: integer("best_of").notNull().default(0),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  slugUnique: uniqueIndex("seasons_slug_unique").on(t.slug),
  societyIdx: index("seasons_society_idx").on(t.societyId),
}));

export const seasonEvents = sqliteTable("season_events", {
  id: text("id").primaryKey(),
  seasonId: text("season_id").notNull(),
  eventId: text("event_id").notNull(),
}, (t) => ({
  eventUnique: uniqueIndex("season_event_unique").on(t.eventId),
  seasonIdx: index("season_event_season_idx").on(t.seasonId),
}));

/** Every refund against an entry fee (a payment can be refunded in parts). */
export const paymentRefunds = sqliteTable("payment_refunds", {
  id: text("id").primaryKey(),
  paymentId: text("payment_id").notNull(),
  eventId: text("event_id").notNull(),
  playerId: text("player_id").notNull(),
  amountPence: integer("amount_pence").notNull(),
  status: text("status").notNull().default("SUCCEEDED"), // SUCCEEDED | FAILED
  stripeRefundId: text("stripe_refund_id"),
  reason: text("reason"),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  paymentIdx: index("payment_refund_payment_idx").on(t.paymentId),
  eventIdx: index("payment_refund_event_idx").on(t.eventId),
}));

export type User = typeof users.$inferSelect;
export type Player = typeof players.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type CourseHole = typeof courseHoles.$inferSelect;
export type GolfEvent = typeof events.$inferSelect;
export type EventHole = typeof eventHoles.$inferSelect;
export type EventPlayer = typeof eventPlayers.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Score = typeof scores.$inferSelect;
export type ScrambleScore = typeof scrambleScores.$inferSelect;
export type Society = typeof societies.$inferSelect;
export type SocietyMember = typeof societyMembers.$inferSelect;
export type Season = typeof seasons.$inferSelect;
export type PaymentRefund = typeof paymentRefunds.$inferSelect;

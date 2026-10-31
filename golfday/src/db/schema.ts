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
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  emailUnique: uniqueIndex("users_email_unique").on(t.email),
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
  handicapSource: text("handicap_source").notNull().default("MANUAL"), // MANUAL | GOLF_ENGLAND | CSV | API
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
  format: text("format").notNull().default("STABLEFORD"), // STABLEFORD | STROKE_PLAY
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

export type User = typeof users.$inferSelect;
export type Player = typeof players.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type CourseHole = typeof courseHoles.$inferSelect;
export type GolfEvent = typeof events.$inferSelect;
export type EventHole = typeof eventHoles.$inferSelect;
export type EventPlayer = typeof eventPlayers.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Score = typeof scores.$inferSelect;

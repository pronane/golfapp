import { z } from "zod";
import { ApiError } from "./http";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const timeString = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM");

export const registerSchema = z.object({
  name: z.string().min(2, "Please tell us your name").max(80),
  email: z.string().email("That email doesn't look right"),
  password: z.string().min(8, "Use at least 8 characters"),
  handicapIndex: z.coerce.number().min(-10).max(54).optional(),
  golfEnglandId: z.string().max(30).optional(),
  homeClub: z.string().max(120).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const holeSchema = z.object({
  holeNumber: z.coerce.number().int().min(1).max(36),
  par: z.coerce.number().int().min(3).max(6),
  strokeIndex: z.coerce.number().int().min(1).max(18),
});

export const teeSchema = z.object({
  name: z.string().min(1).max(20),
  colour: z.string().max(20).optional(),
  slope: z.coerce.number().int().min(55).max(155).default(113),
  rating: z.coerce.number().min(55).max(80).default(72),
  par: z.coerce.number().int().min(60).max(80).default(72),
  yardage: z.coerce.number().int().min(1000).max(9000).optional(),
});

export const createCourseSchema = z.object({
  name: z.string().min(2).max(120),
  club: z.string().max(120).optional(),
  address: z.string().max(200).optional(),
  city: z.string().max(80).optional(),
  country: z.string().max(80).optional(),
  tees: z.array(teeSchema).max(6).optional(),
  holes: z.array(holeSchema).min(1).max(36),
  externalId: z.string().max(80).optional(),
  source: z.enum(["MANUAL", "CATALOGUE", "GOLFCOURSEAPI", "IMPORT"]).optional(),
});

export const newCourseSchema = z.object({
  name: z.string().min(2, "Give the course a name").max(120),
  club: z.string().max(120).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  country: z.string().max(80).optional().nullable(),
  tees: z.array(teeSchema).max(6).optional(),
  holes: z.array(holeSchema).min(9).max(36),
});

export const createEventSchema = z.object({
  name: z.string().min(2, "Give the golf day a name").max(120),
  description: z.string().max(600).optional(),
  date: dateString,
  startTime: timeString.default("08:00"),
  courseId: z.string().min(1).nullable().optional(),
  format: z.enum(["STABLEFORD", "STROKE_PLAY"]).default("STABLEFORD"),
  handicapAllowance: z.coerce.number().int().min(0).max(100).default(95),
  maxPlayers: z.coerce.number().int().min(1).max(200).default(72),
  status: z.enum(["DRAFT", "OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).default("DRAFT"),
  isPublic: z.boolean().default(true),
  holes: z.array(holeSchema).length(18).optional(),
  /** Course typed in with the event; saved to the library by the event's creator. */
  newCourse: newCourseSchema.optional(),
  /** Provider course to import and attach while creating the event. */
  importExternalId: z.string().max(80).optional(),
});

export const updateEventSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(600).nullable().optional(),
  date: dateString.optional(),
  startTime: timeString.optional(),
  courseId: z.string().nullable().optional(),
  format: z.enum(["STABLEFORD", "STROKE_PLAY"]).optional(),
  handicapAllowance: z.coerce.number().int().min(0).max(100).optional(),
  maxPlayers: z.coerce.number().int().min(1).max(200).optional(),
  status: z.enum(["DRAFT", "OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  isPublic: z.boolean().optional(),
  allowCourseClash: z.boolean().optional(),
});

export const registerPlayerSchema = z.object({
  playerId: z.string().min(1),
  groupId: z.string().min(1).nullable().optional(),
  tee: z.string().max(20).optional(),
  status: z.enum(["REGISTERED", "WAITLIST"]).optional(),
  force: z.boolean().optional(),
});

export const createPlayerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().optional().or(z.literal("")),
  handicapIndex: z.coerce.number().min(-10).max(54).default(0),
  golfEnglandId: z.string().max(30).optional(),
  homeClub: z.string().max(120).optional(),
  gender: z.enum(["M", "F", "X"]).optional(),
});

export const scoreSchema = z.object({
  eventId: z.string().min(1),
  playerId: z.string().min(1),
  holeNumber: z.coerce.number().int().min(1).max(36),
  strokes: z.coerce.number().int().min(1).max(20),
  token: z.string().max(40).optional(),
});

export function validate<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApiError(400, first?.message ?? "Invalid input", "validation_error", parsed.error.flatten());
  }
  return parsed.data;
}

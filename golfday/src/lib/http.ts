import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventAdmins, events } from "@/db/schema";
import { getCurrentUser, type SessionUser } from "./auth";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, message: string, code = "error", details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return Response.json({ error: err.message, code: err.code, details: err.details }, { status: err.status });
  }
  console.error("[api] unhandled error", err);
  return Response.json({ error: "Something went wrong" }, { status: 500 });
}

/** Wraps a route handler with consistent JSON error handling. */
export function route<T extends unknown[]>(fn: (...args: T) => Promise<Response>) {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "You need to sign in", "unauthenticated");
  return user;
}

export type EventAccess = {
  event: typeof events.$inferSelect;
  role: "OWNER" | "ADMIN" | "SCORER" | "SITE_ADMIN";
  isAdmin: boolean;
};

/**
 * Event-level authorisation. Site admins can do anything; otherwise the user
 * needs a row in event_admins. `isAdmin` is true for OWNER/ADMIN/SITE_ADMIN
 * (can edit the event and its course card); SCORERs can only enter scores.
 */
export async function requireEventAccess(eventId: string, user: SessionUser): Promise<EventAccess> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new ApiError(404, "Event not found", "not_found");
  if (user.isSiteAdmin) return { event, role: "SITE_ADMIN", isAdmin: true };
  const [admin] = await db
    .select()
    .from(eventAdmins)
    .where(and(eq(eventAdmins.eventId, eventId), eq(eventAdmins.userId, user.id)))
    .limit(1);
  if (!admin) throw new ApiError(403, "You are not an admin of this event", "forbidden");
  return { event, role: admin.role as EventAccess["role"], isAdmin: admin.role !== "SCORER" };
}

export async function getEventAccess(eventId: string, user: SessionUser | null): Promise<EventAccess | null> {
  if (!user) return null;
  try {
    return await requireEventAccess(eventId, user);
  } catch {
    return null;
  }
}

export async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError(400, "Invalid JSON body", "bad_request");
  }
}

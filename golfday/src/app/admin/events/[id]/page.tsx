import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getEventAccess } from "@/lib/http";
import { getEventBundle } from "@/lib/events";
import { EventConsole } from "@/components/EventConsole";
import { getSocietyRosterForEvent } from "@/lib/societies";

export const dynamic = "force-dynamic";

export default async function AdminEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/admin/events/${id}`);
  const access = await getEventAccess(id, user);
  const bundle = await getEventBundle(id);
  if (!bundle) notFound();
  const roster = await getSocietyRosterForEvent(id);
  if (!access) {
    return (
      <div className="card card-pad mx-auto max-w-lg text-center">
        <h1 className="text-xl font-bold">Not your event</h1>
        <p className="mt-2 text-[13.5px] text-ink/55">You need to be an admin of this golf day to manage it.</p>
        <Link href={`/events/${bundle.event.slug}`} className="btn-primary btn-sm mt-4">View the event</Link>
      </div>
    );
  }

  return (
    <EventConsole
      isOwner={access.role === "OWNER" || access.role === "SITE_ADMIN"}
      society={
        roster
          ? {
              name: roster.society.name,
              slug: roster.society.slug,
              joinCode: roster.society.joinCode,
              rosterSize: roster.members.length,
              missing: roster.missing.map((m) => ({ playerId: m.playerId, name: m.name })),
            }
          : null
      }
      event={{
        id: bundle.event.id,
        slug: bundle.event.slug,
        name: bundle.event.name,
        description: bundle.event.description,
        date: bundle.event.date,
        startTime: bundle.event.startTime,
        courseId: bundle.event.courseId,
        courseName: bundle.event.courseName,
        format: bundle.event.format,
        handicapAllowance: bundle.event.handicapAllowance,
        status: bundle.event.status,
        maxPlayers: bundle.event.maxPlayers,
        joinCode: bundle.event.joinCode,
        isPublic: bundle.event.isPublic,
      }}
      holes={bundle.holes.map((h) => ({ holeNumber: h.holeNumber, par: h.par, strokeIndex: h.strokeIndex }))}
      groups={bundle.groups.map((g) => ({ id: g.id, name: g.name, teeTime: g.teeTime, token: g.token }))}
      registrations={bundle.registrations.map(({ player, registration }) => ({
        player: {
          id: player.id,
          name: player.name,
          email: player.email,
          handicapIndex: player.handicapIndex,
          homeClub: player.homeClub,
          golfEnglandId: player.golfEnglandId,
          claimCode: player.claimCode,
          userId: player.userId,
        },
        registration: {
          id: registration.id,
          groupId: registration.groupId,
          tee: registration.tee,
          playingHandicap: registration.playingHandicap,
          courseHandicap: registration.courseHandicap,
          status: registration.status,
        },
      }))}
      admins={bundle.admins.map((a) => ({ id: a.id, userId: a.userId, name: a.name, email: a.email, role: a.role }))}
    />
  );
}

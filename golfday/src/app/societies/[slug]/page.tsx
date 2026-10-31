import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { canManageSociety, getMembership, getSocietyPage } from "@/lib/societies";
import { SocietyDashboard } from "@/components/SocietyDashboard";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getSocietyPage(slug);
  return { title: page ? `${page.society.name} | GolfDay` : "Society | GolfDay" };
}

export default async function SocietyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/societies/${slug}`);
  const page = await getSocietyPage(slug);
  if (!page) notFound();

  const membership = await getMembership(page.society.id, user);
  // The roster carries handicaps, so it is members-only (a site admin can look).
  if (!membership && !user.isSiteAdmin) notFound();

  const role = membership?.role ?? null;
  return (
    <SocietyDashboard
      society={{
        id: page.society.id,
        slug: page.society.slug,
        name: page.society.name,
        description: page.society.description,
        homeClub: page.society.homeClub,
        joinCode: page.society.joinCode,
      }}
      members={page.members}
      fixtures={page.fixtures.map((event) => ({
        id: event.id,
        slug: event.slug,
        name: event.name,
        date: event.date,
        status: event.status,
        format: event.format,
        courseName: event.courseName,
      }))}
      seasons={page.seasons.map((season) => ({
        id: season.id,
        slug: season.slug,
        name: season.name,
        startsOn: season.startsOn,
        endsOn: season.endsOn,
        scheme: season.scheme,
        bestOf: season.bestOf,
      }))}
      role={role}
      canManage={canManageSociety(user, role)}
      isMember={Boolean(membership) || user.isSiteAdmin}
    />
  );
}

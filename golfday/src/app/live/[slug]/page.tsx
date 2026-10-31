import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getEventBySlug } from "@/lib/events";
import { buildLeaderboard, canViewEventBoard } from "@/lib/leaderboard";
import { LiveLeaderboard } from "@/components/LiveLeaderboard";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  // Don't put a private golf day's name in the <title> of a page a stranger
  // reached by guessing the slug.
  const viewable = event ? await canViewEventBoard(event) : false;
  return {
    title: event && viewable ? `${event.name} - live leaderboard | GolfDay` : "Live leaderboard | GolfDay",
    description:
      event && viewable
        ? `Live Stableford leaderboard for ${event.name} at ${event.courseName ?? "the course"}.`
        : undefined,
  };
}

export default async function LivePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tv?: string }>;
}) {
  const { slug } = await params;
  const { tv } = await searchParams;
  const event = await getEventBySlug(slug);
  if (!event) notFound();
  // Private golf days are only watchable by their organisers.
  if (!(await canViewEventBoard(event))) notFound();
  const board = await buildLeaderboard(event.id);
  if (!board) notFound();
  return <LiveLeaderboard initial={board} tv={tv === "1"} />;
}

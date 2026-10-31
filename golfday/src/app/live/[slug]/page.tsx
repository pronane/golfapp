import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getEventBySlug } from "@/lib/events";
import { buildLeaderboard } from "@/lib/leaderboard";
import { LiveLeaderboard } from "@/components/LiveLeaderboard";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  return {
    title: event ? `${event.name} - live leaderboard | GolfDay` : "Live leaderboard | GolfDay",
    description: event ? `Live Stableford leaderboard for ${event.name} at ${event.courseName ?? "the course"}.` : undefined,
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
  const board = await buildLeaderboard(event.id);
  if (!board) notFound();
  return <LiveLeaderboard initial={board} tv={tv === "1"} />;
}

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getGroupScoreboard, buildLeaderboard } from "@/lib/leaderboard";
import { ScoreEntry } from "@/components/ScoreEntry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Live scorecard | GolfDay" };

export default async function ScorePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const board = await getGroupScoreboard(token);
  if (!board) notFound();
  const leaderboard = await buildLeaderboard(board.event.id);
  return <ScoreEntry initial={board} initialBoard={leaderboard} />;
}

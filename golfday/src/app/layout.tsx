import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { HydrationMarker } from "@/components/HydrationMarker";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "GolfDay - live scoring for golf days and outings",
  description:
    "Create a golf day, enter the players, hand out live scorecard links and watch the leaderboard update hole by hole.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en-GB">
      <body className="min-h-screen">
        <HydrationMarker />
        <Nav user={user} />
        <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:px-6">{children}</main>
        <footer className="no-print border-t border-ink/[0.07] py-8 text-center text-[13px] text-ink/45">
          GolfDay - stableford scoring, WHS handicaps and a live leaderboard for every golf day.
        </footer>
      </body>
    </html>
  );
}

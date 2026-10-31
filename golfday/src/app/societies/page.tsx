import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { listSocietiesForPlayer } from "@/lib/societies";
import { SocietiesHome } from "@/components/SocietiesHome";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Societies | GolfDay" };

export default async function SocietiesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/societies");
  const societies = user.playerId ? await listSocietiesForPlayer(user.playerId) : [];
  return <SocietiesHome societies={societies.map((s) => ({ id: s.id, slug: s.slug, name: s.name, homeClub: s.homeClub, role: s.role }))} />;
}

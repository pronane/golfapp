import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listSocietiesForPlayer } from "@/lib/societies";
import { NewEventWizard } from "@/components/NewEventWizard";

export const dynamic = "force-dynamic";

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ society?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/events/new");
  // Coming from a society page? The new golf day joins that fixture list.
  const { society } = await searchParams;
  // Otherwise offer the ones they run, and default to "just my friends".
  const societies = user.playerId
    ? (await listSocietiesForPlayer(user.playerId))
        .filter((s) => s.role === "OWNER" || s.role === "SECRETARY")
        .map((s) => ({ id: s.id, name: s.name }))
    : [];
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link href="/admin" className="text-[12.5px] font-semibold text-ink/50 hover:text-ink/80">← Organiser</Link>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Create a golf day</h1>
        <p className="mt-1 text-[14px] text-ink/55">Details, course and card. You can add players and groups next.</p>
      </div>
      <NewEventWizard societyId={society ?? null} societies={societies} />
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isOrganiser } from "@/lib/http";
import { listAllSeasons } from "@/lib/seasons";
import { SeasonsAdmin } from "@/components/SeasonsAdmin";

export const dynamic = "force-dynamic";

export default async function SeasonsAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/seasons");
  if (!(await isOrganiser(user))) redirect("/events");
  const seasons = await listAllSeasons(100);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin" className="text-[12.5px] font-semibold text-ink/50 hover:text-ink/80">← Organiser</Link>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Seasons</h1>
          <p className="mt-1 text-[14px] text-ink/55">
            A season adds up results across golf days into an order of merit. Societies keep their own seasons; a one-club
            competition can live here.
          </p>
        </div>
        <Link href="/societies" className="btn-secondary btn-sm">Societies</Link>
      </div>
      <SeasonsAdmin
        seasons={seasons.map((season) => ({
          id: season.id,
          slug: season.slug,
          name: season.name,
          startsOn: season.startsOn,
          endsOn: season.endsOn,
          scheme: season.scheme,
          bestOf: season.bestOf,
          societyId: season.societyId,
        }))}
      />
    </div>
  );
}

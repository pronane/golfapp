import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { formatEventDate, ordinal } from "@/lib/format";
import { getCurrentUser } from "@/lib/auth";
import { canManageSeason, getSeasonPage, isOutsideSeason } from "@/lib/seasons";
import { SeasonFixtures } from "@/components/SeasonFixtures";
import { getSocietyById } from "@/lib/societies";
import { Trophy } from "@/components/Icons";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getSeasonPage(slug);
  return { title: page ? `${page.season.name} · Order of merit | GolfDay` : "Order of merit | GolfDay" };
}

/**
 * A season's order of merit. Public: clubs put this on the noticeboard, and the
 * page only shows names and golf results.
 */
export default async function SeasonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getSeasonPage(slug);
  if (!page) notFound();
  const { season, fixtures, table } = page;
  const society = season.societyId ? await getSocietyById(season.societyId) : null;
  const user = await getCurrentUser();
  const canManage = await canManageSeason(user, season);

  const schemeLabel = season.scheme === "STABLEFORD" ? "Stableford points" : "Order of merit points";

  return (
    <div className="space-y-5">
      <header className="hero overflow-hidden rounded-2xl shadow-card ring-1 ring-inset ring-fairway-200/70">
        <div className="px-5 py-6 sm:px-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] hero-muted">
                {society ? (
                  <Link href={`/societies/${society.slug}`} className="hover:text-fairway-700">
                    {society.name}
                  </Link>
                ) : (
                  "Season"
                )}{" "}
                · Order of merit
              </div>
              <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{season.name}</h1>
              <p className="mt-1 text-[13px] hero-muted">
                {formatEventDate(season.startsOn)} – {formatEventDate(season.endsOn)} · {fixtures.length} fixture
                {fixtures.length === 1 ? "" : "s"} · {schemeLabel}
                {season.bestOf > 0 ? ` · best ${season.bestOf} results count` : ""}
              </p>
            </div>
            <div className="rounded-xl bg-white/60 px-4 py-3 text-right ring-1 ring-inset ring-fairway-200/70">
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-fairway-700/60">Leader</div>
              <div className="text-[17px] font-extrabold">{table.rows[0]?.playerName ?? "–"}</div>
              <div className="text-[12px] hero-muted">{table.rows[0] ? `${table.rows[0].points} pts` : "No results yet"}</div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-fairway-200/60 bg-white/40 px-5 py-2.5 text-[12px] hero-muted sm:px-7">
          <span>{table.fixtures} fixture{table.fixtures === 1 ? "" : "s"} scored</span>
          <span className="text-fairway-800/25">|</span>
          <span>{table.rows.length} player{table.rows.length === 1 ? "" : "s"} on the table</span>
        </div>
      </header>

      <section className="card overflow-x-auto">
        <table className="table-base min-w-[760px]">
          <thead>
            <tr>
              <th className="w-14">Pos</th>
              <th>Player</th>
              <th className="text-center">Played</th>
              <th className="text-center">Counted</th>
              <th className="text-center">Wins</th>
              {fixtures.map((fixture) => (
                <th key={fixture.id} className="text-center" title={fixture.name}>
                  <Link href={`/events/${fixture.slug}`} className="hover:text-fairway-800">
                    {formatEventDate(fixture.date)}
                  </Link>
                </th>
              ))}
              <th className="text-right">Points</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.playerId} className={row.position <= 3 ? "bg-sand-50/60" : ""}>
                <td className="font-mono text-[13px] font-bold text-ink/70">
                  {ordinal(row.position)}
                  {row.position === 1 && <Trophy className="ml-1 inline h-3.5 w-3.5 text-sand-500" />}
                </td>
                <td>
                  <div className="font-semibold">{row.playerName}</div>
                  <div className="text-[11.5px] text-ink/45">
                    {row.played} played · best finish {row.bestFinish ? ordinal(row.bestFinish) : "–"}
                  </div>
                </td>
                <td className="text-center font-mono text-[13px]">{row.played}</td>
                <td className="text-center font-mono text-[13px] text-ink/60">{row.counting}</td>
                <td className="text-center font-mono text-[13px]">{row.wins}</td>
                {fixtures.map((fixture) => {
                  const result = row.results.find((r) => r.eventId === fixture.id);
                  return (
                    <td key={fixture.id} className="text-center">
                      {result ? (
                        <span
                          className={`inline-flex flex-col rounded-lg px-1.5 py-0.5 text-[11px] ${
                            result.counted ? "bg-fairway-50 text-fairway-900" : "text-ink/35 line-through"
                          }`}
                          title={`${fixture.name}${result.team && result.teamName ? ` (${result.teamName})` : ""}`}
                        >
                          <span className="font-semibold">{ordinal(result.position)}</span>
                          <span className="font-mono">{result.points} pts</span>
                        </span>
                      ) : (
                        <span className="text-ink/20">–</span>
                      )}
                    </td>
                  );
                })}
                <td className="text-right font-mono text-[15px] font-extrabold">{row.points}</td>
              </tr>
            ))}
            {table.rows.length === 0 && (
              <tr>
                <td colSpan={6 + fixtures.length} className="px-5 py-8 text-center text-[13px] text-ink/50">
                  No results in this season yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {season.bestOf > 0 && (
          <p className="border-t border-ink/[0.06] px-5 py-2.5 text-[12px] text-ink/45">
            Struck-through results are the ones dropped under the best-{season.bestOf} rule.
          </p>
        )}
      </section>

      <SeasonFixtures
        seasonId={season.id}
        canManage={canManage}
        fixtures={fixtures.map((fixture) => ({
          id: fixture.id,
          slug: fixture.slug,
          name: fixture.name,
          date: fixture.date,
          courseName: fixture.courseName,
          status: fixture.status,
          outside: isOutsideSeason(season, fixture.date),
        }))}
      />
    </div>
  );
}

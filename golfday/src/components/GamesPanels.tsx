import type { GamesPayload } from "@/lib/games";
import { formatDistance } from "@/lib/sidegames";

const half = (n: number) => {
  const whole = Math.floor(n);
  const frac = n - whole;
  if (frac === 0) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
};

/** Side games and team games under the main leaderboard. Renders nothing if none are on. */
export function GamesPanels({ games, tv = false }: { games: GamesPayload | undefined; tv?: boolean }) {
  if (!games) return null;
  const { skins, pairs, sideGames, matchPlay } = games;
  if (!skins && !pairs && sideGames.length === 0 && !matchPlay) return null;

  const card = tv ? "rounded-2xl bg-white/[0.06] p-5 ring-1 ring-inset ring-white/10" : "card card-pad";
  const muted = tv ? "text-white/60" : "text-ink/60";
  const row = tv ? "rounded-xl bg-white/[0.05] px-3 py-2" : "rounded-xl bg-ink/[0.03] px-3 py-2";

  return (
    <div className={tv ? "space-y-4" : "grid gap-4 sm:grid-cols-2"}>
      {matchPlay && (
        <section className={`${card} ${tv ? "" : "sm:col-span-2"}`} aria-labelledby="mp-title">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="mp-title" className="text-[15px] font-bold">Match play</h2>
            <p className={`text-[12px] ${muted}`}>{half(matchPlay.toWin)} points wins</p>
          </div>
          <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
            <div>
              <div className={`text-[12px] font-semibold uppercase tracking-wide ${muted}`}>{matchPlay.teamNames[0]}</div>
              <div className="font-mono text-4xl font-extrabold text-sky-600">{half(matchPlay.banked.A)}</div>
              <div className={`text-[11.5px] ${muted}`}>projected {half(matchPlay.projected.A)}</div>
            </div>
            <span className={`text-[13px] ${muted}`}>v</span>
            <div>
              <div className={`text-[12px] font-semibold uppercase tracking-wide ${muted}`}>{matchPlay.teamNames[1]}</div>
              <div className="font-mono text-4xl font-extrabold text-rose-600">{half(matchPlay.banked.B)}</div>
              <div className={`text-[11.5px] ${muted}`}>projected {half(matchPlay.projected.B)}</div>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5">
            {matchPlay.matches.map((m) => {
              const tone =
                m.leading === "A" ? "text-sky-700" : m.leading === "B" ? "text-rose-700" : tv ? "text-white/80" : "text-ink/70";
              return (
                <li key={m.id} className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[13px] ${row}`}>
                  <span className={`truncate text-left ${m.leading === "A" ? "font-bold" : ""}`}>{m.sideA.join(" & ")}</span>
                  <span className={`min-w-[6.5rem] text-center font-mono text-[12px] font-bold ${tone}`}>
                    {m.finished && m.winner !== "HALVED"
                      ? `${m.winner === "A" ? "◀" : ""} ${m.status} ${m.winner === "B" ? "▶" : ""}`
                      : m.status}
                  </span>
                  <span className={`truncate text-right ${m.leading === "B" ? "font-bold" : ""}`}>{m.sideB.join(" & ")}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {pairs && (
        <section className={card} aria-labelledby="pairs-title">
          <h2 id="pairs-title" className="text-[15px] font-bold">Better-ball pairs</h2>
          <p className={`text-[12.5px] ${muted}`}>Best Stableford score of the two on each hole.</p>
          <ol className="mt-3 space-y-1.5">
            {pairs.slice(0, tv ? 6 : 10).map((p) => (
              <li key={p.pairId} className={`flex items-center gap-3 ${row}`}>
                <span className={`w-7 text-center font-mono text-[12px] font-bold ${muted}`}>
                  {p.thru === 0 ? "–" : p.tied ? `T${p.position}` : p.position}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">{p.players.join(" & ")}</div>
                  <div className={`truncate text-[11.5px] ${muted}`}>{p.name} · thru {p.thru}</div>
                </div>
                <span className="font-mono text-[15px] font-extrabold">{p.points}</span>
              </li>
            ))}
            {pairs.length === 0 && <li className={`text-[13px] ${muted}`}>The organiser hasn&apos;t set the pairs yet.</li>}
          </ol>
        </section>
      )}

      {skins && (
        <section className={card} aria-labelledby="skins-title">
          <h2 id="skins-title" className="text-[15px] font-bold">
            {games.settings.skins === "NET" ? "Net skins" : "Gross skins"}
          </h2>
          <p className={`text-[12.5px] ${muted}`}>
            {skins.carryingOver > 0
              ? `${skins.carryingOver} skin${skins.carryingOver === 1 ? "" : "s"} riding on the next hole`
              : "Outright lowest score wins the hole."}
          </p>
          <ul className="mt-3 space-y-1.5">
            {skins.totals.map((t) => (
              <li key={t.playerId} className={`flex items-center justify-between text-[13.5px] ${row}`}>
                <span className="font-semibold">{t.playerName}</span>
                <span className="font-mono font-extrabold">{t.skins}</span>
              </li>
            ))}
            {skins.totals.length === 0 && <li className={`text-[13px] ${muted}`}>No skins won yet.</li>}
          </ul>
          {!tv && (
            <div className="mt-3 flex flex-wrap gap-1" aria-label="Skins by hole">
              {skins.holes.map((h) => (
                <span
                  key={h.holeNumber}
                  title={h.status === "won" ? `Hole ${h.holeNumber}: ${h.winnerName} (${h.value})` : `Hole ${h.holeNumber}: ${h.status}`}
                  className={`inline-grid h-7 w-7 place-items-center rounded font-mono text-[11px] font-semibold ${
                    h.status === "won" ? "bg-emerald-100 text-emerald-800" : h.status === "carried" ? "bg-amber-100 text-amber-800" : "bg-ink/[0.04] text-ink/50"
                  }`}
                >
                  {h.holeNumber}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {sideGames.length > 0 && (
        <section className={card} aria-labelledby="side-title">
          <h2 id="side-title" className="text-[15px] font-bold">Nearest the pin &amp; longest drive</h2>
          <ul className="mt-3 space-y-1.5">
            {sideGames.map((g) => (
              <li key={`${g.kind}-${g.holeNumber}`} className={`flex items-center justify-between gap-3 text-[13px] ${row}`}>
                <span className={muted}>{g.label}</span>
                {g.leader ? (
                  <span className="text-right">
                    <span className="font-semibold">{g.leader.playerName}</span>{" "}
                    <span className="font-mono">{formatDistance(g.kind, g.leader.distance)}</span>
                  </span>
                ) : (
                  <span className={muted}>no one yet</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Sponsor names along the board; links only to plain http(s) URLs (validated on save). */
export function SponsorStrip({ games, tv = false }: { games: GamesPayload | undefined; tv?: boolean }) {
  const sponsors = games?.settings.sponsors ?? [];
  if (sponsors.length === 0) return null;
  return (
    <aside
      aria-label="Sponsors"
      className={`flex flex-wrap items-center justify-center gap-x-6 gap-y-2 ${tv ? "text-[18px] text-white/80" : "rounded-2xl bg-sand-50 px-4 py-3 text-[13px] text-ink/70 ring-1 ring-inset ring-sand-200"}`}
    >
      <span className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${tv ? "text-white/50" : "text-ink/50"}`}>With thanks to</span>
      {sponsors.map((s, i) =>
        s.url && !tv ? (
          <a key={`${s.name}-${i}`} href={s.url} target="_blank" rel="noopener noreferrer sponsored" className="font-semibold hover:underline">
            {s.name}
          </a>
        ) : (
          <span key={`${s.name}-${i}`} className="font-semibold">{s.name}</span>
        ),
      )}
    </aside>
  );
}

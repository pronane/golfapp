"use client";

export type CardHole = { holeNumber: number; par: number; strokeIndex: number };

export const BLANK_CARD: CardHole[] = Array.from({ length: 18 }, (_, i) => ({
  holeNumber: i + 1,
  par: 4,
  strokeIndex: i + 1,
}));

export function CourseCardEditor({
  holes,
  onChange,
  disabled,
}: {
  holes: CardHole[];
  onChange: (holes: CardHole[]) => void;
  disabled?: boolean;
}) {
  const update = (holeNumber: number, patch: Partial<CardHole>) =>
    onChange(holes.map((h) => (h.holeNumber === holeNumber ? { ...h, ...patch } : h)));

  const parTotal = holes.reduce((sum, h) => sum + h.par, 0);
  const siValues = holes.map((h) => h.strokeIndex);
  const duplicateSi = new Set(siValues.filter((v, i) => siValues.indexOf(v) !== i)).size > 0;

  const front = holes.filter((h) => h.holeNumber <= 9);
  const back = holes.filter((h) => h.holeNumber > 9);

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          { title: "Holes 1-9", rows: front },
          { title: "Holes 10-18", rows: back },
        ].map((section) => (
          <div key={section.title} className="overflow-hidden rounded-xl ring-1 ring-inset ring-ink/10">
            <div className="flex items-center justify-between bg-ink/[0.04] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink/50">
              <span>{section.title}</span>
              <span>Par {section.rows.reduce((s, h) => s + h.par, 0)}</span>
            </div>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wide text-ink/40">
                  <th className="px-2 py-1 text-left font-semibold">Hole</th>
                  <th className="px-2 py-1 text-center font-semibold">Par</th>
                  <th className="px-2 py-1 text-center font-semibold">Stroke index</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((hole) => (
                  <tr key={hole.holeNumber} className="border-t border-ink/[0.06]">
                    <td className="px-2 py-1 font-semibold text-ink/60">{hole.holeNumber}</td>
                    <td className="px-1 py-0.5 text-center">
                      <select
                        className="w-16 rounded-md border-0 bg-ink/[0.03] px-1.5 py-1 text-center text-[12.5px] font-medium ring-1 ring-inset ring-ink/10 focus:ring-2 focus:ring-fairway-500"
                        value={hole.par}
                        disabled={disabled}
                        onChange={(e) => update(hole.holeNumber, { par: Number(e.target.value) })}
                      >
                        {[3, 4, 5, 6].map((par) => <option key={par} value={par}>{par}</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-0.5 text-center">
                      <select
                        className="w-16 rounded-md border-0 bg-ink/[0.03] px-1.5 py-1 text-center text-[12.5px] font-medium ring-1 ring-inset ring-ink/10 focus:ring-2 focus:ring-fairway-500"
                        value={hole.strokeIndex}
                        disabled={disabled}
                        onChange={(e) => update(hole.holeNumber, { strokeIndex: Number(e.target.value) })}
                      >
                        {Array.from({ length: 18 }, (_, i) => i + 1).map((si) => <option key={si} value={si}>{si}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[12px]">
        <span className="pill bg-fairway-50 text-fairway-700 ring-fairway-200">Par {parTotal}</span>
        {duplicateSi && <span className="pill bg-amber-50 text-amber-700 ring-amber-200">Stroke indexes repeat</span>}
        <span className="text-ink/45">Each hole needs a unique stroke index between 1 and 18.</span>
      </div>
    </div>
  );
}

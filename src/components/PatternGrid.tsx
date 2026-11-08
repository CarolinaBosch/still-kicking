"use client";

// 14-day pattern grid: the seeded and new check-ins laid out so the trend the Daytona engine
// flags is visible at a glance (e.g. swelling + missed diuretic + weight climbing).
import type { CheckinRecord, StopAndWatch } from "@/lib/types";

const SW_LABEL: Record<keyof StopAndWatch, string> = {
  seems_different: "Seems different",
  talks_less: "Talks less",
  needs_more_help: "Needs more help",
  ate_less: "Ate less",
  bowel_change: "Bowel change",
  drank_less: "Drank less",
  weight_or_swelling: "Weight / swelling",
  agitated: "Agitated",
  tired_weak_confused: "Tired, weak, confused",
  skin_change: "Skin change",
  walking_toileting_help: "Walking / toileting help",
};

type Cell = "pos" | "neg" | "na";
interface Row {
  label: string;
  cells: Cell[];
  kind: "symptom" | "meds";
}

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "narrow" });
}

export function PatternGrid({ history }: { history: CheckinRecord[] }) {
  const days = history.slice(-14);
  if (days.length === 0) return null;

  const rows: Row[] = [];
  const meds: Cell[] = days.map((r) =>
    r.medication_adherence.all_taken === false || r.medication_adherence.missed.length > 0
      ? "pos"
      : r.medication_adherence.all_taken === true
        ? "neg"
        : "na",
  );
  if (meds.includes("pos")) rows.push({ label: "Missed medication", cells: meds, kind: "meds" });

  const orientation: Cell[] = days.map((r) => (r.orientation_correct === false ? "pos" : r.orientation_correct ? "neg" : "na"));
  if (orientation.includes("pos")) rows.push({ label: "Wrong day of week", cells: orientation, kind: "symptom" });

  for (const key of Object.keys(SW_LABEL) as (keyof StopAndWatch)[]) {
    const cells: Cell[] = days.map((r) => (r.stop_and_watch[key] === true ? "pos" : r.stop_and_watch[key] === false ? "neg" : "na"));
    if (cells.includes("pos")) rows.push({ label: SW_LABEL[key], cells, kind: "symptom" });
  }

  const weights = days.map((r) => r.weight_lb);
  const known = weights.filter((w): w is number => typeof w === "number");
  const missedNames = [...new Set(days.flatMap((r) => r.medication_adherence.missed.map((m) => m.med)))];

  return (
    <div className="panel">
      <div className="summary-head">
        <h3 className="eyebrow">Last {days.length} check-ins: patterns</h3>
        <span className="text-faint grid-legend">
          <span className="pg-cell pg-pos" aria-hidden /> reported
          <span className="pg-cell pg-meds" aria-hidden /> missed dose
          <span className="pg-cell pg-neg" aria-hidden /> fine
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted">Steady: no Stop and Watch changes and every dose taken in the last {days.length} days.</p>
      ) : (
        <div className="pg-wrap" role="table" aria-label="Daily check-in findings">
          <div className="pg-row pg-head" role="row">
            <span className="pg-label" role="columnheader">
              Day
            </span>
            {days.map((r) => (
              <span key={r.call_id} className="pg-day" role="columnheader" title={new Date(r.timestamp).toLocaleDateString()}>
                {dayLabel(r.timestamp)}
              </span>
            ))}
          </div>
          {rows.map((row) => (
            <div key={row.label} className="pg-row" role="row">
              <span className="pg-label" role="rowheader">
                {row.label}
              </span>
              {row.cells.map((c, i) => (
                <span
                  key={i}
                  role="cell"
                  aria-label={c === "pos" ? "yes" : c === "neg" ? "no" : "not asked"}
                  className={`pg-cell ${c === "pos" ? (row.kind === "meds" ? "pg-meds" : "pg-pos") : c === "neg" ? "pg-neg" : "pg-na"}`}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      {known.length >= 2 && <WeightLine weights={weights} />}
      {missedNames.length > 0 && <p className="text-muted pg-note">Missed: {missedNames.join(", ")}. The engine checks whether a skipped dose explains the symptoms.</p>}
    </div>
  );
}

function WeightLine({ weights }: { weights: (number | null)[] }) {
  const pts = weights.map((w, i) => ({ w, i })).filter((p): p is { w: number; i: number } => typeof p.w === "number");
  const min = Math.min(...pts.map((p) => p.w));
  const max = Math.max(...pts.map((p) => p.w));
  const span = Math.max(1, max - min);
  const W = 100;
  const H = 28;
  const x = (i: number) => (weights.length === 1 ? W / 2 : (i / (weights.length - 1)) * W);
  const y = (w: number) => H - 3 - ((w - min) / span) * (H - 6);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.w).toFixed(1)}`).join(" ");
  const first = pts[0].w;
  const last = pts[pts.length - 1].w;
  const delta = last - first;
  const rising = delta >= 3;
  return (
    <div className="pg-weight">
      <span className="pg-label">Weight</span>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="pg-spark" role="img" aria-label={`Weight from ${first} to ${last} pounds`}>
        <path d={d} fill="none" stroke={rising ? "var(--red)" : "var(--accent)"} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className={`pg-delta ${rising ? "pg-delta-up" : ""}`}>
        {last} lb ({delta >= 0 ? "+" : ""}
        {delta.toFixed(1)})
      </span>
    </div>
  );
}

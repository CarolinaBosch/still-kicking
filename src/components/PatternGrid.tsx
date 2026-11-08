import type { CheckinRecord, PatientState, StopAndWatch } from "@/lib/types";

const DAYS = 14;

const SW_LABEL: Record<keyof StopAndWatch, string> = {
  seems_different: "Seems different",
  talks_less: "Talks less",
  needs_more_help: "Needs more help",
  ate_less: "Ate less",
  bowel_change: "Bowel change",
  drank_less: "Drank less",
  weight_or_swelling: "Weight gain / swelling",
  agitated: "Agitated",
  tired_weak_confused: "Tired, weak or confused",
  skin_change: "Skin change",
  walking_toileting_help: "Help walking / toileting",
};

type Cell = { kind: "none" } | { kind: "ok" } | { kind: "hit"; detail: string };

interface Day {
  key: string;
  date: Date;
  records: CheckinRecord[];
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function buildDays(history: CheckinRecord[]): Day[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: Day[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push({ key: dayKey(d), date: d, records: [] });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const r of history) {
    const t = new Date(r.timestamp);
    if (Number.isNaN(t.getTime())) continue;
    byKey.get(dayKey(t))?.records.push(r);
  }
  return days;
}

function missedMeds(r: CheckinRecord): string[] {
  const names = r.medication_adherence.missed.map((m) => m.med).filter(Boolean);
  if (names.length === 0 && r.medication_adherence.all_taken === false) return ["a dose"];
  return names;
}

function weightOf(r: CheckinRecord, baseline: number | null): number | null {
  if (typeof r.weight_lb === "number") return r.weight_lb;
  const gain = r.condition_specific.weight_gain_lb;
  if (typeof gain === "number" && baseline !== null) return baseline + gain;
  return null;
}

const dayLabel = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

export function PatternGrid({ state }: { state: PatientState }) {
  const days = buildDays(state.history);
  const inWindow = days.flatMap((d) => d.records);

  const swKeys = (Object.keys(SW_LABEL) as (keyof StopAndWatch)[]).filter((k) =>
    inWindow.some((r) => r.stop_and_watch[k] === true),
  );

  const rows: { label: string; med?: boolean; cell: (rs: CheckinRecord[]) => Cell }[] = [
    {
      label: "Missed medication",
      med: true,
      cell: (rs) => {
        const meds = [...new Set(rs.flatMap(missedMeds))];
        return meds.length ? { kind: "hit", detail: `missed ${meds.join(", ")}` } : { kind: "ok" };
      },
    },
    ...swKeys.map((k) => ({
      label: SW_LABEL[k],
      cell: (rs: CheckinRecord[]): Cell =>
        rs.some((r) => r.stop_and_watch[k] === true) ? { kind: "hit", detail: "yes" } : { kind: "ok" },
    })),
    {
      label: "Wrong day of week",
      cell: (rs) =>
        rs.some((r) => r.orientation_correct === false) ? { kind: "hit", detail: "did not know the day" } : { kind: "ok" },
    },
  ];

  const baseline = state.patient.baseline.weight_lb;
  const weights = days.map((d) => {
    const ws = d.records.map((r) => weightOf(r, baseline)).filter((w): w is number => w !== null);
    return ws.length ? ws[ws.length - 1] : null;
  });

  return (
    <div className="panel">
      <h3 className="eyebrow">14-day pattern</h3>
      <div className="pg-wrap">
        <table className="pg">
          <caption className="sr-only">
            Check-in findings for each of the last {DAYS} days. Columns are days, oldest first.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="pg-rowhead">
                <span className="sr-only">Finding</span>
              </th>
              {days.map((d, i) => (
                <th
                  key={d.key}
                  scope="col"
                  className={`pg-day ${i === DAYS - 1 ? "pg-today" : ""}`}
                  title={i === DAYS - 1 ? `Today, ${dayLabel(d.date)}` : dayLabel(d.date)}
                  aria-label={i === DAYS - 1 ? `Today, ${dayLabel(d.date)}` : dayLabel(d.date)}
                >
                  {d.date.getDate()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="pg-rowhead">
                  {row.label}
                </th>
                {days.map((d) => {
                  const c: Cell = d.records.length === 0 ? { kind: "none" } : row.cell(d.records);
                  const when = dayLabel(d.date);
                  const text =
                    c.kind === "none"
                      ? `${when}: no call`
                      : c.kind === "ok"
                        ? `${when}: ${row.label}, no`
                        : `${when}: ${row.label}, ${c.detail}`;
                  return (
                    <td key={d.key} className={`pg-cell pg-${c.kind} ${c.kind === "hit" && row.med ? "pg-med" : ""}`} title={text}>
                      <span aria-label={text} role="img">
                        {c.kind === "hit" ? (row.med ? "✕" : "●") : c.kind === "ok" ? "·" : ""}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
            <WeightRow weights={weights} />
          </tbody>
        </table>
      </div>
      <p className="pg-legend">
        <span>
          <span className="pg-key pg-hit pg-med" aria-hidden>✕</span> Missed medication
        </span>
        <span>
          <span className="pg-key pg-hit" aria-hidden>●</span> Reported
        </span>
        <span>
          <span className="pg-key pg-ok" aria-hidden>·</span> Asked, fine
        </span>
        <span>
          <span className="pg-key pg-none" aria-hidden /> No call
        </span>
      </p>
    </div>
  );
}

function WeightRow({ weights }: { weights: (number | null)[] }) {
  const pts = weights.map((w, i) => (w === null ? null : { x: i + 0.5, w }));
  const known = pts.filter((p): p is { x: number; w: number } => p !== null);
  if (known.length < 2) {
    return (
      <tr>
        <th scope="row" className="pg-rowhead">
          Weight
        </th>
        <td colSpan={DAYS} className="pg-weight-empty text-muted">
          Not enough weights recorded.
        </td>
      </tr>
    );
  }
  const first = known[0].w;
  const last = known[known.length - 1].w;
  const delta = Math.round((last - first) * 10) / 10;
  const min = Math.min(...known.map((p) => p.w));
  const max = Math.max(...known.map((p) => p.w));
  const span = Math.max(max - min, 2);
  const y = (w: number) => 9 - ((w - min) / span) * 8; // viewBox height 10, 1 unit padding
  const line = known.map((p) => `${p.x},${y(p.w)}`).join(" ");
  const sign = delta > 0 ? "+" : "";
  const rising = delta >= 2;
  const summary = `Weight ${first} to ${last} lb over the window (${sign}${delta} lb)`;

  return (
    <tr className="pg-weight">
      <th scope="row" className="pg-rowhead">
        Weight{" "}
        <span className={`pg-delta ${rising ? "pg-delta-up" : ""}`}>
          {sign}
          {delta} lb
        </span>
      </th>
      <td colSpan={DAYS} className="pg-spark-cell">
        <svg className="pg-spark" viewBox={`0 0 ${DAYS} 10`} preserveAspectRatio="none" role="img" aria-label={summary}>
          <title>{summary}</title>
          <polyline points={line} fill="none" className={rising ? "pg-spark-up" : "pg-spark-flat"} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="pg-spark-range text-muted" aria-hidden>
          {first} &rarr; {last} lb
        </span>
      </td>
    </tr>
  );
}

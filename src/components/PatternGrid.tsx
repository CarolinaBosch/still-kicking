import type { CSSProperties } from "react";
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

/** none = no call that day; na = call happened but the item was not asked / unclear. */
type CellKind = "none" | "na" | "ok" | "hit";
type Cell = { kind: CellKind; detail?: string };

interface Day {
  key: string;
  date: Date;
  records: CheckinRecord[];
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 14 days ending today if there is a call today, otherwise ending yesterday (today's call has not happened yet). */
function buildDays(history: CheckinRecord[]): Day[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const calledToday = history.some((r) => {
    const t = new Date(r.timestamp);
    return !Number.isNaN(t.getTime()) && dayKey(t) === dayKey(today);
  });
  const end = new Date(today);
  if (!calledToday) end.setDate(end.getDate() - 1);
  const days: Day[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
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

const MON = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });
const short = (d: Date) => `${MON(d)} ${d.getDate()}`;
const dayLabel = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const fmtLb = (w: number) => `${Math.round(w * 10) / 10}`;

/** Sorted day indices grouped into runs of consecutive calendar days. */
function runsOf(idx: number[]): number[][] {
  const runs: number[][] = [];
  for (const i of [...idx].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i);
    else runs.push([i]);
  }
  return runs;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "Nov 2", "Nov 2 and Nov 4", "Oct 30–Nov 1" */
function datesText(days: Day[], idx: number[]): string {
  return joinList(
    runsOf(idx).map((run) => {
      const a = days[run[0]].date;
      const b = days[run[run.length - 1]].date;
      if (run.length === 1) return short(a);
      if (a.getMonth() === b.getMonth()) return `${short(a)}–${b.getDate()}`;
      return `${short(a)}–${short(b)}`;
    }),
  );
}

const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen"];
const num = (k: number) => NUM[k] ?? String(k);

/** "on three consecutive days (Nov 5–7)" / "on Nov 3" / "on two days (Nov 3 and Nov 5)" */
function whenText(days: Day[], idx: number[]): string {
  const dates = datesText(days, idx);
  if (idx.length === 1) return `on ${dates}`;
  const runs = runsOf(idx);
  if (runs.length === 1) return `on ${num(idx.length)} consecutive days (${dates})`;
  const longest = Math.max(...runs.map((r) => r.length));
  const extra = longest >= 2 ? `, up to ${num(longest)} in a row` : "";
  return `on ${num(idx.length)} days${extra} (${dates})`;
}

/** Group item names that share exactly the same days, so the summary stays short. */
function groupByDays(entries: { name: string; idx: number[] }[]): { names: string[]; idx: number[] }[] {
  const groups = new Map<string, { names: string[]; idx: number[] }>();
  for (const e of entries) {
    const k = e.idx.join(",");
    const g = groups.get(k);
    if (g) g.names.push(e.name);
    else groups.set(k, { names: [e.name], idx: e.idx });
  }
  return [...groups.values()];
}

/** Factual, cause-free summary built only from the records in the window. */
function buildSummary(
  days: Day[],
  swKeys: (keyof StopAndWatch)[],
  weights: (number | null)[],
): { lines: string[]; quiet: boolean } {
  const lines: string[] = [];

  const meds = new Map<string, number[]>();
  days.forEach((d, i) => {
    for (const m of new Set(d.records.flatMap(missedMeds))) meds.set(m, [...(meds.get(m) ?? []), i]);
  });
  const medGroups = groupByDays([...meds].map(([name, idx]) => ({ name, idx })));
  if (medGroups.length) {
    lines.push(`Medication missed: ${medGroups.map((g) => `${joinList(g.names)} ${whenText(days, g.idx)}`).join("; ")}.`);
  }

  const concerns = swKeys.map((k) => ({
    name: SW_LABEL[k].toLowerCase(),
    idx: days.flatMap((d, i) => (d.records.some((r) => r.stop_and_watch[k] === true) ? [i] : [])),
  }));
  const orient = days.flatMap((d, i) => (d.records.some((r) => r.orientation_correct === false) ? [i] : []));
  if (orient.length) concerns.push({ name: "did not know the day of the week", idx: orient });
  const concernGroups = groupByDays(concerns.filter((c) => c.idx.length));
  if (concernGroups.length) {
    lines.push(`Reported: ${concernGroups.map((g) => `${joinList(g.names)} ${whenText(days, g.idx)}`).join("; ")}.`);
  }

  const known = weights.flatMap((w, i) => (w === null ? [] : [{ i, w }]));
  if (known.length >= 2) {
    const a = known[0];
    const b = known[known.length - 1];
    const delta = Math.round((b.w - a.w) * 10) / 10;
    if (Math.abs(delta) >= 2) {
      lines.push(
        `Weight ${fmtLb(a.w)} lb on ${short(days[a.i].date)} to ${fmtLb(b.w)} lb on ${short(days[b.i].date)} (${delta > 0 ? "+" : "−"}${fmtLb(Math.abs(delta))} lb).`,
      );
    }
  }

  const quiet = lines.length === 0;
  if (quiet) lines.push(`No missed medication or reported concerns in the last ${DAYS} days.`);

  const noCall = days.flatMap((d, i) => (d.records.length === 0 ? [i] : []));
  if (noCall.length) lines.push(`No call on ${datesText(days, noCall)}.`);

  return { lines, quiet };
}

const GLYPH: Record<CellKind, string> = { none: "–", na: "?", ok: "✓", hit: "!" };

export function PatternGrid({ state }: { state: PatientState }) {
  const days = buildDays(state.history);
  const inWindow = days.flatMap((d) => d.records);
  const last = DAYS - 1;

  const swKeys = (Object.keys(SW_LABEL) as (keyof StopAndWatch)[]).filter((k) =>
    inWindow.some((r) => r.stop_and_watch[k] === true),
  );

  const rows: { label: string; med?: boolean; cell: (rs: CheckinRecord[]) => Cell }[] = [
    {
      label: "Missed medication",
      med: true,
      cell: (rs) => {
        const meds = [...new Set(rs.flatMap(missedMeds))];
        if (meds.length) return { kind: "hit", detail: `missed ${meds.join(", ")}` };
        if (rs.every((r) => r.medication_adherence.all_taken === null)) return { kind: "na" };
        return { kind: "ok", detail: "all taken" };
      },
    },
    ...swKeys.map((k) => ({
      label: SW_LABEL[k],
      cell: (rs: CheckinRecord[]): Cell => {
        if (rs.some((r) => r.stop_and_watch[k] === true)) return { kind: "hit", detail: "reported" };
        if (rs.some((r) => r.stop_and_watch[k] === false)) return { kind: "ok", detail: "asked, not reported" };
        return { kind: "na" };
      },
    })),
    {
      label: "Knew day of week",
      cell: (rs) => {
        if (rs.some((r) => r.orientation_correct === false)) return { kind: "hit", detail: "did not know the day" };
        if (rs.some((r) => r.orientation_correct === true)) return { kind: "ok", detail: "knew the day" };
        return { kind: "na" };
      },
    },
  ];

  const baseline = state.patient.baseline.weight_lb;
  const weights = days.map((d) => {
    const ws = d.records.map((r) => weightOf(r, baseline)).filter((w): w is number => w !== null);
    return ws.length ? ws[ws.length - 1] : null;
  });

  const summary = buildSummary(days, swKeys, weights);

  // Month labels: one at the left edge and one at each first-of-month. Drop the left one if a month starts right after it.
  const monthAt = days.map((d, i) => (i === 0 || d.date.getDate() === 1 ? MON(d.date) : null));
  const firstChange = monthAt.findIndex((m, i) => i > 0 && m !== null);
  if (firstChange > 0 && firstChange < 3) monthAt[0] = null;

  const cellText = (d: Day, row: string, c: Cell) => {
    const when = dayLabel(d.date);
    if (c.kind === "none") return `${when}: no call`;
    if (c.kind === "na") return `${when}: ${row}, not asked`;
    return `${when}: ${row}, ${c.detail}`;
  };

  return (
    <div className="panel">
      <h3 className="eyebrow">14-day pattern</h3>

      <section className={`pg-summary ${summary.quiet ? "pg-summary-quiet" : ""}`} aria-label="For nurse review">
        <h4 className="pg-summary-title">For nurse review</h4>
        <ul>
          {summary.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      <div
        className="pg"
        role="table"
        aria-label={`Check-in findings, ${short(days[0].date)} to ${short(days[last].date)}, oldest first`}
        style={{ "--pg-days": DAYS } as CSSProperties}
      >
        <div className="pg-row pg-months" aria-hidden>
          <span className="pg-label" />
          {days.map((d, i) => (
            <span key={d.key} className="pg-month">
              {monthAt[i]}
            </span>
          ))}
        </div>
        <div className="pg-row" role="row">
          <span className="pg-label" role="columnheader">
            <span className="sr-only">Finding</span>
          </span>
          {days.map((d, i) => (
            <span
              key={d.key}
              role="columnheader"
              className={`pg-day ${d.date.getDate() === 1 ? "pg-day-first" : ""} ${i === last ? "pg-last" : ""}`}
              title={dayLabel(d.date)}
              aria-label={dayLabel(d.date)}
            >
              {d.date.getDate()}
            </span>
          ))}
        </div>

        {rows.map((row) => (
          <div className="pg-row" role="row" key={row.label}>
            <span className="pg-label" role="rowheader">
              {row.label}
            </span>
            {days.map((d) => {
              const c: Cell = d.records.length === 0 ? { kind: "none" } : row.cell(d.records);
              const text = cellText(d, row.label, c);
              const kind = c.kind === "hit" && row.med ? "med" : c.kind;
              return (
                <span key={d.key} role="cell" className={`pg-cell pg-${kind}`} title={text} aria-label={text}>
                  <span aria-hidden>{kind === "med" ? "✕" : GLYPH[c.kind]}</span>
                </span>
              );
            })}
          </div>
        ))}

        <WeightTrend days={days} weights={weights} />
      </div>

      <ul className="pg-legend" aria-label="Legend">
        <li>
          <span className="pg-key pg-med" aria-hidden>✕</span> Missed medication
        </li>
        <li>
          <span className="pg-key pg-hit" aria-hidden>!</span> Concern reported
        </li>
        <li>
          <span className="pg-key pg-ok" aria-hidden>✓</span> Asked, no concern
        </li>
        <li>
          <span className="pg-key pg-na" aria-hidden>?</span> Call, not asked
        </li>
        <li>
          <span className="pg-key pg-none" aria-hidden>–</span> No call
        </li>
      </ul>
    </div>
  );
}

function WeightTrend({ days, weights }: { days: Day[]; weights: (number | null)[] }) {
  const known = weights.flatMap((w, i) => (w === null ? [] : [{ i, w }]));
  if (known.length < 2) {
    return (
      <div className="pg-weight-head" role="row">
        <span role="cell">
          <strong>Weight</strong> <span className="text-muted">not enough weights recorded in this window.</span>
        </span>
      </div>
    );
  }
  const first = known[0];
  const lastK = known[known.length - 1];
  const delta = Math.round((lastK.w - first.w) * 10) / 10;
  const min = Math.min(...known.map((p) => p.w));
  const max = Math.max(...known.map((p) => p.w));
  const span = Math.max(max - min, 2);
  const pct = (w: number) => 12 + ((w - min) / span) * 76; // % from bottom
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  const rising = delta >= 2;
  const gaps = weights.flatMap((w, i) => (w === null ? [i] : []));
  const gapText = gaps.length ? `No weight on ${datesText(days, gaps)}` : "";
  const summary =
    `Weight ${fmtLb(first.w)} lb on ${short(days[first.i].date)} to ${fmtLb(lastK.w)} lb on ${short(days[lastK.i].date)}, ` +
    `net ${sign}${fmtLb(Math.abs(delta))} lb. ${gapText}`;

  // Line segments only between adjacent days that both have a weight; unknown days break the line.
  const segs: string[] = [];
  for (let i = 0; i < weights.length - 1; i++) {
    const a = weights[i];
    const b = weights[i + 1];
    if (a !== null && b !== null) segs.push(`M${i + 0.5},${100 - pct(a)} L${i + 1.5},${100 - pct(b)}`);
  }

  return (
    <>
      <div className="pg-weight-head" role="row">
        <span role="cell">
          <strong>Weight</strong> {fmtLb(first.w)} &rarr; {fmtLb(lastK.w)} lb{" "}
          <span className={`pg-delta ${rising ? "pg-delta-up" : ""}`}>
            (net {sign}
            {fmtLb(Math.abs(delta))} lb)
          </span>
          {gapText && <span className="pg-weight-gaps text-muted"> · {gapText} (hatched)</span>}
        </span>
      </div>
      <div className="pg-row pg-weight-row" role="row">
        <span className="pg-label pg-weight-label text-muted" role="rowheader" aria-label="Weight, pounds">
          <span>{fmtLb(max)}</span>
          <span>{fmtLb(min)}</span>
        </span>
        <span className="pg-weight-track" role="cell" aria-label={summary}>
          <svg className="pg-weight-line" viewBox={`0 0 ${DAYS} 100`} preserveAspectRatio="none" aria-hidden>
            <path d={segs.join(" ")} className={rising ? "pg-spark-up" : "pg-spark-flat"} vectorEffect="non-scaling-stroke" />
          </svg>
          {weights.map((w, i) => {
            const when = dayLabel(days[i].date);
            if (w === null) {
              const reason = days[i].records.length === 0 ? "no call" : "not recorded";
              return (
                <span key={days[i].key} className="pg-wgap" style={{ gridColumn: i + 1 }} title={`${when}: weight unknown (${reason})`}>
                  <span aria-hidden>?</span>
                </span>
              );
            }
            const isEnd = i === first.i || i === lastK.i;
            return (
              <span key={days[i].key} className="pg-wslot" style={{ gridColumn: i + 1 }} title={`${when}: ${fmtLb(w)} lb`}>
                <span className={`pg-wdot ${rising ? "pg-wdot-up" : ""} ${isEnd ? "pg-wdot-end" : ""}`} style={{ bottom: `${pct(w)}%` }} />
              </span>
            );
          })}
        </span>
      </div>
    </>
  );
}

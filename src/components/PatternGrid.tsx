"use client";

import { useState, type CSSProperties, type KeyboardEvent } from "react";
import type { AnalysisResult, CheckinRecord, PatientState, StopAndWatch } from "@/lib/types";

const DAYS = 14;

const SW_LABEL: Record<keyof StopAndWatch, string> = {
  seems_different: "Seems different",
  talks_less: "Talks less",
  needs_more_help: "Needs more help",
  ate_less: "Ate less",
  bowel_change: "Bowel change",
  drank_less: "Drank less",
  weight_or_swelling: "Swelling",
  agitated: "Agitated",
  tired_weak_confused: "Tired or weak",
  skin_change: "Skin change",
  walking_toileting_help: "Needs help walking",
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

/** 14 days ending today. */
function buildDays(history: CheckinRecord[]): Day[] {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
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

  const noCall = days.flatMap((d, i) => (d.records.length === 0 && i < days.length - 1 ? [i] : []));
  if (noCall.length) lines.push(`No call on ${datesText(days, noCall)}.`);

  return { lines, quiet };
}

const GLYPH: Record<CellKind, string> = { none: "–", na: "?", ok: "", hit: "!" };
const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

type Probe = (r: CheckinRecord) => boolean | null;

/** true if any check flags it, false if any check was asked and negative, otherwise null. */
function anyOf(...probes: Probe[]): Probe {
  return (r) => {
    const vals = probes.map((p) => p(r));
    if (vals.includes(true)) return true;
    if (vals.includes(false)) return false;
    return null;
  };
}
const sw = (k: keyof StopAndWatch): Probe => (r) => r.stop_and_watch[k];
const cs = (k: string): Probe => (r) => {
  const v = r.condition_specific[k];
  return typeof v === "boolean" ? v : null;
};

interface RowDef {
  label: string;
  probe: Probe;
  swKeys: (keyof StopAndWatch)[];
  orientation?: boolean;
}

function hasCond(conds: string[], ...needles: string[]): boolean {
  return conds.some((c) => needles.some((n) => c.toLowerCase().includes(n)));
}

function conditionRows(conds: string[]): RowDef[] {
  const rows: RowDef[] = [];
  if (hasCond(conds, "copd")) {
    rows.push({ label: "Inhaler use", probe: anyOf(cs("rescue_inhaler_more"), (r) => r.medication_adherence.prn_use_increased), swKeys: [] });
    rows.push({ label: "Cough", probe: anyOf(cs("cough_worse"), cs("sputum_change")), swKeys: [] });
  }
  if (hasCond(conds, "heart failure", "chf")) {
    rows.push({ label: "Swelling", probe: anyOf(sw("weight_or_swelling"), cs("ankle_swelling")), swKeys: ["weight_or_swelling"] });
    rows.push({ label: "Breathless lying flat", probe: cs("sob_lying_flat"), swKeys: [] });
  }
  if (hasCond(conds, "dementia", "mci")) {
    rows.push({
      label: "Confusion",
      probe: anyOf((r) => (r.orientation_correct === null ? null : !r.orientation_correct), sw("tired_weak_confused"), cs("new_confusion")),
      swKeys: ["tired_weak_confused"],
      orientation: true,
    });
    rows.push({ label: "Drank less", probe: sw("drank_less"), swKeys: ["drank_less"] });
  }
  return rows;
}

/** "tomorrow at 9:30 AM" -> "9:30 AM"; falls back to the raw string. */
function callTime(raw: string): string {
  const m = raw.match(/\d{1,2}(:\d{2})?\s*[AaPp]\.?[Mm]\.?/);
  return m ? m[0].toUpperCase() : raw;
}

function engineNote(a: AnalysisResult | null, days: Day[]): string | null {
  if (!a || a.findings.length === 0) return null;
  const adh = a.findings.find((f) => f.attribution === "likely_adherence_related");
  if (adh) {
    const meds = new Map<string, number[]>();
    days.forEach((d, i) => {
      for (const m of new Set(d.records.flatMap(missedMeds))) if (m !== "a dose") meds.set(m, [...(meds.get(m) ?? []), i]);
    });
    const what = (adh.evidence[0] || adh.reason || "these changes").replace(/\.$/, "");
    const medText = [...meds].map(([m, idx]) => `${m} (${datesText(days, idx)})`);
    if (medText.length) return `Engine note: ${what} may be related to missed ${joinList(medText)}. Nurse to review.`;
    return `Engine note: ${what} may be related to missed medicines (${adh.reason.replace(/\.$/, "")}). Nurse to review.`;
  }
  if (a.findings.some((f) => f.attribution === "likely_clinical_change")) {
    return "Engine note: these changes are not explained by missed medicines. Nurse to review.";
  }
  return null;
}

export function PatternGrid({ state }: { state: PatientState }) {
  const [open, setOpen] = useState<number | null>(null);
  const days = buildDays(state.history);
  const inWindow = days.flatMap((d) => d.records);
  const last = DAYS - 1;
  const todayPending = days[last].records.length === 0;
  const todayText = `Today: call at ${callTime(state.patient.next_call_time)}`;
  const isHF = hasCond(state.patient.conditions, "heart failure", "chf");

  const condRows = conditionRows(state.patient.conditions);
  const covered = new Set(condRows.flatMap((r) => r.swKeys));
  const orientCovered = condRows.some((r) => r.orientation);

  const swKeys = (Object.keys(SW_LABEL) as (keyof StopAndWatch)[]).filter((k) =>
    inWindow.some((r) => r.stop_and_watch[k] === true),
  );
  const otherRows: RowDef[] = swKeys
    .filter((k) => !covered.has(k))
    .map((k) => ({ label: SW_LABEL[k], probe: sw(k), swKeys: [k] }));
  if (!orientCovered && inWindow.some((r) => r.orientation_correct === false)) {
    otherRows.push({ label: "Confusion", probe: (r) => (r.orientation_correct === null ? null : !r.orientation_correct), swKeys: [] });
  }

  const medRow = {
    label: "Missed meds",
    med: true,
    cell: (rs: CheckinRecord[]): Cell => {
      const meds = [...new Set(rs.flatMap(missedMeds))];
      if (meds.length) return { kind: "hit", detail: `missed ${meds.join(", ")}` };
      if (rs.every((r) => r.medication_adherence.all_taken === null)) return { kind: "na" };
      return { kind: "ok", detail: "all taken" };
    },
  };
  const probeCell = (probe: Probe) => (rs: CheckinRecord[]): Cell => {
    const vals = rs.map(probe);
    if (vals.includes(true)) return { kind: "hit", detail: "reported" };
    if (vals.includes(false)) return { kind: "ok", detail: "asked, no change" };
    return { kind: "na" };
  };
  const rows: { label: string; med?: boolean; cell: (rs: CheckinRecord[]) => Cell }[] = [
    medRow,
    ...condRows.map((r) => ({ label: r.label, cell: probeCell(r.probe) })),
    ...otherRows.map((r) => ({ label: r.label, cell: probeCell(r.probe) })),
  ];

  const baseline = state.patient.baseline.weight_lb;
  const weights = days.map((d) => {
    const ws = d.records.map((r) => weightOf(r, baseline)).filter((w): w is number => w !== null);
    return ws.length ? ws[ws.length - 1] : null;
  });

  const summary = buildSummary(days, swKeys, weights);
  const note = engineNote(state.last_analysis, days);

  const monthAt = days.map((d, i) => (i === 0 || d.date.getDate() === 1 ? MON(d.date) : null));
  const firstChange = monthAt.findIndex((m, i) => i > 0 && m !== null);
  if (firstChange > 0 && firstChange < 3) monthAt[0] = null;

  const cellText = (d: Day, i: number, row: string, c: Cell) => {
    const when = dayLabel(d.date);
    if (c.kind === "none") return i === last && todayPending ? todayText : `${when}: no call`;
    if (c.kind === "na") return `${when}: ${row}, called, not asked`;
    return `${when}: ${row}, ${c.detail}`;
  };

  const openDay = open !== null ? days[open] : null;
  const openRec = openDay ? openDay.records[openDay.records.length - 1] : null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open !== null) {
      e.stopPropagation();
      setOpen(null);
    }
  };

  return (
    <div className="panel" onKeyDown={onKey}>
      <h3 className="eyebrow">14-day pattern</h3>

      <section className={`pg-summary ${summary.quiet ? "pg-summary-quiet" : ""}`} aria-label="For nurse review">
        <h4 className="pg-summary-title">For nurse review</h4>
        <ul>
          {summary.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      {todayPending && <p className="pg-today-note">{todayText}</p>}

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
        <div className="pg-row pg-weekdays" aria-hidden>
          <span className="pg-label" />
          {days.map((d) => (
            <span key={d.key} className="pg-wd">
              {WEEKDAY[d.date.getDay()]}
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
              title={i === last ? `Today, ${dayLabel(d.date)}` : dayLabel(d.date)}
              aria-label={i === last ? `Today, ${dayLabel(d.date)}` : dayLabel(d.date)}
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
            {days.map((d, i) => {
              const c: Cell = d.records.length === 0 ? { kind: "none" } : row.cell(d.records);
              const text = cellText(d, i, row.label, c);
              const pending = c.kind === "none" && i === last && todayPending;
              const kind = pending ? "pending" : c.kind === "hit" && row.med ? "med" : c.kind;
              if (c.kind === "hit") {
                return (
                  <span key={d.key} role="cell" className="pg-cellwrap">
                    <button
                      type="button"
                      className={`pg-cell pg-btn pg-${kind} ${open === i ? "pg-open" : ""}`}
                      title={text}
                      aria-label={`${text}. Show what they said`}
                      aria-expanded={open === i}
                      aria-controls="pg-quote"
                      onClick={() => setOpen(open === i ? null : i)}
                    >
                      <span aria-hidden>{kind === "med" ? "✕" : GLYPH.hit}</span>
                    </button>
                  </span>
                );
              }
              return (
                <span key={d.key} role="cell" className={`pg-cell pg-${kind}`} title={text} aria-label={text}>
                  <span aria-hidden>{pending ? "" : GLYPH[c.kind]}</span>
                </span>
              );
            })}
          </div>
        ))}
        {otherRows.length === 0 && <p className="pg-quiet">No other changes</p>}

        <WeightTrend days={days} weights={weights} hf={isHF} />
      </div>

      <div id="pg-quote" aria-live="polite">
        {openDay && (
          <div className="pg-quote">
            <strong>{dayLabel(openDay.date)}:</strong>{" "}
            {openRec?.patient_quote ? <q>{openRec.patient_quote}</q> : <span className="text-muted">No quote recorded.</span>}
            {openRec?.patient_message_for_caregiver && (
              <span className="pg-quote-msg"> Message for caregiver: {openRec.patient_message_for_caregiver}</span>
            )}
            <button type="button" className="pg-quote-close" onClick={() => setOpen(null)} aria-label="Close quote">
              ×
            </button>
          </div>
        )}
      </div>

      {note && <p className="pg-insight">{note}</p>}

      <ul className="pg-legend" aria-label="Legend">
        <li>
          <span className="pg-key pg-med" aria-hidden>✕</span> Missed meds
        </li>
        <li>
          <span className="pg-key pg-hit" aria-hidden>!</span> Change reported (tap to see quote)
        </li>
        <li>
          <span className="pg-key pg-ok" aria-hidden /> Asked, fine
        </li>
        <li>
          <span className="pg-key pg-na" aria-hidden>?</span> Called, not asked
        </li>
        <li>
          <span className="pg-key pg-none" aria-hidden>–</span> No call
        </li>
        {isHF && (
          <li>
            <span className="pg-key pg-hfkey" aria-hidden /> HF threshold: &gt;2 lb/day, &gt;5 lb/week
          </li>
        )}
      </ul>
    </div>
  );
}

function WeightTrend({ days, weights, hf }: { days: Day[]; weights: (number | null)[]; hf: boolean }) {
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
  const lo0 = Math.min(...known.map((p) => p.w));
  const hi0 = Math.max(...known.map((p) => p.w));
  const mid = (lo0 + hi0) / 2;
  const span = Math.max(hi0 - lo0, 10);
  const min = mid - span / 2;
  const max = mid + span / 2;
  const pct = (w: number) => 8 + ((w - min) / span) * 84;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  const rising = delta >= 2;
  const gaps = weights.flatMap((w, i) => (w === null && i < days.length - 1 ? [i] : []));
  const gapText = gaps.length ? `No weight on ${datesText(days, gaps)}` : "";

  // HF thresholds: >2 lb vs previous day, >5 lb vs any weight in the prior 7 days.
  const hfDay = new Set<number>();
  const hfWeek = new Set<number>();
  if (hf) {
    weights.forEach((w, i) => {
      if (w === null) return;
      const prev = i > 0 ? weights[i - 1] : null;
      if (prev !== null && w - prev > 2) hfDay.add(i);
      for (let j = Math.max(0, i - 7); j < i; j++) {
        const wj = weights[j];
        if (wj !== null && w - wj > 5) {
          for (let k = j; k <= i; k++) hfWeek.add(k);
          break;
        }
      }
    });
  }
  const hfText =
    hfDay.size || hfWeek.size
      ? ` Above HF threshold on ${datesText(days, [...new Set([...hfDay, ...hfWeek])].filter((i) => weights[i] !== null))}.`
      : "";
  const summary =
    `Weight ${fmtLb(first.w)} lb on ${short(days[first.i].date)} to ${fmtLb(lastK.w)} lb on ${short(days[lastK.i].date)}, ` +
    `net ${sign}${fmtLb(Math.abs(delta))} lb. ${gapText}${hfText}`;

  const segs: string[] = [];
  for (let i = 0; i < weights.length - 1; i++) {
    const a = weights[i];
    const b = weights[i + 1];
    if (a !== null && b !== null) segs.push(`M${i + 0.5},${100 - pct(a)} L${i + 1.5},${100 - pct(b)}`);
  }

  return (
    <div className="pg-row pg-weight-row" role="row">
      <span className="pg-label pg-weight-label" role="rowheader">
        <span className="pg-weight-title">
          Weight {fmtLb(lastK.w)} lb · <span className={`pg-delta ${rising ? "pg-delta-up" : ""}`}>{sign}{fmtLb(Math.abs(delta))} lb</span>
        </span>
        <span className="pg-weight-scale text-muted" aria-hidden>
          <span>{fmtLb(max)}</span>
          <span>{fmtLb(min)}</span>
        </span>
      </span>
      <span className="pg-weight-track" role="cell" aria-label={summary}>
        {weights.map((w, i) => {
          const when = dayLabel(days[i].date);
          const band = hfWeek.has(i) ? "pg-hfweek" : "";
          if (w === null) {
            if (i === days.length - 1) return <span key={days[i].key} className="pg-wslot" style={{ gridColumn: i + 1 }} />;
            const reason = days[i].records.length === 0 ? "no call" : "not recorded";
            return (
              <span key={days[i].key} className={`pg-wgap ${band}`} style={{ gridColumn: i + 1 }} title={`${when}: weight unknown (${reason})`}>
                <span aria-hidden>?</span>
              </span>
            );
          }
          const isEnd = i === first.i || i === lastK.i;
          const flag = hfDay.has(i) ? " · over 2 lb in a day" : hfWeek.has(i) ? " · over 5 lb in a week" : "";
          return (
            <span key={days[i].key} className={`pg-wslot ${band} ${hfDay.has(i) ? "pg-hfday" : ""}`} style={{ gridColumn: i + 1 }} title={`${when}: ${fmtLb(w)} lb${flag}`}>
              <span className={`pg-wdot ${rising ? "pg-wdot-up" : ""} ${isEnd ? "pg-wdot-end" : ""}`} style={{ bottom: `${pct(w)}%` }} />
            </span>
          );
        })}
        <svg className="pg-weight-line" viewBox={`0 0 ${DAYS} 100`} preserveAspectRatio="none" aria-hidden>
          <path d={segs.join(" ")} className={rising ? "pg-spark-up" : "pg-spark-flat"} vectorEffect="non-scaling-stroke" />
        </svg>
      </span>
    </div>
  );
}

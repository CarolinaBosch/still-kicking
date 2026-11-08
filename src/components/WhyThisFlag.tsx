"use client";

import { useId, useState } from "react";
import type { Alert, CheckinRecord, PatientState } from "@/lib/types";

// Read-only explanation of an alert, built only from records already loaded in the browser.

type Flag = boolean | null;
type Item = { label: (v: Flag) => string; read: (r: CheckinRecord) => Flag } | { value: (r: CheckinRecord) => string | null };

export type EvidenceRow = {
  date: string;
  callId: string;
  synthetic: boolean;
  observations: string[];
  quote: string | null;
};

export type Evidence = {
  source: string;
  rows: EvidenceRow[];
  missing: string | null;
  alsoRecorded: string | null;
  fallbackDetail: string | null;
};

const DAY = 86_400_000;

const cs = (r: CheckinRecord, k: string): Flag => {
  const v = r.condition_specific?.[k];
  return typeof v === "boolean" ? v : null;
};
const any = (...vals: Flag[]): Flag => (vals.some((v) => v === true) ? true : vals.some((v) => v === false) ? false : null);
function obs(name: string, yes: string, no: string, read: (r: CheckinRecord) => Flag): Item {
  return { read, label: (v) => (v === true ? yes : v === false ? no : `${name}: not asked`) };
}

const TOPICS: { match: string[]; items: Item[] }[] = [
  {
    match: ["heart failure"],
    items: [
      obs("swelling", "swelling reported", "no swelling", (r) => any(r.stop_and_watch?.weight_or_swelling ?? null, cs(r, "ankle_swelling"), cs(r, "swelling"))),
      obs("breathless lying flat", "breathless lying flat", "not breathless lying flat", (r) => cs(r, "sob_lying_flat")),
      { value: (r) => (typeof r.weight_lb === "number" ? `weight ${r.weight_lb} lb` : "weight: not recorded") },
    ],
  },
  {
    match: ["urinary infection", "delirium"],
    items: [
      obs("confusion", "confusion noted", "no confusion", (r) => any(r.orientation_correct === null ? null : !r.orientation_correct, r.stop_and_watch?.tired_weak_confused ?? null, cs(r, "new_confusion"))),
      obs("drank less", "drank less", "drinking as usual", (r) => r.stop_and_watch?.drank_less ?? null),
      obs("urinary burning", "burning when passing urine", "no urinary burning", (r) => cs(r, "urinary_burning")),
      obs("urinary frequency", "going to the toilet more often", "no change in urinary frequency", (r) => cs(r, "urinary_frequency")),
    ],
  },
  {
    match: ["copd"],
    items: [
      obs("cough", "cough worse", "cough not worse", (r) => cs(r, "cough_worse")),
      obs("sputum", "sputum changed", "no sputum change", (r) => cs(r, "sputum_change")),
      obs("rescue inhaler", "using rescue inhaler more", "rescue inhaler use not increased", (r) => any(cs(r, "rescue_inhaler_more"), r.medication_adherence?.prn_use_increased ?? null)),
    ],
  },
  {
    match: ["fall risk"],
    items: [
      obs("needs more help", "needs more help walking or toileting", "no extra help needed", (r) => any(r.stop_and_watch?.needs_more_help ?? null, r.stop_and_watch?.walking_toileting_help ?? null)),
      obs("fall", "fall reported", "no fall", (r) => cs(r, "fall")),
      obs("near fall", "near fall reported", "no near fall", (r) => cs(r, "near_fall")),
    ],
  },
  {
    match: ["low blood pressure"],
    items: [
      obs("dizzy on standing", "dizzy on standing", "not dizzy on standing", (r) => cs(r, "dizzy_standing")),
      obs("ate less", "ate less", "eating as usual", (r) => r.stop_and_watch?.ate_less ?? null),
      obs("drank less", "drank less", "drinking as usual", (r) => r.stop_and_watch?.drank_less ?? null),
    ],
  },
  {
    match: ["depression", "mood"],
    items: [
      obs("mood screen", "mood screen score 3 or higher", "mood screen score below 3", (r) => (typeof r.phq2_score === "number" ? r.phq2_score >= 3 : null)),
      obs("talks less", "talking less", "talking as usual", (r) => r.stop_and_watch?.talks_less ?? null),
      obs("ate less", "ate less", "eating as usual", (r) => r.stop_and_watch?.ate_less ?? null),
    ],
  },
];

export function formatEvidenceDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "unknown date";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).replace(",", "");
}

function sourceLabel(a: Alert): string {
  if (a.id.startsWith("seed-")) return "Synthetic history (seeded demo data)";
  if (a.kind === "missed_calls") return "From the 'Simulate missed call' demo button";
  if (a.kind === "red_flag") return "Raised during a call";
  return "From the Daytona engine after a check-in";
}

function toRow(r: CheckinRecord, observations: string[]): EvidenceRow {
  const q = typeof r.patient_quote === "string" ? r.patient_quote.trim() : "";
  return {
    date: formatEvidenceDate(r.timestamp),
    callId: r.call_id,
    synthetic: r.call_id.startsWith("seed-"),
    observations,
    quote: q ? q : null,
  };
}

function missedMeds(records: CheckinRecord[]): string | null {
  const byMed = new Map<string, string[]>();
  for (const r of records) {
    for (const m of r.medication_adherence?.missed ?? []) {
      if (!m.med) continue;
      const day = new Date(r.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const list = byMed.get(m.med) ?? [];
      if (!list.includes(day)) list.push(day);
      byMed.set(m.med, list);
    }
  }
  if (byMed.size === 0) return null;
  const parts = [...byMed].map(([med, days]) => {
    const month = days[0].split(" ")[0];
    const sameMonth = days.every((d) => d.startsWith(month + " "));
    const shown = sameMonth ? `${month} ${days.map((d) => d.split(" ")[1]).join(", ")}` : days.join(", ");
    return `${med} missed on ${shown}`;
  });
  return `Also recorded: ${parts.join("; ")}.`;
}

export function buildEvidence(alert: Alert, state: PatientState | undefined): Evidence {
  const source = sourceLabel(alert);
  const at = Date.parse(alert.created_at);
  const history = state?.history ?? [];
  const inWindow = history.filter((r) => {
    const t = Date.parse(r.timestamp);
    return Number.isFinite(t) && t <= at && t >= at - 7 * DAY;
  });
  const base: Evidence = { source, rows: [], missing: null, alsoRecorded: null, fallbackDetail: null };

  if (alert.kind === "missed_calls") {
    const attempts = [...(state?.attempts ?? [])].sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
    // The run of unanswered attempts around the alert (seeded alerts are stamped mid-run).
    let end = -1;
    attempts.forEach((c, i) => {
      const t = Date.parse(c.at);
      if (!c.answered && t <= at + 3_600_000 && t >= at - DAY) end = i;
    });
    const run: string[] = [];
    for (let i = end; i >= 0 && !attempts[i].answered; i--) {
      if (Date.parse(attempts[i].at) < at - DAY) break;
      const d = new Date(attempts[i].at);
      run.unshift(`${formatEvidenceDate(attempts[i].at)}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}: no answer`);
    }
    if (run.length === 0) return { ...base, missing: "No stored unanswered call attempts found around this alert (missing evidence)." };
    return { ...base, rows: [{ date: "Call attempts", callId: "", synthetic: alert.id.startsWith("seed-"), observations: run, quote: null }] };
  }

  if (alert.kind === "red_flag") {
    const recs = inWindow.filter((r) => (r.red_flags ?? []).length > 0);
    if (recs.length === 0) return { ...base, missing: "No stored check-ins show these observations in the last 7 days (missing evidence)." };
    const rows = recs.map((r) =>
      toRow(
        r,
        r.red_flags.map((f) => {
          const kind = f.type.replace(/_/g, " ");
          return f.quote?.trim() ? `red flag: ${kind}, said "${f.quote.trim()}"` : `red flag: ${kind}`;
        }),
      ),
    );
    return { ...base, rows, alsoRecorded: missedMeds(inWindow) };
  }

  const title = alert.title.toLowerCase();
  const topic = TOPICS.find((t) => t.match.some((m) => title.includes(m)));
  if (!topic) return { ...base, fallbackDetail: alert.detail || "No further detail stored." };

  const rows: EvidenceRow[] = [];
  for (const r of inWindow) {
    let hit = false;
    const observations = topic.items.map((it) => {
      if ("value" in it) return it.value(r) ?? "";
      const v = it.read(r);
      if (v === true) hit = true;
      return it.label(v);
    });
    if (hit) rows.push(toRow(r, observations.filter(Boolean)));
  }
  return {
    ...base,
    rows,
    missing: rows.length === 0 ? "No stored check-ins show these observations in the last 7 days (missing evidence)." : null,
    alsoRecorded: missedMeds(inWindow),
  };
}

export function WhyThisFlag({
  alert,
  state,
  defaultOpen = false,
}: {
  alert: Alert;
  state: PatientState | undefined;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const ev = open ? buildEvidence(alert, state) : null;

  return (
    <div className="why-flag">
      <button type="button" className="btn-link why-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide why this flag" : "Why this flag?"}
      </button>
      {open && ev && (
        <div id={panelId} className="why-panel" role="region" aria-label="Why this flag">
          <p className="why-source">
            <strong>Source:</strong> {ev.source}. Text messages shown are simulated.
          </p>
          {ev.fallbackDetail && <p className="why-detail">{ev.fallbackDetail}</p>}
          {ev.rows.length > 0 && (
            <>
              <ul className="why-rows">
                {ev.rows.map((row, i) => (
                  <li key={`${row.callId}-${i}`} className="why-row">
                    <p className="why-row-head">
                      <strong>{row.date}</strong>
                      {row.synthetic && <span className="why-synth">synthetic</span>}
                    </p>
                    <ul className="why-obs">
                      {row.observations.map((o, j) => (
                        <li key={j}>{o}</li>
                      ))}
                    </ul>
                    {alert.kind !== "missed_calls" &&
                      (row.quote ? (
                        <p className="why-quote">
                          <span className="why-label">In their words:</span> &ldquo;{row.quote}&rdquo;
                        </p>
                      ) : (
                        <p className="why-noquote">No quote stored for this check-in.</p>
                      ))}
                    {row.callId && <p className="why-ref">Check-in record {row.callId}</p>}
                  </li>
                ))}
              </ul>
              {alert.kind !== "missed_calls" && <p className="why-ref">Transcript not stored in this prototype.</p>}
            </>
          )}
          {ev.missing && <p className="why-missing">{ev.missing}</p>}
          {ev.alsoRecorded && <p className="why-also">{ev.alsoRecorded}</p>}
          <p className="why-review">For nurse review — these are recorded observations, not a diagnosis. The nurse decides what to do.</p>
        </div>
      )}
    </div>
  );
}

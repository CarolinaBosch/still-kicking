"use client";

import CallPanel from "@/components/CallPanel";
import { PatternGrid } from "./PatternGrid";
import type { Alert, AnalysisResult, Attribution, PatientState } from "@/lib/types";
import { consecutiveMissed } from "./client-api";
import { ErrorNote, SandboxChip, Spinner, StatusLight } from "./ui";

const ATTRIBUTION_LABEL: Record<Attribution, string> = {
  likely_adherence_related: "Likely medication-related",
  likely_clinical_change: "Likely clinical change",
  unclear: "Unclear cause",
};

export interface MissedState {
  busy: boolean;
  error: string | null;
  lastAlert: Alert | null;
}

export function PatientDetail({
  state,
  analysis,
  missed,
  onMissedCall,
  onEmergency,
  onAnalysis,
}: {
  state: PatientState;
  analysis: AnalysisResult | null;
  missed: MissedState;
  onMissedCall: () => void;
  onEmergency: (a: Alert) => void;
  onAnalysis: (r: AnalysisResult) => void;
}) {
  const p = state.patient;
  const missedCount = consecutiveMissed(state.attempts);

  return (
    <section className="detail" aria-labelledby="detail-title">
      <div className="panel">
        <div className="detail-head">
          <div>
            <h2 id="detail-title" className="detail-name">
              {p.name} <span className="text-muted">(&ldquo;{p.preferred_name}&rdquo;, {p.age})</span>
            </h2>
            <p className="text-muted">
              {p.conditions.join(" · ")} · Caregiver: {p.caregiver.name} ({p.caregiver.relationship}) · Nurse: {nurseName(p.nurse.name)}
            </p>
          </div>
          <StatusLight status={state.status} large />
        </div>
        <ul className="med-list" aria-label="Medications">
          {p.medications.map((m) => (
            <li key={m.name} className="med-chip">
              <strong>{m.name}</strong> {m.dose}, {m.schedule}
            </li>
          ))}
        </ul>
      </div>

      <div data-tour="patterns">
        <PatternGrid history={state.history} />
      </div>

      <div className="panel" data-tour="call">
        <h3 className="eyebrow">Check-in call</h3>
        <CallPanel key={p.id} patient={p} onEmergency={onEmergency} onAnalysis={onAnalysis} />
        <div className="missed-row" data-tour="missed">
          <button type="button" className="btn-quiet" onClick={onMissedCall} disabled={missed.busy}>
            {missed.busy ? <Spinner label="Recording…" /> : "Simulate missed call"}
          </button>
          <span className="attempts" aria-label={`${Math.min(missedCount, 3)} of 3 attempts unanswered`}>
            {[1, 2, 3].map((n) => (
              <span key={n} className={`attempt-pip ${n <= missedCount ? "attempt-missed" : ""}`} aria-hidden />
            ))}
            <span>
              {missedCount === 0 ? "No missed attempts" : `Unanswered attempts: ${Math.min(missedCount, 3)}/3`}
            </span>
          </span>
          {missed.lastAlert && <span className="missed-escalated">Escalated: {missed.lastAlert.title}</span>}
        </div>
        {missed.error && <ErrorNote message={missed.error} />}
      </div>

      <div data-tour="summary">
        <AnalysisView analysis={analysis} />
      </div>
    </section>
  );
}

function AnalysisView({ analysis }: { analysis: AnalysisResult | null }) {
  if (!analysis) {
    return (
      <div className="panel">
        <h3 className="eyebrow">Caregiver summary</h3>
        <p className="text-muted">No analysis yet for this call. At the end of a check-in the agent sends the record to a fresh Daytona sandbox, and the result appears here and is read out before goodbye.</p>
      </div>
    );
  }
  const s = analysis.summary;
  return (
    <div className="panel reveal" key={analysis.call_id}>
      <div className="summary-head">
        <h3 className="eyebrow">Caregiver summary</h3>
        <SandboxChip id={analysis.sandbox_id} ms={analysis.sandbox_ms} />
      </div>
      <div className="summary-status">
        <StatusLight status={s.status} large />
        <p className="summary-today">{s.today}</p>
      </div>

      <div className="summary-grid">
        <SummaryBlock title="What changed" items={s.what_changed} empty="Nothing new against baseline." />
        <div>
          <h4 className="summary-title">Medications</h4>
          <p>{s.medications || "No medication notes."}</p>
        </div>
        <SummaryBlock title="Patterns to watch" items={s.patterns_to_watch} empty="None." />
        <div>
          <h4 className="summary-title">In their words</h4>
          <blockquote className="quote">{s.in_their_words ? `“${s.in_their_words}”` : "—"}</blockquote>
          <p className="text-muted">Next call: {s.next_call}</p>
        </div>
      </div>

      <h3 className="eyebrow findings-title">Engine findings</h3>
      {analysis.findings.length === 0 ? (
        <p className="text-muted">No concerning patterns found.</p>
      ) : (
        <ul className="findings">
          {analysis.findings.map((f, i) => (
            <li key={`${f.pattern}-${i}`} className={`finding finding-${f.severity}`}>
              <div className="finding-head">
                <strong>{f.pattern}</strong>
                <span className={`attr-badge attr-${f.attribution}`}>{ATTRIBUTION_LABEL[f.attribution] ?? f.attribution}</span>
              </div>
              <p>{f.reason}</p>
              {f.evidence.length > 0 && <p className="text-muted evidence">Evidence: {f.evidence.join(" · ")}</p>}
            </li>
          ))}
        </ul>
      )}
      {analysis.trend_flags.length > 0 && (
        <p className="text-muted trend-flags">Trend flags: {analysis.trend_flags.join(" · ")}</p>
      )}
    </div>
  );
}

function SummaryBlock({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <h4 className="summary-title">{title}</h4>
      {items.length === 0 ? (
        <p className="text-muted">{empty}</p>
      ) : (
        <ul className="bullets">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Seed names already start with "Nurse"; avoid "Nurse Nurse Sam". */
export function nurseName(name: string): string {
  return name.replace(/^nurse\s+/i, "");
}

"use client";

import { useState } from "react";
import type { Alert, PatientState } from "@/lib/types";
import { formatClock, formatWhen, nurseName } from "./client-api";
import { ErrorNote, Spinner } from "./ui";
import { WhyThisFlag } from "./WhyThisFlag";

export type AlertAction = { action: "acknowledge" | "resolve"; note?: string };

export function AlertQueue({
  alerts,
  patients,
  onAction,
}: {
  alerts: Alert[];
  patients: PatientState[];
  onAction: (alert: Alert, by: string, a: AlertAction) => Promise<void>;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const active = alerts.filter((a) => a.status !== "resolved");
  const resolved = alerts.filter((a) => a.status === "resolved");
  const byId = new Map(patients.map((s) => [s.patient.id, s.patient]));
  const stateById = new Map(patients.map((s) => [s.patient.id, s]));

  return (
    <section className="panel alert-queue" aria-labelledby="alerts-title" aria-live="polite">
      <h2 id="alerts-title" className="queue-title">
        Alert queue <span className="queue-count">{active.length} active</span>
      </h2>
      {active.length === 0 && <p className="text-muted">No active alerts.</p>}
      <ul className="alert-list">
        {active.map((a) => (
          <AlertItem key={a.id} alert={a} patientName={byId.get(a.patient_id)?.name ?? a.patient_id} nurse={byId.get(a.patient_id)?.nurse.name ?? "Nurse"} state={stateById.get(a.patient_id)} onAction={onAction} />
        ))}
      </ul>
      {resolved.length > 0 && (
        <div className="resolved">
          <button type="button" className="btn-link" onClick={() => setShowResolved((v) => !v)} aria-expanded={showResolved}>
            {showResolved ? "Hide" : "Show"} resolved ({resolved.length})
          </button>
          {showResolved && (
            <ul className="alert-list">
              {resolved.map((a) => (
                <AlertItem key={a.id} alert={a} patientName={byId.get(a.patient_id)?.name ?? a.patient_id} nurse={byId.get(a.patient_id)?.nurse.name ?? "Nurse"} state={stateById.get(a.patient_id)} onAction={onAction} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function AlertItem({
  alert,
  patientName,
  nurse,
  state,
  onAction,
}: {
  alert: Alert;
  patientName: string;
  nurse: string;
  state: PatientState | undefined;
  onAction: (alert: Alert, by: string, a: AlertAction) => Promise<void>;
}) {
  const [busy, setBusy] = useState<null | "acknowledge" | "resolve" | "note">(null);
  const [error, setError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  async function run(kind: "acknowledge" | "resolve" | "note") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "note") {
        // The store has no separate note action; a note is recorded with an acknowledge.
        await onAction(alert, nurse, { action: "acknowledge", note: note.trim() });
        setNote("");
        setNoteOpen(false);
      } else {
        await onAction(alert, nurse, { action: kind });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the alert.");
    } finally {
      setBusy(null);
    }
  }

  const resolved = alert.status === "resolved";
  return (
    <li className={`alert-item sev-${alert.severity} ${resolved ? "alert-resolved" : ""}`}>
      <div className="alert-head">
        <span className={`sev-badge sev-badge-${alert.severity}`}>{alert.severity}</span>
        <span className="alert-time" title={alert.created_at}>
          {formatClock(alert.created_at)} · {formatWhen(alert.created_at)}
        </span>
      </div>
      <p className="alert-title">{alert.title}</p>
      <p className="alert-patient">{patientName}</p>
      {alert.quote && <blockquote className="quote">&ldquo;{alert.quote}&rdquo;</blockquote>}
      {alert.detail && <p className="alert-detail">{alert.detail}</p>}

      {alert.sms_log.length > 0 && (
        <ul className="sms-log" aria-label="Simulated SMS log">
          {alert.sms_log.map((m, i) => (
            <li key={i}>
              <span className="sms-tag">Simulated SMS</span> to {m.to} {nurseName(m.name)}: {m.text}
            </li>
          ))}
        </ul>
      )}

      <WhyThisFlag alert={alert} state={state} />

      <p className="alert-status">
        Status: <strong>{alert.status}</strong>
        {alert.acknowledged_by ? ` by ${alert.acknowledged_by}` : ""}
      </p>
      {alert.notes.length > 0 && (
        <ul className="notes">
          {alert.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      {!resolved && (
        <div className="alert-actions">
          {alert.status === "open" && (
            <button type="button" className="btn-quiet" disabled={busy !== null} onClick={() => run("acknowledge")}>
              {busy === "acknowledge" ? <Spinner label="Saving…" /> : "Acknowledge"}
            </button>
          )}
          <button type="button" className="btn-quiet" disabled={busy !== null} onClick={() => setNoteOpen((v) => !v)} aria-expanded={noteOpen}>
            Add note
          </button>
          <button type="button" className="btn-quiet" disabled={busy !== null} onClick={() => run("resolve")}>
            {busy === "resolve" ? <Spinner label="Saving…" /> : "Resolve"}
          </button>
        </div>
      )}
      {noteOpen && !resolved && (
        <form
          className="note-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) void run("note");
          }}
        >
          <label className="sr-only" htmlFor={`note-${alert.id}`}>
            Note
          </label>
          <input
            id={`note-${alert.id}`}
            className="note-input"
            value={note}
            maxLength={500}
            placeholder="e.g. Called daughter, she is on her way"
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="submit" className="btn-quiet" disabled={busy !== null || !note.trim()}>
            {busy === "note" ? <Spinner label="Saving…" /> : "Save note"}
          </button>
        </form>
      )}
      {error && <ErrorNote message={error} />}
    </li>
  );
}

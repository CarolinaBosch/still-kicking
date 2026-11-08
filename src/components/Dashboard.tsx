"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Alert, MissedCallResult, PatientState, TestRunResult } from "@/lib/types";
import { AlertQueue, type AlertAction } from "./AlertQueue";
import { api, sortAlerts } from "./client-api";
import { PatientDetail, type MissedState } from "./PatientDetail";
import { PatientList } from "./PatientList";
import { ErrorNote, SandboxChip, Spinner } from "./ui";

const POLL_MS = 3000;
const NO_MISSED: MissedState = { busy: false, error: null, lastAlert: null };

type TestState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; result: TestRunResult }
  | { phase: "error"; message: string };

export default function Dashboard() {
  const [patients, setPatients] = useState<PatientState[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [devFixture, setDevFixture] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Alerts raised during a call show instantly, before the next poll picks them up.
  const [liveAlerts, setLiveAlerts] = useState<Alert[]>([]);
  const [missed, setMissed] = useState<Record<string, MissedState>>({});
  const [tests, setTests] = useState<TestState>({ phase: "idle" });
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const { data, devFixture: fx } = await api<PatientState[]>("/api/patients", { timeoutMs: 20_000 });
      setPatients(data);
      setDevFixture(fx);
      setLoadError(null);
      setSelectedId((cur) => cur ?? data[0]?.patient.id ?? null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load patients.");
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const alerts = useMemo(() => {
    const merged = new Map<string, Alert>();
    for (const a of liveAlerts) merged.set(a.id, a);
    for (const s of patients ?? []) for (const a of s.alerts) merged.set(a.id, a); // server copy wins
    return sortAlerts([...merged.values()]);
  }, [patients, liveAlerts]);

  const selected = patients?.find((s) => s.patient.id === selectedId) ?? null;

  const upsertAlert = useCallback((a: Alert) => {
    setLiveAlerts((cur) => [a, ...cur.filter((x) => x.id !== a.id)]);
    setPatients((cur) =>
      cur?.map((s) =>
        s.patient.id === a.patient_id
          ? { ...s, alerts: s.alerts.some((x) => x.id === a.id) ? s.alerts.map((x) => (x.id === a.id ? a : x)) : [...s.alerts, a] }
          : s,
      ) ?? cur,
    );
  }, []);

  async function onMissedCall(patientId: string) {
    setMissed((cur) => ({ ...cur, [patientId]: { ...(cur[patientId] ?? NO_MISSED), busy: true, error: null } }));
    try {
      const { data } = await api<MissedCallResult>("/api/calls/missed", { method: "POST", body: { patient_id: patientId } });
      if (data.alert) upsertAlert(data.alert);
      setMissed((cur) => ({ ...cur, [patientId]: { busy: false, error: null, lastAlert: data.alert ?? cur[patientId]?.lastAlert ?? null } }));
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not record the missed call.";
      setMissed((cur) => ({ ...cur, [patientId]: { ...(cur[patientId] ?? NO_MISSED), busy: false, error: message } }));
    }
  }

  async function onAlertAction(alert: Alert, by: string, a: AlertAction) {
    const { data } = await api<Alert>(`/api/alerts/${encodeURIComponent(alert.id)}`, {
      method: "POST",
      body: { action: a.action, by, ...(a.note ? { note: a.note } : {}) },
    });
    upsertAlert(data);
  }

  async function runTests() {
    setTests({ phase: "running" });
    try {
      const { data } = await api<TestRunResult>("/api/tests/run", { method: "POST", timeoutMs: 180_000 });
      setTests({ phase: "done", result: data });
    } catch (err) {
      setTests({ phase: "error", message: err instanceof Error ? err.message : "The test run failed." });
    }
  }

  async function resetDemo() {
    if (!window.confirm("Reset the demo? This clears new calls and alerts and restores the 3 seeded patients.")) return;
    setResetting(true);
    setResetError(null);
    try {
      await api<{ ok: true }>("/api/demo/reset", { method: "POST", timeoutMs: 60_000 });
      setLiveAlerts([]);
      setMissed({});
      setTests({ phase: "idle" });
      await refresh();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Could not reset the demo.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="shell">
      <header className="site-header">
        <div>
          <h1 className="brand">Still Kicking <span className="brand-sub">Nurse dashboard</span></h1>
          <p className="tagline">A warm daily nurse check-in for older adults living at home.</p>
        </div>
        <p className="disclaimer">Prototype. Not a medical device. Not a replacement for 911. Synthetic patients.</p>
      </header>

      <section className="pitch" aria-label="Who this is for">
        <div className="pitch-card">
          <h2 className="pitch-label">User</h2>
          <p>An older adult living alone with a chronic condition, and their worried family caregiver.</p>
        </div>
        <div className="pitch-card">
          <h2 className="pitch-label">Finish line</h2>
          <p>After every call, the nurse and caregiver know what changed in plain words, and get alerted immediately if it&rsquo;s serious.</p>
        </div>
        <div className="pitch-card">
          <h2 className="pitch-label">How</h2>
          <p>ElevenLabs agent &rarr; tool calls &rarr; Daytona sandbox &rarr; result spoken in the same call.</p>
        </div>
      </section>

      {devFixture && (
        <p className="fixture-banner" role="status">
          Dev fixture data: the Daytona store is not implemented yet, so this page shows in-memory sample data.
        </p>
      )}

      <section className="demo-bar" aria-label="Demo controls">
        <span className="eyebrow">Demo controls</span>
        <button type="button" className="btn" onClick={runTests} disabled={tests.phase === "running"}>
          {tests.phase === "running" ? <Spinner label="Running tests in Daytona…" /> : "Run tests in Daytona"}
        </button>
        <button type="button" className="btn-quiet" onClick={resetDemo} disabled={resetting}>
          {resetting ? <Spinner label="Resetting…" /> : "Reset demo"}
        </button>
        <TestResultView state={tests} />
        {resetError && <ErrorNote message={resetError} />}
      </section>

      {loadError && <ErrorNote message={`${loadError} Retrying every few seconds.`} onRetry={() => void refresh()} />}

      {!patients ? (
        <div className="layout" aria-busy="true">
          <div className="col-patients">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton skeleton-card" />
            ))}
          </div>
          <div className="col-detail">
            <div className="skeleton skeleton-detail" />
          </div>
          <div className="col-alerts">
            <div className="skeleton skeleton-detail" />
          </div>
        </div>
      ) : (
        <div className="layout">
          <div className="col-patients">
            <h2 className="eyebrow">Patients</h2>
            <PatientList patients={patients} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
          <div className="col-detail">
            {selected ? (
              <PatientDetail
                state={selected}
                analysis={selected.last_analysis}
                missed={missed[selected.patient.id] ?? NO_MISSED}
                onMissedCall={() => void onMissedCall(selected.patient.id)}
              />
            ) : (
              <p className="panel text-muted">Select a patient.</p>
            )}
          </div>
          <div className="col-alerts">
            <AlertQueue alerts={alerts} patients={patients} onAction={onAlertAction} />
          </div>
        </div>
      )}

      <footer className="demo-footer">
        <a href={DEMO_VIDEO_URL} target="_blank" rel="noopener noreferrer">
          Watch the 2-minute demo video
        </a>
        <span aria-hidden="true"> · </span>
        <a href="https://github.com/CarolinaBosch/still-kicking" target="_blank" rel="noopener noreferrer">
          Code on GitHub
        </a>
        <span aria-hidden="true"> · </span>
        <a href="/slides/" target="_blank" rel="noopener noreferrer">
          Slides
        </a>
      </footer>
    </div>
  );
}

const DEMO_VIDEO_URL = "https://www.loom.com/share/ecdde797d42845019106adb87be5bd30";

function TestResultView({ state }: { state: TestState }) {
  if (state.phase === "error") return <ErrorNote message={state.message} />;
  if (state.phase !== "done") return null;
  const r = state.result;
  const allPassed = r.failed === 0 && r.passed > 0;
  return (
    <div className="test-result">
      <span className={`test-count ${allPassed ? "test-pass" : "test-fail"}`}>
        {r.passed} passed · {r.failed} failed
      </span>
      <SandboxChip id={r.sandbox_id} ms={r.sandbox_ms} label="pytest in Daytona sandbox" />
      <details className="test-output">
        <summary>Output</summary>
        <pre>{r.output_tail}</pre>
      </details>
    </div>
  );
}

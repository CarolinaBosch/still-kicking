"use client";

import { useState } from "react";
import type { PatientState } from "@/lib/types";
import { formatWhen } from "./client-api";
import { HistoryStrip, StatusLight } from "./ui";

export function PatientList({
  patients,
  selectedId,
  onSelect,
}: {
  patients: PatientState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [sort, setSort] = useState<PatientSort>("priority");
  const sorted = sortPatients(patients, sort);
  return (
    <>
    <div className="sort-control">
      <label htmlFor="patient-sort">Sort patients by</label>
      <select id="patient-sort" value={sort} onChange={(e) => setSort(e.target.value as PatientSort)}>
        <option value="priority">Alert priority</option>
        <option value="next_call">Next scheduled call</option>
      </select>
      <p className="sort-note" aria-live="polite">
        {sort === "priority"
          ? "Sorted by alert priority (open alerts), not a clinical severity score."
          : "Sorted by next scheduled call, soonest first. Patients without a readable time are last."}
      </p>
    </div>
    <ul className="patient-list" aria-label="Patients">
      {sorted.map((s) => {
        const p = s.patient;
        const last = s.history[s.history.length - 1];
        const openAlerts = s.alerts.filter((a) => a.status !== "resolved").length;
        const selected = p.id === selectedId;
        return (
          <li key={p.id}>
            <button
              type="button"
              className={`patient-card card-${s.status} ${selected ? "patient-card-selected" : ""}`}
              aria-pressed={selected}
              onClick={() => onSelect(p.id)}
            >
              <span className="patient-card-top">
                <span>
                  <span className="patient-name">{p.name}</span>
                  <span className="patient-meta">
                    {p.age} · {p.conditions.join(", ")}
                  </span>
                </span>
                <span className="alert-head-left">
                  {selected && <span className="selected-tag">Selected</span>}
                  <StatusLight status={s.status} />
                </span>
              </span>
              <HistoryStrip history={s.history} />
              <span className="patient-card-foot">
                <span>Last check-in: {formatWhen(last?.timestamp)}</span>
                <span>Next call: {p.next_call_time}</span>
              </span>
              {openAlerts > 0 && (
                <span className="card-alert-count">
                  {openAlerts} open alert{openAlerts === 1 ? "" : "s"}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
    </>
  );
}

export type PatientSort = "priority" | "next_call";

/** 0 = open emergency/urgent alert, 1 = other open alerts, 2 = none. Alert categories only. */
export function alertTier(s: PatientState): number {
  const open = s.alerts.filter((a) => a.status !== "resolved");
  if (open.some((a) => a.severity === "emergency" || a.severity === "urgent")) return 0;
  return open.length > 0 ? 1 : 2;
}

/** "tomorrow at 9:30 AM" -> day offset * 1440 + minutes. Unparseable or missing -> Infinity. */
export function nextCallKey(text: string | null | undefined): number {
  const m = /^\s*(today|tomorrow)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\s*$/i.exec(text ?? "");
  if (!m) return Infinity;
  const hour = Number(m[2]);
  const min = Number(m[3] ?? 0);
  if (hour < 1 || hour > 12 || min > 59) return Infinity;
  const h24 = (hour % 12) + (m[4].toLowerCase() === "p" ? 12 : 0);
  return (m[1].toLowerCase() === "tomorrow" ? 1440 : 0) + h24 * 60 + min;
}

/** Stable: ties keep the original order. */
export function sortPatients(patients: PatientState[], sort: PatientSort): PatientState[] {
  const key = sort === "priority" ? alertTier : (s: PatientState) => nextCallKey(s.patient.next_call_time);
  return patients
    .map((s, i) => ({ s, i, k: key(s) }))
    .sort((a, b) => (a.k === b.k ? a.i - b.i : a.k < b.k ? -1 : 1))
    .map((x) => x.s);
}

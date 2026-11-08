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
  return (
    <ul className="patient-list" aria-label="Patients">
      {patients.map((s) => {
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
                <StatusLight status={s.status} />
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
  );
}

// Traffic light for the dashboard, derived from open alerts and the latest analysis.

import type { CheckinRecord, PatientState, TrafficLight } from "../types";

/** Before any analysis ran (fresh seed): yellow if the latest call had any positive Stop and Watch item. */
function fromLatestRecord(record: CheckinRecord | undefined): TrafficLight {
  if (!record) return "green";
  if (record.red_flags.length > 0) return "red";
  const anyPositive = Object.values(record.stop_and_watch).some((v) => v === true);
  return anyPositive || record.orientation_correct === false ? "yellow" : "green";
}

export function computeStatus(state: PatientState): TrafficLight {
  const open = state.alerts.filter((a) => a.status !== "resolved");
  if (open.some((a) => a.severity === "emergency" || a.severity === "urgent")) return "red";
  const base = state.last_analysis?.summary.status ?? fromLatestRecord(state.history.at(-1));
  if (base === "red" && state.last_analysis && open.length === 0) return "yellow"; // nurse resolved the alerts
  if (open.length > 0 && base === "green") return "yellow";
  return base;
}

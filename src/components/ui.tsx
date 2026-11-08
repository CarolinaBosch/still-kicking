import type { CheckinRecord, TrafficLight } from "@/lib/types";
import { LIGHT_LABEL, dayStatus, formatDay } from "./client-api";

export function StatusLight({ status, large = false }: { status: TrafficLight; large?: boolean }) {
  return (
    <span className={`status-light status-${status} ${large ? "status-large" : ""}`}>
      <span className="status-dot" aria-hidden />
      {LIGHT_LABEL[status]}
    </span>
  );
}

export function HistoryStrip({ history }: { history: CheckinRecord[] }) {
  const last = history.slice(-14);
  const pad = Math.max(0, 14 - last.length);
  return (
    <div className="strip" role="img" aria-label={`Last ${last.length} check-ins`}>
      {Array.from({ length: pad }, (_, i) => (
        <span key={`pad${i}`} className="strip-dot strip-none" title="No check-in" />
      ))}
      {last.map((r) => {
        const s = dayStatus(r);
        return <span key={r.call_id} className={`strip-dot strip-${s}`} title={`${formatDay(r.timestamp)}: ${LIGHT_LABEL[s]}`} />;
      })}
    </div>
  );
}

export function SandboxChip({ id, ms, label = "Analyzed in Daytona sandbox" }: { id: string; ms: number; label?: string }) {
  const fixture = id === "dev-fixture";
  return (
    <span className={`sandbox-chip ${fixture ? "sandbox-chip-fixture" : ""}`} title={id}>
      {fixture ? (
        "Dev fixture: not run in Daytona"
      ) : (
        <>
          {label} <strong>{id}</strong> in <strong>{Math.round(ms).toLocaleString()} ms</strong>
        </>
      )}
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden />
      {label}
    </span>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-note" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn-quiet" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

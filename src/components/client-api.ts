// Browser-side fetch helpers for the dashboard. No secrets here: everything goes through our API routes.
import type { Alert, CheckinRecord, TrafficLight } from "@/lib/types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface ApiResult<T> {
  data: T;
  devFixture: boolean;
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; timeoutMs?: number }): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(init?.timeoutMs ?? 30_000),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new ApiError(timedOut ? "The server took too long to answer." : "Could not reach the server.", 0);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const msg = (json as { error?: unknown } | null)?.error;
    throw new ApiError(typeof msg === "string" ? msg : `Request failed (${res.status}).`, res.status);
  }
  return { data: json as T, devFixture: res.headers.get("x-dev-fixture") === "1" };
}

/** Day status for the 14-day strip, from one check-in record. */
export function dayStatus(r: CheckinRecord): TrafficLight {
  if (r.red_flags.some((f) => f.severity === "emergency" || f.severity === "urgent")) return "red";
  const sw = Object.values(r.stop_and_watch).some((v) => v === true);
  const meds = r.medication_adherence.all_taken === false || r.medication_adherence.missed.length > 0;
  if (
    r.red_flags.length > 0 ||
    sw ||
    meds ||
    r.orientation_correct === false ||
    r.pain.new_or_worse === true ||
    (r.phq2_score ?? 0) >= 3
  ) {
    return "yellow";
  }
  return "green";
}

export const LIGHT_LABEL: Record<TrafficLight, string> = {
  green: "Stable",
  yellow: "Watch",
  red: "Needs attention",
};

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "unknown";
  const diff = Date.now() - t;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function formatClock(iso: string): string {
  const t = new Date(iso);
  return Number.isFinite(t.getTime()) ? t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
}

export function formatDay(iso: string): string {
  const t = new Date(iso);
  return Number.isFinite(t.getTime()) ? t.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "";
}

const SEVERITY_RANK: Record<Alert["severity"], number> = { emergency: 0, urgent: 1, watch: 2 };

/** Active first, emergencies on top, newest first within each severity. */
export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => {
    const ra = a.status === "resolved" ? 1 : 0;
    const rb = b.status === "resolved" ? 1 : 0;
    if (ra !== rb) return ra - rb;
    if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
}

/** Consecutive unanswered attempts at the end of the attempt log. */
export function consecutiveMissed(attempts: { answered: boolean }[]): number {
  let n = 0;
  for (let i = attempts.length - 1; i >= 0 && !attempts[i].answered; i--) n++;
  return n;
}

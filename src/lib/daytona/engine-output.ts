// Validation of engine output. The engine runs inside a sandbox, so everything
// it prints is untrusted: unknown fields are dropped, enums are checked, strings
// and lists are capped. Anything malformed rejects the whole result.

import type { Attribution, CaregiverSummary, PatternFinding, Severity, TrafficLight } from "../types";

export const OUTPUT_MARKER = "__STILL_KICKING__";

export interface AlertDraft {
  severity: Severity;
  kind: "red_flag" | "pattern";
  title: string;
  detail: string;
  quote: string | null;
}

export interface EngineOutput {
  status: TrafficLight;
  findings: PatternFinding[];
  trend_flags: string[];
  summary: CaregiverSummary;
  alerts: AlertDraft[];
}

const SEVERITIES: readonly Severity[] = ["emergency", "urgent", "watch"];
const LIGHTS: readonly TrafficLight[] = ["green", "yellow", "red"];
const ATTRIBUTIONS: readonly Attribution[] = ["likely_adherence_related", "likely_clinical_change", "unclear"];
const ALERT_KINDS: readonly AlertDraft["kind"][] = ["red_flag", "pattern"];

class InvalidOutput extends Error {}

function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new InvalidOutput(`${what} is not an object`);
  return v as Record<string, unknown>;
}

function str(v: unknown, what: string, max = 400): string {
  if (typeof v !== "string") throw new InvalidOutput(`${what} is not a string`);
  return v.slice(0, max);
}

function optStr(v: unknown, what: string, max = 400): string | null {
  return v === null || v === undefined ? null : str(v, what, max);
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], what: string): T {
  if (typeof v !== "string" || !allowed.includes(v as T)) throw new InvalidOutput(`${what} is not allowed`);
  return v as T;
}

function list<T>(v: unknown, what: string, max: number, each: (item: unknown, what: string) => T): T[] {
  if (!Array.isArray(v)) throw new InvalidOutput(`${what} is not a list`);
  return v.slice(0, max).map((item, i) => each(item, `${what}[${i}]`));
}

const strItem = (max: number) => (v: unknown, what: string) => str(v, what, max);

function finding(v: unknown, what: string): PatternFinding {
  const o = obj(v, what);
  return {
    pattern: str(o.pattern, `${what}.pattern`, 120),
    evidence: list(o.evidence, `${what}.evidence`, 8, strItem(200)),
    attribution: oneOf(o.attribution, ATTRIBUTIONS, `${what}.attribution`),
    reason: str(o.reason, `${what}.reason`, 300),
    severity: oneOf(o.severity, SEVERITIES, `${what}.severity`),
  };
}

function summary(v: unknown): CaregiverSummary {
  const o = obj(v, "summary");
  return {
    status: oneOf(o.status, LIGHTS, "summary.status"),
    today: str(o.today, "summary.today", 300),
    what_changed: list(o.what_changed, "summary.what_changed", 6, strItem(200)),
    medications: str(o.medications, "summary.medications", 300),
    patterns_to_watch: list(o.patterns_to_watch, "summary.patterns_to_watch", 6, strItem(200)),
    in_their_words: str(o.in_their_words, "summary.in_their_words", 300),
    next_call: str(o.next_call, "summary.next_call", 120),
  };
}

function alertDraft(v: unknown, what: string): AlertDraft {
  const o = obj(v, what);
  return {
    severity: oneOf(o.severity, SEVERITIES, `${what}.severity`),
    kind: oneOf(o.kind, ALERT_KINDS, `${what}.kind`),
    title: str(o.title, `${what}.title`, 120),
    detail: str(o.detail, `${what}.detail`, 600),
    quote: optStr(o.quote, `${what}.quote`, 300),
  };
}

/**
 * Finds the marker line in stdout and validates it.
 * Throws Error with a developer-facing reason; callers wrap it in a speakable StoreError.
 */
export function parseEngineOutput(stdout: string, exitCode: number): EngineOutput {
  const line = stdout.split("\n").reverse().find((l) => l.startsWith(OUTPUT_MARKER));
  if (!line) throw new Error(`no result line (exit ${exitCode}): ${stdout.slice(0, 300)}`);
  const o = obj(JSON.parse(line.slice(OUTPUT_MARKER.length)), "engine output");
  if (typeof o.error === "string" || exitCode !== 0) throw new Error(`engine error: ${String(o.error ?? `exit ${exitCode}`)}`);
  return {
    status: oneOf(o.status, LIGHTS, "status"),
    findings: list(o.findings, "findings", 10, finding),
    trend_flags: list(o.trend_flags, "trend_flags", 20, strItem(200)),
    summary: summary(o.summary),
    alerts: list(o.alerts, "alerts", 10, alertDraft),
  };
}

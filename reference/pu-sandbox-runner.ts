// Daytona universe runner for Parallel Universes.
//
// SERVER ONLY: reads DAYTONA_API_KEY and uses node:fs. Import from API routes only.
//
// Lifecycle: one fresh sandbox per option ("universe"), all created in parallel,
// each deleted in its own `finally`. fork() is not available on this account, so
// every universe is created from the default snapshot and gets the same
// world.json (baseline + its option). Backstops if `finally` never runs (process
// killed): sandboxes are ephemeral with a 5 minute auto-stop.
//
// No host secrets go into the sandbox: no env vars, only universe.py and
// world.json. Sandbox output is untrusted: id and label come from the request,
// every number is checked for type, range and array length.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Daytona, type Sandbox } from "@daytona/sdk";
import type { DecisionOption, SimulateRequest, SimulateResponse, UniverseResult } from "../types";

const DEFAULT_API_URL = "https://app.daytona.io/api";
const SCRIPT_PATH = path.join(process.cwd(), "sandbox", "universe.py");
const REMOTE_DIR = "/home/daytona";
const OUTPUT_MARKER = "__PU_JSON__";
const APP_LABEL = "parallel-universes";

const CREATE_TIMEOUT_S = 20;
const UPLOAD_TIMEOUT_S = 10;
const RUN_TIMEOUT_S = 15;
const DELETE_TIMEOUT_S = 15;
const TOTAL_BUDGET_MS = 30_000;
const CLEANUP_WAIT_MS = 8_000;
const AUTO_STOP_MINUTES = 5;

const DEFAULT_HORIZON = 24;
const MAX_HORIZON = 60;
const DEFAULT_RUNS = 2000;
const MAX_RUNS = 10_000;
const MIN_RUNS = 100;
const MAX_MONEY = 1e12;

let client: Daytona | null = null;
let scriptCache: Buffer | null = null;

class SpeakableError extends Error {}

function speakable(message: string, cause?: unknown): SpeakableError {
  return new SpeakableError(message, cause === undefined ? undefined : { cause });
}

function errText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

function getClient(): Daytona {
  if (!process.env.DAYTONA_API_KEY) throw speakable("The universe simulator is not configured.");
  if (!client) {
    // Always pass apiUrl: with DAYTONA_API_URL in env (even empty) SDK 0.231.0
    // throws "The Daytona API endpoint is ambiguous".
    client = new Daytona({
      apiKey: process.env.DAYTONA_API_KEY,
      apiUrl: process.env.DAYTONA_API_URL || DEFAULT_API_URL,
    });
  }
  return client;
}

async function loadScript(): Promise<Buffer> {
  if (!scriptCache) scriptCache = await readFile(SCRIPT_PATH);
  return scriptCache;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(speakable(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------- request validation ----------

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

interface NormalizedRequest {
  decision: string;
  baseline: SimulateRequest["baseline"];
  options: DecisionOption[];
  horizon: number;
  runs: number;
  seed: number;
}

function normalize(req: SimulateRequest): NormalizedRequest {
  if (!req || typeof req !== "object") throw speakable("I need a decision to simulate.");
  const b = req.baseline;
  if (!b || typeof b !== "object") throw speakable("I need your cash, monthly revenue and monthly costs.");
  const baseline = {
    cash: num(b.cash, NaN, -MAX_MONEY, MAX_MONEY),
    monthly_revenue: num(b.monthly_revenue, NaN, 0, MAX_MONEY),
    monthly_costs: num(b.monthly_costs, NaN, 0, MAX_MONEY),
  };
  if (Object.values(baseline).some((v) => Number.isNaN(v))) {
    throw speakable("I need your cash, monthly revenue and monthly costs as numbers.");
  }

  const raw = Array.isArray(req.options) ? req.options.filter((o) => o && typeof o === "object") : [];
  if (raw.length < 2) throw speakable("I need at least two options to compare.");
  if (raw.length > 4) throw speakable("I can compare up to four options at a time.");

  const used = new Set<string>();
  const options = raw.map((o, i): DecisionOption => {
    let id = typeof o.id === "string" && o.id.trim() ? o.id.trim().slice(0, 16) : "";
    if (!id || used.has(id)) id = "abcd"[i];
    used.add(id);
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, 120) : `Option ${id}`;
    return {
      id,
      label,
      extra_monthly_cost: num(o.extra_monthly_cost, 0, -MAX_MONEY, MAX_MONEY),
      one_time_cost: num(o.one_time_cost, 0, -MAX_MONEY, MAX_MONEY),
      growth_mean: num(o.growth_mean, 0, -0.5, 1),
      growth_sd: num(o.growth_sd, 0, 0, 1),
    };
  });

  const horizon = Math.round(num(req.horizon_months, DEFAULT_HORIZON, 1, MAX_HORIZON));
  const runs = Math.round(num(req.runs, DEFAULT_RUNS, MIN_RUNS, MAX_RUNS));
  const decision = typeof req.decision === "string" ? req.decision.trim().slice(0, 500) : "";

  // Same seed in every universe (common random numbers): differences between
  // universes come from the options, not from luck. Derived from the request so
  // the same question gives the same answer.
  const seed = fnv1a(JSON.stringify({ baseline, options, horizon, runs }));
  return { decision, baseline, options, horizon, runs, seed };
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------- sandbox output validation ----------

function parseOutput(stdout: string, exitCode: number, label: string): Record<string, unknown> {
  const line = stdout.split("\n").reverse().find((l) => l.startsWith(OUTPUT_MARKER));
  if (!line) throw speakable(`The universe for "${label}" returned no result.`, new Error(`exit ${exitCode}: ${stdout.slice(0, 300)}`));
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(OUTPUT_MARKER.length));
  } catch (err) {
    throw speakable(`The universe for "${label}" returned an unreadable result.`, err);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw speakable(`The universe for "${label}" returned an unreadable result.`);
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.error === "string" || exitCode !== 0) {
    throw speakable(`The simulation for "${label}" failed.`, new Error(String(obj.error ?? `exit ${exitCode}`)));
  }
  return obj;
}

function finite(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`bad ${what}`);
  return value;
}

function series(value: unknown, len: number, what: string): number[] {
  if (!Array.isArray(value) || value.length !== len) throw new Error(`bad ${what} length`);
  return value.map((v, i) => Math.round(finite(v, `${what}[${i}]`)));
}

function toResult(out: Record<string, unknown>, opt: DecisionOption, horizon: number, sandboxId: string, ms: number): UniverseResult {
  try {
    const fc = (out.final_cash ?? {}) as Record<string, unknown>;
    const cs = (out.cash_series ?? {}) as Record<string, unknown>;
    const survival = finite(out.survival_prob, "survival_prob");
    const runway = finite(out.median_runway_months, "median_runway_months");
    if (survival < 0 || survival > 1) throw new Error("survival_prob out of range");
    if (runway < 0 || runway > horizon) throw new Error("median_runway_months out of range");
    return {
      id: opt.id,
      label: opt.label,
      survival_prob: survival,
      median_runway_months: runway,
      final_cash: {
        p10: Math.round(finite(fc.p10, "final_cash.p10")),
        p50: Math.round(finite(fc.p50, "final_cash.p50")),
        p90: Math.round(finite(fc.p90, "final_cash.p90")),
      },
      final_revenue_p50: Math.round(finite(out.final_revenue_p50, "final_revenue_p50")),
      cash_series: {
        p10: series(cs.p10, horizon + 1, "cash_series.p10"),
        p50: series(cs.p50, horizon + 1, "cash_series.p50"),
        p90: series(cs.p90, horizon + 1, "cash_series.p90"),
      },
      sandbox_id: sandboxId.slice(0, 8),
      sandbox_ms: ms,
    };
  } catch (err) {
    throw speakable(`The universe for "${opt.label}" returned numbers I can't trust.`, err);
  }
}

// ---------- one universe ----------

async function destroy(daytona: Daytona, sandbox: Sandbox): Promise<void> {
  try {
    await daytona.delete(sandbox, DELETE_TIMEOUT_S);
  } catch (err) {
    console.error("[universes] delete failed, stopping instead", sandbox.id, errText(err));
    // Ephemeral sandboxes are deleted when they stop.
    await daytona.stop(sandbox).catch((e) => console.error("[universes] stop failed", sandbox.id, errText(e)));
  }
}

async function runUniverse(daytona: Daytona, script: Buffer, norm: NormalizedRequest, opt: DecisionOption): Promise<UniverseResult> {
  const started = Date.now();
  const labels = { app: APP_LABEL, universe: opt.id };

  // FORK SWITCH POINT: if VM sandboxes get enabled, replace this create() with
  // `daytona.fork(baseSandbox, { name: ... }, CREATE_TIMEOUT_S)` (base holds universe.py).
  const created = daytona.create({ language: "python", ephemeral: true, autoStopInterval: AUTO_STOP_MINUTES, labels }, { timeout: CREATE_TIMEOUT_S });
  created.catch(() => undefined); // avoid unhandled rejection if the overall timeout wins

  try {
    let sandbox: Sandbox;
    try {
      sandbox = await created;
    } catch (err) {
      throw speakable(`I couldn't open the universe for "${opt.label}".`, err);
    }
    const world = { baseline: norm.baseline, option: opt, horizon_months: norm.horizon, runs: norm.runs, seed: norm.seed };
    try {
      await sandbox.fs.uploadFiles(
        [
          { source: script, destination: `${REMOTE_DIR}/universe.py` },
          { source: Buffer.from(JSON.stringify(world)), destination: `${REMOTE_DIR}/world.json` },
        ],
        UPLOAD_TIMEOUT_S,
      );
    } catch (err) {
      throw speakable(`I couldn't send the numbers to the universe for "${opt.label}".`, err);
    }
    let res;
    try {
      res = await sandbox.process.executeCommand("python3 -B universe.py world.json", REMOTE_DIR, undefined, RUN_TIMEOUT_S);
    } catch (err) {
      throw speakable(`The universe for "${opt.label}" did not finish in time.`, err);
    }
    const out = parseOutput(res.result ?? "", res.exitCode, opt.label);
    return toResult(out, opt, norm.horizon, sandbox.id, Date.now() - started);
  } finally {
    const cleanup = created.then((sb) => destroy(daytona, sb)).catch(() => undefined);
    await Promise.race([cleanup, new Promise((r) => setTimeout(r, CLEANUP_WAIT_MS))]);
  }
}

function pickBest(universes: UniverseResult[]): string {
  let best = universes[0];
  for (const u of universes.slice(1)) {
    if (u.survival_prob > best.survival_prob || (u.survival_prob === best.survival_prob && u.final_cash.p50 > best.final_cash.p50)) {
      best = u;
    }
  }
  return best.id;
}

/**
 * Simulate every option of a decision in its own Daytona sandbox, in parallel.
 * Calls onUniverse as each universe finishes (completion order). Resolves with
 * universes in request order. Throws Error with a short speakable message if the
 * request is invalid, any universe fails, or the whole run exceeds ~30 s.
 */
export async function runUniverses(req: SimulateRequest, onUniverse?: (u: UniverseResult) => void): Promise<SimulateResponse> {
  const started = Date.now();
  const norm = normalize(req);
  const daytona = getClient();
  let script: Buffer;
  try {
    script = await loadScript();
  } catch (err) {
    console.error("[universes] cannot read universe.py", errText(err));
    throw speakable("The universe simulator is missing its model.");
  }

  const jobs = norm.options.map((opt) =>
    runUniverse(daytona, script, norm, opt).then((u) => {
      try {
        onUniverse?.(u);
      } catch (err) {
        console.error("[universes] onUniverse callback threw", errText(err));
      }
      return u;
    }),
  );
  jobs.forEach((j) => j.catch(() => undefined));

  try {
    const universes = await withTimeout(Promise.all(jobs), TOTAL_BUDGET_MS, "The universes took too long to report back.");
    return {
      decision: norm.decision,
      horizon_months: norm.horizon,
      universes,
      best_id: pickBest(universes),
      elapsed_ms: Date.now() - started,
    };
  } catch (err) {
    if (err instanceof SpeakableError) {
      console.error(`[universes] ${err.message}`, err.cause ? errText(err.cause) : "");
      throw err;
    }
    console.error("[universes] unexpected error", errText(err));
    throw speakable("The universe simulation failed.", err);
  }
}

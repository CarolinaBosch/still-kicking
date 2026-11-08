"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation, useConversationClientTool } from "@elevenlabs/react";
import type { DecisionOption, SimulateRequest, SimulateResponse, ToolError } from "@/lib/types";

export type ToolName = "simulate_futures";

export interface ConversationProps {
  /** Called when the agent calls a client tool, before the request goes out. */
  onToolStart?: (name: ToolName) => void;
  /**
   * Called with the simulation results. If it returns a Promise (for example one that resolves when
   * the page has finished playing the narrations), the tool waits for it before answering the agent,
   * so the Oracle stays silent during the narrations and gives its verdict right after. The mic is
   * muted while waiting so speaker audio isn't heard as the user. The wait is capped so the agent's
   * 120 s tool timeout is never hit. If it returns nothing, the agent answers immediately.
   */
  onResults?: (res: SimulateResponse) => void | Promise<void>;
  /** Called with a short message when the simulation request fails. */
  onToolError?: (message: string) => void;
  /** Agent output volume, 0 to 1 (default 1). Use it to duck the Oracle under other audio. */
  agentVolume?: number;
  /** Mute the microphone, for example while the page plays audio of its own. */
  micMuted?: boolean;
}

type Turn = { key: string; role: "user" | "agent"; text: string };
type Activity = null | "simulating" | "narrating";

const SIMULATE_TIMEOUT_MS = 30_000; // runs take ~2 s; leave room for cold sandboxes
const TOOL_BUDGET_MS = 112_000; // agent waits 120 s (responseTimeoutSecs in scripts/create-agent.mjs)

function clip(text: string | undefined, max: number): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function toolErrorMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === "TimeoutError") return "it took too long to respond";
  return clip(err instanceof Error ? err.message : String(err), 160);
}

function finite(v: unknown, fallback = Number.NaN): number {
  const n = typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Turns the LLM's tool arguments into a SimulateRequest, or returns a message for the agent. */
function toSimulateRequest(params: Record<string, unknown>): SimulateRequest | string {
  const b = (params.baseline ?? {}) as Record<string, unknown>;
  const baseline = {
    cash: finite(b.cash),
    monthly_revenue: finite(b.monthly_revenue),
    monthly_costs: finite(b.monthly_costs),
  };
  if (![baseline.cash, baseline.monthly_revenue, baseline.monthly_costs].every(Number.isFinite)) {
    return "ERROR: simulate_futures needs baseline cash, monthly_revenue and monthly_costs as numbers. Ask for or assume the missing one, then call again.";
  }
  const raw = Array.isArray(params.options) ? (params.options as Record<string, unknown>[]) : [];
  const options: DecisionOption[] = raw.slice(0, 4).map((o, i) => ({
    id: typeof o.id === "string" && o.id.trim() ? o.id.trim() : "abcd"[i],
    label: typeof o.label === "string" && o.label.trim() ? clip(o.label.trim(), 60) : `Option ${i + 1}`,
    extra_monthly_cost: finite(o.extra_monthly_cost, 0),
    one_time_cost: finite(o.one_time_cost, 0),
    growth_mean: finite(o.growth_mean, 0),
    growth_sd: Math.abs(finite(o.growth_sd, 0.03)),
  }));
  if (options.length < 2) {
    return 'ERROR: simulate_futures needs at least two options, including "Change nothing". Call again with all options.';
  }
  const horizon = finite(params.horizon_months, 24);
  const runs = finite(params.runs, 2000);
  return {
    decision: typeof params.decision === "string" ? clip(params.decision.trim(), 300) : "",
    baseline,
    options,
    horizon_months: Math.min(Math.max(Math.round(horizon), 1), 60),
    runs: Math.min(Math.max(Math.round(runs), 100), 10_000),
  };
}

/** Compact result for the LLM: rounded numbers only, no sandbox ids or series. */
function summarize(res: SimulateResponse) {
  const r = (n: number, step = 1000) => Math.round(n / step) * step;
  return {
    horizon_months: res.horizon_months,
    best_id: res.best_id,
    best_id_means: "highest survival (safest), not necessarily the highest upside",
    universes: res.universes.map((u) => ({
      id: u.id,
      label: u.label,
      survival_pct: Math.round(u.survival_prob * 100),
      median_runway_months: Math.round(u.median_runway_months),
      final_cash_p50: r(u.final_cash.p50),
      final_cash_p90: r(u.final_cash.p90),
      final_monthly_revenue_p50: r(u.final_revenue_p50, 100),
    })),
  };
}

/** Voice conversation with the Parallel Universes Oracle. Wraps its own ConversationProvider. */
export function Conversation(props: ConversationProps) {
  return (
    <ConversationProvider>
      <ConversationPanel {...props} />
    </ConversationProvider>
  );
}

export default Conversation;

function ConversationPanel({ onToolStart, onResults, onToolError, agentVolume, micMuted }: ConversationProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [activity, setActivity] = useState<Activity>(null);
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLOListElement>(null);

  const conversation = useConversation({
    micMuted: Boolean(micMuted) || activity === "narrating",
    volume: agentVolume === undefined ? undefined : Math.min(Math.max(agentVolume, 0), 1),
    onMessage: ({ message, role, event_id }) => {
      // v4 voices may emit audio tags like "[warm]"; they direct delivery and shouldn't show as text.
      const text = message?.replace(/\[[^\]\n]{1,40}\]\s*/g, "").trim();
      if (!text || text === "...") return;
      setTurns((prev) => [...prev, { key: `${role}-${event_id}-${prev.length}`, role, text }]);
    },
    onError: (message) => {
      setProblem(message || "The voice connection had a problem.");
    },
    onDisconnect: () => setActivity(null),
  });
  const { status, isSpeaking, startSession, endSession } = conversation;

  useConversationClientTool("simulate_futures", async (params: Record<string, unknown>) => {
    const started = Date.now();
    const req = toSimulateRequest(params);
    if (typeof req === "string") return req;

    onToolStart?.("simulate_futures");
    setActivity("simulating");
    let res: SimulateResponse;
    try {
      const http = await fetch("/api/tools/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(SIMULATE_TIMEOUT_MS),
      });
      const data = (await http.json().catch(() => null)) as SimulateResponse | ToolError | null;
      if (!http.ok || !data || !("universes" in data)) {
        throw new Error((data as ToolError | null)?.error ?? `request failed with status ${http.status}`);
      }
      res = data;
    } catch (err) {
      const message = toolErrorMessage(err);
      onToolError?.(message);
      setActivity(null);
      return `ERROR: the simulation failed (${message}). Tell the person plainly that the universes couldn't be reached just now, offer to try again, and do not invent any results.`;
    }

    let waited = false;
    try {
      const pending = onResults?.(res);
      if (pending && typeof (pending as Promise<void>).then === "function") {
        setActivity("narrating");
        const budget = Math.max(TOOL_BUDGET_MS - (Date.now() - started), 1000);
        await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, budget))]);
        waited = true;
      }
    } catch (err) {
      console.warn("onResults failed", err);
    } finally {
      setActivity(null);
    }

    return JSON.stringify({
      ...summarize(res),
      note: waited
        ? "The universes have finished speaking. Give your verdict now: explain the trade-off between safest and highest upside, and the assumption that drives it."
        : "Narrations are now playing; wait, then give your verdict: the trade-off between safest and highest upside, and the assumption that drives it.",
    });
  });

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const start = useCallback(async () => {
    setProblem(null);
    setPreparing(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblem("This browser can't use a microphone here. Try Chrome, Edge or Safari over HTTPS or localhost.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop()); // the SDK opens its own stream
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        setProblem(
          name === "NotAllowedError"
            ? "Microphone access is blocked. Allow it in your browser's site settings, then press Start again."
            : name === "NotFoundError"
              ? "No microphone found. Connect one and press Start again."
              : "Couldn't open the microphone. Check your audio settings and try again.",
        );
        return;
      }

      const res = await fetch("/api/elevenlabs/token", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { conversationToken?: string; error?: string } | null;
      if (!res.ok || !data?.conversationToken) {
        setProblem(data?.error ?? "Couldn't start a voice session. Please try again.");
        return;
      }
      setTurns([]);
      startSession({ conversationToken: data.conversationToken, connectionType: "webrtc" });
    } catch {
      setProblem("Couldn't start a voice session. Check your connection and try again.");
    } finally {
      setPreparing(false);
    }
  }, [startSession]);

  const connected = status === "connected";
  const busy = preparing || status === "connecting";

  let stateLabel: string;
  if (preparing) stateLabel = "Getting ready…";
  else if (status === "connecting") stateLabel = "Connecting…";
  else if (!connected) stateLabel = status === "error" ? "Connection error" : "Not connected";
  else if (activity === "simulating") stateLabel = "Splitting reality into universes…";
  else if (activity === "narrating") stateLabel = "The universes are speaking (mic paused)";
  else if (micMuted) stateLabel = "Mic paused";
  else stateLabel = isSpeaking ? "The Oracle is speaking" : "Listening, go ahead";

  const dot = !connected
    ? "bg-neutral-400"
    : activity
      ? "bg-amber-500 motion-safe:animate-pulse"
      : isSpeaking
        ? "bg-violet-500 motion-safe:animate-pulse"
        : "bg-emerald-500";

  return (
    <section
      aria-label="Voice oracle"
      className="flex w-full flex-col gap-4 rounded-2xl border border-black/10 p-4 sm:p-6 dark:border-white/15"
    >
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={connected ? () => endSession() : start}
          disabled={busy}
          aria-pressed={connected}
          className={`min-h-14 w-full max-w-xs rounded-full px-8 text-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 ${
            connected
              ? "bg-red-700 text-white hover:bg-red-800 focus-visible:ring-red-400"
              : "bg-neutral-900 text-white hover:bg-neutral-700 focus-visible:ring-neutral-400 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          }`}
        >
          {connected ? "End conversation" : busy ? "Starting…" : "Ask the Oracle"}
        </button>

        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
          <span className="break-words">{stateLabel}</span>
        </p>

        {!connected && !problem && (
          <p className="max-w-sm text-center text-xs text-neutral-600 dark:text-neutral-400">
            Uses your microphone. A model of possible futures, not financial advice.
          </p>
        )}

        {problem && (
          <p role="alert" className="max-w-sm rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            {problem}
          </p>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200">Transcript</h2>
        <ol
          ref={transcriptRef}
          aria-live="polite"
          aria-relevant="additions"
          className="flex max-h-[50vh] min-h-24 flex-col gap-2 overflow-y-auto rounded-xl bg-black/[.03] p-3 text-sm dark:bg-white/[.05]"
        >
          {turns.length === 0 ? (
            <li className="text-neutral-600 dark:text-neutral-400">
              Press the button and say, for example: &ldquo;Should I hire two engineers or one engineer and a marketer? We have 500k in
              the bank, 8k monthly revenue and 20k monthly costs.&rdquo;
            </li>
          ) : (
            turns.map((t) => (
              <li
                key={t.key}
                className={`max-w-[85%] break-words rounded-xl px-3 py-2 ${
                  t.role === "user"
                    ? "self-end bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                    : "self-start bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                }`}
              >
                <span className="sr-only">{t.role === "user" ? "You: " : "Oracle: "}</span>
                {t.text}
              </li>
            ))
          )}
        </ol>
      </div>
    </section>
  );
}

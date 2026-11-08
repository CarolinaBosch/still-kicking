"use client";

// Browser "phone call" with the Still Kicking Nurse (ElevenLabs agent, WebRTC).
// Contract: <CallPanel patient onEmergency onAnalysis />. Client tools:
//   trigger_emergency_alert → POST /api/tools/emergency → onEmergency(Alert)
//   submit_checkin          → POST /api/calls/complete  → onAnalysis(AnalysisResult)
// The Daytona analysis is started in the background so the nurse can say goodbye right away;
// the panel keeps showing its progress after the call ends.

import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation, useConversationClientTool } from "@elevenlabs/react";
import type { Alert, AnalysisResult, Patient, ToolError } from "@/lib/types";
import {
  TOOL_EMERGENCY,
  TOOL_SUBMIT,
  buildDynamicVariables,
  newCallId,
  toCheckinRecord,
  toEmergencyInput,
} from "./Conversation";

export interface CallPanelProps {
  patient: Patient;
  onEmergency: (a: Alert) => void;
  onAnalysis: (r: AnalysisResult) => void;
}

type Turn = { key: string; role: "user" | "agent"; text: string };
type Analysis =
  | { state: "idle" }
  | { state: "running"; since: number }
  | { state: "done"; sandboxId: string; ms: number }
  | { state: "error"; message: string };

const EMERGENCY_TIMEOUT_MS = 8_000; // agent waits 10 s (responseTimeoutSecs)
const ANALYSIS_TIMEOUT_MS = 180_000; // fresh Daytona sandbox + engine run
const SPEAK_WAIT_MS = 22_000; // agent tool timeout is 25 s (scripts/create-agent.mjs)

/** Plain-language result of the Daytona engine for the agent to share before goodbye. Never a diagnosis. */
export function speakableResult(r: AnalysisResult, caregiverName: string): string {
  const s = r.summary;
  const watch = s.patterns_to_watch.slice(0, 2).join("; ");
  const parts = [
    "Analysis finished. In one or two short, kind sentences, share this with them in plain words. Do not diagnose and do not give medical advice.",
    `Summary: ${s.today}`,
  ];
  if (s.medications) parts.push(`Medicines: ${s.medications}`);
  if (watch) parts.push(`Their nurse will review: ${watch}.`);
  parts.push(
    s.status === "green"
      ? `Tell them everything looks steady and ${caregiverName} will get a short summary.`
      : `Tell them their nurse has been asked to follow up and ${caregiverName} has been sent a summary.`,
  );
  parts.push("Then say a warm goodbye and end the call.");
  return parts.join(" ");
}

export function CallPanel(props: CallPanelProps) {
  return (
    <ConversationProvider>
      <CallPanelInner {...props} />
    </ConversationProvider>
  );
}

export default CallPanel;

async function postJson<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => null)) as T | ToolError | null;
  if (!res.ok || !data) {
    throw new Error((data as ToolError | null)?.error ?? `request failed (${res.status})`);
  }
  return data as T;
}

function errMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === "TimeoutError") return "it took too long";
  return (err instanceof Error ? err.message : String(err)).slice(0, 160);
}

function formatClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function CallPanelInner({ patient, onEmergency, onAnalysis }: CallPanelProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [emergency, setEmergency] = useState<{ flag: string; sent: boolean } | null>(null);
  const [analysis, setAnalysis] = useState<Analysis>({ state: "idle" });
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const callIdRef = useRef<string>("");
  const submittedRef = useRef(false);
  const captionsRef = useRef<HTMLOListElement>(null);

  const conversation = useConversation({
    onConnect: () => setConnectedAt(Date.now()),
    onDisconnect: () => setConnectedAt(null),
    onMessage: ({ message, role, event_id }) => {
      // v4 voices may emit audio tags like "[warm]"; they direct delivery and shouldn't show as text.
      const text = message?.replace(/\[[^\]\n]{1,40}\]\s*/g, "").trim();
      if (!text || text === "...") return;
      setTurns((prev) => [...prev, { key: `${role}-${event_id}-${prev.length}`, role, text }]);
    },
    onError: (message) => setProblem(message || "The call had a problem."),
  });
  const { status, isSpeaking, startSession, endSession } = conversation;
  const connected = status === "connected";

  useConversationClientTool(TOOL_EMERGENCY, async (params: Record<string, unknown>) => {
    const input = toEmergencyInput(params ?? {}, patient.id);
    setEmergency({ flag: input.red_flag, sent: false });
    try {
      const alert = await postJson<Alert>("/api/tools/emergency", input, EMERGENCY_TIMEOUT_MS);
      setEmergency({ flag: input.red_flag, sent: true });
      onEmergency(alert);
      return "Alert sent. The nurse and caregiver are being notified now. Tell the person to hang up and call 911.";
    } catch (err) {
      console.warn("emergency alert failed", errMessage(err));
      return "The alert could not be confirmed. Still tell the person calmly to hang up and call 911 now.";
    }
  });

  useConversationClientTool(TOOL_SUBMIT, async (params: Record<string, unknown>) => {
    if (submittedRef.current) return "Already saved. Say a warm goodbye.";
    submittedRef.current = true;
    const record = toCheckinRecord(params ?? {}, patient.id, callIdRef.current || newCallId());
    setAnalysis({ state: "running", since: Date.now() });
    const run = postJson<AnalysisResult>("/api/calls/complete", record, ANALYSIS_TIMEOUT_MS).then(
      (result) => {
        setAnalysis({ state: "done", sandboxId: result.sandbox_id, ms: result.sandbox_ms });
        onAnalysis(result);
        return result;
      },
      (err) => {
        setAnalysis({ state: "error", message: errMessage(err) });
        return null;
      },
    );
    // Wait (briefly) for the Daytona engine so the agent can say the result out loud in the
    // same call. If the sandbox is slow, the analysis keeps running and the agent says goodbye.
    const result = await Promise.race([run, new Promise<null>((r) => setTimeout(() => r(null), SPEAK_WAIT_MS))]);
    if (!result) return "Saved. The nurse will review your notes. Now say a warm goodbye and end the call.";
    return speakableResult(result, patient.caregiver.name);
  });

  // Call timer and analysis elapsed time.
  const ticking = connected || analysis.state === "running";
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  useEffect(() => {
    const el = captionsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const start = useCallback(async () => {
    setProblem(null);
    setPreparing(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblem("This browser can't use a microphone here. Use Chrome, Edge or Safari on localhost or HTTPS.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop()); // the SDK opens its own stream
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        setProblem(
          name === "NotAllowedError"
            ? "Microphone access is blocked. Allow it in the browser's site settings, then start the call again."
            : name === "NotFoundError"
              ? "No microphone found. Connect one and start the call again."
              : "Couldn't open the microphone. Check your audio settings and try again.",
        );
        return;
      }

      const res = await fetch("/api/elevenlabs/token", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { conversationToken?: string; error?: string } | null;
      if (!res.ok || !data?.conversationToken) {
        setProblem(data?.error ?? "Couldn't start the call. Please try again.");
        return;
      }
      callIdRef.current = newCallId();
      submittedRef.current = false;
      setTurns([]);
      setEmergency(null);
      setAnalysis({ state: "idle" });
      startSession({
        conversationToken: data.conversationToken,
        connectionType: "webrtc",
        dynamicVariables: buildDynamicVariables(patient),
      });
    } catch {
      setProblem("Couldn't start the call. Check your connection and try again.");
    } finally {
      setPreparing(false);
    }
  }, [patient, startSession]);

  const ringing = preparing || status === "connecting";
  const elapsed = connectedAt ? Math.max(0, Math.floor((now - connectedAt) / 1000)) : 0;
  const name = patient.preferred_name || patient.name;

  let statusText: string;
  if (ringing) statusText = `Calling ${name}…`;
  else if (connected) statusText = isSpeaking ? "Nurse is speaking" : `Listening to ${name}`;
  else if (status === "error") statusText = "Call failed";
  else if (turns.length) statusText = "Call ended";
  else statusText = "Ready to call";

  return (
    <section
      aria-label={`Check-in call with ${name}`}
      className="flex w-full flex-col gap-4 rounded-2xl border border-black/10 bg-white p-4 shadow-sm sm:p-6 dark:border-white/15 dark:bg-neutral-900"
    >
      <header className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${
            connected
              ? "bg-emerald-600 text-white"
              : ringing
                ? "bg-sky-600 text-white motion-safe:animate-pulse"
                : "bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100"
          }`}
        >
          {name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-neutral-900 dark:text-neutral-100">{patient.name}</p>
          <p role="status" aria-live="polite" className="text-sm text-neutral-700 dark:text-neutral-300">
            {statusText}
            {connected && <span className="ml-2 font-mono tabular-nums">{formatClock(elapsed)}</span>}
          </p>
        </div>
        {connected && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
            Live
          </span>
        )}
      </header>

      <button
        type="button"
        onClick={connected ? () => endSession() : start}
        disabled={ringing}
        className={`min-h-14 w-full rounded-full px-8 text-lg font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 ${
          connected
            ? "bg-red-700 hover:bg-red-800 focus-visible:ring-red-400"
            : "bg-emerald-700 hover:bg-emerald-800 focus-visible:ring-emerald-400"
        }`}
      >
        {connected ? "End call" : ringing ? "Ringing…" : "Start check-in call"}
      </button>

      {problem && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {problem}
        </p>
      )}

      {emergency && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
        >
          Emergency: {emergency.flag.replace(/_/g, " ")}.{" "}
          {emergency.sent ? "Nurse and caregiver alerted. Patient told to call 911." : "Alerting nurse and caregiver…"}
        </p>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200">Live captions</h3>
        <ol
          ref={captionsRef}
          aria-live="polite"
          aria-relevant="additions"
          className="flex max-h-80 min-h-24 flex-col gap-2 overflow-y-auto rounded-xl bg-neutral-100 p-3 text-sm dark:bg-neutral-800"
        >
          {turns.length === 0 ? (
            <li className="text-neutral-600 dark:text-neutral-400">
              Captions of both sides appear here once {name} picks up.
            </li>
          ) : (
            turns.map((t) => (
              <li
                key={t.key}
                className={`max-w-[85%] break-words rounded-xl px-3 py-2 ${
                  t.role === "user"
                    ? "self-end bg-sky-700 text-white"
                    : "self-start bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                }`}
              >
                <span className="mb-0.5 block text-xs font-semibold opacity-80">{t.role === "user" ? name : "Nurse"}</span>
                {t.text}
              </li>
            ))
          )}
        </ol>
      </div>

      {analysis.state !== "idle" && (
        <p
          role="status"
          aria-live="polite"
          className={`rounded-lg px-3 py-2 text-sm ${
            analysis.state === "error"
              ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
              : "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
          }`}
        >
          {analysis.state === "running" && (
            <>
              <span aria-hidden="true" className="mr-2 inline-block h-2 w-2 rounded-full bg-sky-500 motion-safe:animate-pulse" />
              Analyzing in Daytona… {Math.max(0, Math.floor((now - analysis.since) / 1000))}s
            </>
          )}
          {analysis.state === "done" && (
            <>
              Analysis done in Daytona sandbox <span className="font-mono">{analysis.sandboxId}</span> (
              {(analysis.ms / 1000).toFixed(1)}s)
            </>
          )}
          {analysis.state === "error" && <>The check-in could not be analyzed: {analysis.message}</>}
        </p>
      )}
    </section>
  );
}

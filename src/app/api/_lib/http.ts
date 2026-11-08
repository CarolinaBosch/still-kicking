// Shared helpers for the API routes. The `_lib` folder is private (not routed by Next.js).
import { NextResponse } from "next/server";
import type { ToolError } from "@/lib/types";
import { DEV_FIXTURE_HEADER, isDevFixtureActive, markDevFixture } from "@/lib/dev-fixture";
import { StoreError } from "@/lib/store";

const NO_STORE = { "Cache-Control": "no-store" };

export function toolError(error: string, status: number) {
  return NextResponse.json<ToolError>({ error }, { status, headers: NO_STORE });
}

export function ok<T>(body: T, status = 200) {
  const headers: Record<string, string> = { ...NO_STORE };
  if (isDevFixtureActive()) headers[DEV_FIXTURE_HEADER] = "1";
  return NextResponse.json<T>(body, { status, headers });
}

/** Thrown by validators; the message is short and speakable, returned as a 400. */
export class InvalidInput extends Error {}
export class PayloadTooLarge extends InvalidInput {}

export class TimeoutError extends Error {
  constructor(label: string) {
    super(`${label} timed out`);
    this.name = "TimeoutError";
  }
}

const MAX_BODY_BYTES = 64 * 1024;

/** Parses a JSON object body with a size cap. Throws InvalidInput on anything else. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new PayloadTooLarge("That request is too large.");
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw new InvalidInput("I could not read that request.");
  }
  if (text.length > MAX_BODY_BYTES) throw new PayloadTooLarge("That request is too large.");
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new InvalidInput("That request was not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new InvalidInput("That request should be a JSON object.");
  }
  return body as Record<string, unknown>;
}

/** Reject after ms so a slow upstream never stalls the voice conversation. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(label)), ms);
    }),
  ]);
}

function isNotImplemented(err: unknown): boolean {
  return err instanceof Error && /not implemented/i.test(err.message);
}

/**
 * Calls the real store. Only in `next dev`, and only when the store still throws "not implemented",
 * falls back to the in-memory dev fixture so the dashboard can be built before the Daytona store lands.
 * Any other error (including in production) is rethrown untouched.
 */
export async function viaStore<T>(real: () => Promise<T>, fixture: () => Promise<T>): Promise<T> {
  try {
    return await real();
  } catch (err) {
    if (process.env.NODE_ENV === "development" && isNotImplemented(err)) {
      markDevFixture();
      return fixture();
    }
    throw err;
  }
}

/** Maps a thrown error to a speakable ToolError response. */
export function fail(err: unknown, context: string, fallback: string) {
  if (err instanceof PayloadTooLarge) return toolError(err.message, 413);
  if (err instanceof InvalidInput) return toolError(err.message, 400);
  if (err instanceof TimeoutError) {
    console.error(`[${context}]`, err.message);
    return toolError("That took too long. Please try again.", 504);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${context}]`, message);
  // Store errors carry an HTTP status and a short speakable message.
  if (err instanceof StoreError) return toolError(err.message, err.status);
  if (/not found|unknown (patient|alert)/i.test(message)) return toolError("I could not find that record.", 404);
  return toolError(fallback, 502);
}

// ---- small validators ----

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID_RE.test(value.trim())) {
    throw new InvalidInput(`A valid ${label} is required.`);
  }
  return value.trim();
}

/** Trims, strips control characters and caps length. Non-strings become "". */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const s = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

export function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function numberInRange(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n < min || n > max ? null : n;
}

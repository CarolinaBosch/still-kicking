// Shared Daytona client and helpers. SERVER ONLY (reads DAYTONA_API_KEY).
//
// Two kinds of sandboxes, both labeled app=still-kicking:
//   role=records   one long-lived sandbox that holds patient records (records.ts)
//   role=engine    fresh per finished call, runs engine/engine.py (engine.ts)
//   role=tests     fresh per test run, runs engine/tests (engine.ts)
// Ephemeral sandboxes are deleted in `finally`; if the process dies first, the
// ephemeral flag plus a short auto-stop delete them anyway.
// No host env vars or secrets are ever passed into a sandbox.

import { Daytona, type Sandbox } from "@daytona/sdk";

export const APP_LABEL = "still-kicking";
export const REMOTE_HOME = "/home/daytona";
const DEFAULT_API_URL = "https://app.daytona.io/api";

const EPHEMERAL_CREATE_TIMEOUT_S = 30;
const EPHEMERAL_AUTO_STOP_MIN = 5;
const DELETE_TIMEOUT_S = 15;
const CLEANUP_WAIT_MS = 8_000;

/** Error whose message is short and safe to speak or show. `status` maps to HTTP. */
export class StoreError extends Error {
  constructor(
    message: string,
    readonly status = 500,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "StoreError";
  }
}

export function errText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

/**
 * One value per Node process. Next.js dev can load a module once per route
 * bundle; state that must be shared (cache, write queue) lives on globalThis.
 */
export function processGlobal<T extends object>(key: string, init: () => T): T {
  const g = globalThis as unknown as Record<string, T | undefined>;
  return (g[`__stillKicking_${key}`] ??= init());
}

let client: Daytona | null = null;

export function getDaytona(): Daytona {
  if (!process.env.DAYTONA_API_KEY) throw new StoreError("The care records service is not configured.", 503);
  if (!client) {
    // Always pass apiUrl: SDK 0.231.0 throws "endpoint is ambiguous" otherwise.
    client = new Daytona({
      apiKey: process.env.DAYTONA_API_KEY,
      apiUrl: process.env.DAYTONA_API_URL || DEFAULT_API_URL,
    });
  }
  return client;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StoreError(message, 504)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function destroy(daytona: Daytona, sandbox: Sandbox): Promise<void> {
  try {
    await daytona.delete(sandbox, DELETE_TIMEOUT_S);
  } catch (err) {
    console.error("[daytona] delete failed, stopping instead", sandbox.id, errText(err));
    // Ephemeral sandboxes are deleted as soon as they stop.
    await daytona.stop(sandbox).catch((e) => console.error("[daytona] stop failed", sandbox.id, errText(e)));
  }
}

/**
 * Creates a fresh ephemeral sandbox, runs `fn` in it, and always deletes it.
 * Cleanup waits at most CLEANUP_WAIT_MS so a slow delete never delays the caller much.
 */
export async function withEphemeralSandbox<T>(
  labels: Record<string, string>,
  failMessage: string,
  fn: (sandbox: Sandbox) => Promise<T>,
): Promise<T> {
  const daytona = getDaytona();
  const created = daytona.create(
    {
      language: "python",
      ephemeral: true,
      autoStopInterval: EPHEMERAL_AUTO_STOP_MIN,
      labels: { app: APP_LABEL, ...labels },
    },
    { timeout: EPHEMERAL_CREATE_TIMEOUT_S },
  );
  created.catch(() => undefined); // the caller's timeout may win the race
  try {
    let sandbox: Sandbox;
    try {
      sandbox = await created;
    } catch (err) {
      throw new StoreError(failMessage, 502, { cause: err });
    }
    return await fn(sandbox);
  } finally {
    const cleanup = created.then((sb) => destroy(daytona, sb)).catch(() => undefined);
    await Promise.race([cleanup, new Promise((r) => setTimeout(r, CLEANUP_WAIT_MS))]);
  }
}

// Runs engine/*.py in fresh Daytona sandboxes. SERVER ONLY.
//
// Per finished call: create an ephemeral sandbox labeled role=engine, upload the
// engine source and one input.json (patient, history, new record), run
// `python3 -B engine.py input.json`, validate the marker line, delete the
// sandbox. One sandbox per run (not a warm one) so a call's data never sits
// next to another patient's, and a bad run cannot affect the next one.
// Nothing from the host environment enters the sandbox.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { CheckinRecord, Patient, TestRunResult } from "../types";
import { REMOTE_HOME, StoreError, errText, withEphemeralSandbox, withTimeout } from "./client";
import { parseEngineOutput, type EngineOutput } from "./engine-output";

const ENGINE_DIR = path.join(process.cwd(), "engine");
const REMOTE_ENGINE = `${REMOTE_HOME}/engine`;

const UPLOAD_TIMEOUT_S = 15;
const ENGINE_RUN_TIMEOUT_S = 20;
const TESTS_RUN_TIMEOUT_S = 90;
const ENGINE_BUDGET_MS = 60_000;
const TESTS_BUDGET_MS = 150_000;

interface SourceFile {
  rel: string; // path relative to engine/
  body: Buffer;
}

async function readPython(dir: string, rel = ""): Promise<SourceFile[]> {
  const names = (await readdir(path.join(dir, rel))).filter((n) => n.endsWith(".py")).sort();
  return Promise.all(names.map(async (n) => ({ rel: path.posix.join(rel, n), body: await readFile(path.join(dir, rel, n)) })));
}

/** engine/*.py, plus engine/tests/*.py when `withTests` is set. */
async function engineSources(withTests: boolean): Promise<SourceFile[]> {
  try {
    const files = await readPython(ENGINE_DIR);
    return withTests ? files.concat(await readPython(ENGINE_DIR, "tests")) : files;
  } catch (err) {
    throw new StoreError("The check-in engine is missing.", 500, { cause: err });
  }
}

const toUploads = (files: SourceFile[]) =>
  files.map((f) => ({ source: f.body, destination: `${REMOTE_ENGINE}/${f.rel}` }));

export interface EngineInput {
  patient: Patient;
  history: CheckinRecord[]; // oldest first, without `record`
  record: CheckinRecord;
}

export interface EngineRun {
  output: EngineOutput;
  sandbox_id: string;
  sandbox_ms: number;
}

/** Analyzes one finished call in a fresh sandbox. Throws StoreError with a speakable message. */
export async function runEngine(input: EngineInput): Promise<EngineRun> {
  const started = Date.now();
  const sources = await engineSources(false);
  const labels = { role: "engine", patient: input.patient.id };

  const job = withEphemeralSandbox(labels, "I couldn't start the check-in analysis.", async (sandbox) => {
    await sandbox.fs.uploadFiles(
      [...toUploads(sources), { source: Buffer.from(JSON.stringify(input)), destination: `${REMOTE_ENGINE}/input.json` }],
      UPLOAD_TIMEOUT_S,
    );
    const res = await sandbox.process.executeCommand("python3 -B engine.py input.json", REMOTE_ENGINE, undefined, ENGINE_RUN_TIMEOUT_S);
    try {
      return { output: parseEngineOutput(res.result ?? "", res.exitCode), sandbox_id: sandbox.id, sandbox_ms: Date.now() - started };
    } catch (err) {
      throw new StoreError("The check-in analysis returned something I can't trust.", 502, { cause: err });
    }
  });
  try {
    return await withTimeout(job, ENGINE_BUDGET_MS, "The check-in analysis took too long.");
  } catch (err) {
    console.error("[engine] run failed", errText(err), err instanceof Error && err.cause ? errText(err.cause) : "");
    throw err instanceof StoreError ? err : new StoreError("The check-in analysis failed.", 502, { cause: err });
  }
}

// pytest if the image has it, or if pip can fetch it quickly (PyPI is reachable but
// slow on some runners); the tests are plain unittest cases, so the stdlib runner
// is the fallback. Each step is capped so a slow runner cannot stall the demo.
const TEST_COMMAND = [
  "if timeout 15 python3 -m pytest --version >/dev/null 2>&1 || timeout 20 pip install -q pytest >/dev/null 2>&1;",
  "then python3 -B -m pytest -v -p no:cacheprovider -W ignore::DeprecationWarning tests 2>&1;",
  "else echo \"pytest unavailable, using unittest\"; python3 -B -m unittest discover -s tests -t tests -v 2>&1; fi",
].join(" ");

function countTests(out: string): { passed: number; failed: number } {
  const pytest = out.match(/(\d+) passed/);
  const pytestFailed = [...out.matchAll(/(\d+) (?:failed|error)/g)].reduce((n, m) => n + Number(m[1]), 0);
  if (pytest || pytestFailed) return { passed: Number(pytest?.[1] ?? 0), failed: pytestFailed };

  const ran = Number(out.match(/Ran (\d+) tests?/)?.[1] ?? 0);
  const failures = Number(out.match(/failures=(\d+)/)?.[1] ?? 0) + Number(out.match(/errors=(\d+)/)?.[1] ?? 0);
  return { passed: Math.max(0, ran - failures), failed: failures };
}

/** Runs engine/tests in a fresh sandbox. A failing suite is a result, not an error. */
export async function runTests(): Promise<TestRunResult> {
  const started = Date.now();
  const sources = await engineSources(true);

  const job = withEphemeralSandbox({ role: "tests" }, "I couldn't start the test sandbox.", async (sandbox) => {
    await sandbox.fs.uploadFiles(toUploads(sources), UPLOAD_TIMEOUT_S);
    const res = await sandbox.process.executeCommand(`sh -c '${TEST_COMMAND}'`, REMOTE_ENGINE, undefined, TESTS_RUN_TIMEOUT_S);
    const out = res.result ?? "";
    const counts = countTests(out);
    if (res.exitCode !== 0 && counts.failed === 0) counts.failed = 1; // crashed before reporting
    return {
      ...counts,
      output_tail: out.trimEnd().split("\n").slice(-30).join("\n"),
      sandbox_id: sandbox.id,
      sandbox_ms: Date.now() - started,
    };
  });
  try {
    return await withTimeout(job, TESTS_BUDGET_MS, "The test run took too long.");
  } catch (err) {
    console.error("[engine] tests failed to run", errText(err));
    throw err instanceof StoreError ? err : new StoreError("The test run failed.", 502, { cause: err });
  }
}

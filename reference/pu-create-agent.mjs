#!/usr/bin/env node
// Creates or updates the "Parallel Universes Oracle" ElevenLabs agent and its client tool.
//
//   node --env-file=.env.local scripts/create-agent.mjs
//
// Needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID (Carolina's clone). If ELEVENLABS_AGENT_ID is
// set, that agent is updated in place; otherwise a new agent is created and its id is printed.
// The prompt and first message come from docs/agent-prompt.md. The tool is matched by name, so
// re-running updates it instead of creating a duplicate.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const AGENT_NAME = "Parallel Universes Oracle";
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID?.trim();
const TTS_MODEL = "eleven_v4_turbo"; // low-latency v4, built for agents; better clone accuracy
const LANGUAGE = "en";
const LLM = "claude-haiku-4-5"; // reliable tool calls in dry run #1; ElevenLabs-hosted

const num = (description) => ({ type: "number", description });

// Must match the clientTools key in src/components/Conversation.tsx and SimulateRequest in src/lib/types.ts.
const SIMULATE_FUTURES = {
  type: "client",
  name: "simulate_futures",
  description:
    "Split reality: simulate each option of the person's decision in its own sandbox (thousands of Monte Carlo futures per option) " +
    "and get back, per universe, survival odds, median runway, ending cash and ending revenue. " +
    "Call it once you have the baseline numbers and an estimate for every option, always including a 'Change nothing' option. " +
    "While it runs, the page plays each universe's narration; the result arrives after they finish.",
  parameters: {
    type: "object",
    required: ["decision", "baseline", "options"],
    properties: {
      decision: { type: "string", description: "The decision in one sentence, e.g. \"Should I hire two engineers or one engineer and a marketer?\"" },
      baseline: {
        type: "object",
        description: "The person's situation today.",
        required: ["cash", "monthly_revenue", "monthly_costs"],
        properties: {
          cash: num("Dollars in the bank now, e.g. 500000."),
          monthly_revenue: num("Dollars of revenue per month now, e.g. 8000."),
          monthly_costs: num("Dollars of costs per month now, before any option, e.g. 20000."),
        },
      },
      options: {
        type: "array",
        description: "2 to 4 options, one universe each. The last one is always 'Change nothing'.",
        items: {
          type: "object",
          description: "One option the person is weighing.",
          required: ["id", "label", "extra_monthly_cost", "one_time_cost", "growth_mean", "growth_sd"],
          properties: {
            id: { type: "string", description: "\"a\", \"b\", \"c\" or \"d\", in order." },
            label: { type: "string", description: "Short label starting with a verb, e.g. \"Hire 2 engineers\" or \"Change nothing\"." },
            extra_monthly_cost: num("Dollars per month this option adds to costs, e.g. 24000. 0 for Change nothing."),
            one_time_cost: num("Dollars paid once in month 1, e.g. 10000. 0 if none."),
            growth_mean: num("Expected monthly revenue growth as a decimal, e.g. 0.06 for 6 percent a month."),
            growth_sd: num("Uncertainty of monthly growth as a decimal, e.g. 0.04. Bolder bets get larger values."),
          },
        },
      },
      horizon_months: { type: "integer", description: "Months to simulate. Use 24 unless the person asks otherwise (max 60)." },
      runs: { type: "integer", description: "Monte Carlo runs per universe. Use 2000 unless asked otherwise (max 10000)." },
    },
  },
  expectsResponse: true,
  // Simulation is ~2 s, but the handler answers only after the narrations finish playing (~45 s).
  responseTimeoutSecs: 120,
  preToolSpeech: "force",
  // Narration audio from the speakers must not count as the user interrupting.
  interruptionMode: "disable_during_tool",
};

const TOOLS = [SIMULATE_FUTURES];

const here = path.dirname(fileURLToPath(import.meta.url));

async function loadPrompt() {
  const md = await readFile(path.join(here, "..", "docs", "agent-prompt.md"), "utf8");
  const section = (heading) => {
    const re = new RegExp(`## ${heading}\\s*\\n+\`\`\`text\\n([\\s\\S]*?)\\n\`\`\``);
    const m = md.match(re);
    if (!m) throw new Error(`docs/agent-prompt.md: missing "## ${heading}" text block`);
    return m[1].trim();
  };
  return { prompt: section("System prompt"), firstMessage: section("First message") };
}

async function upsertTool(client, config) {
  const { tools } = await client.conversationalAi.tools.list({ search: config.name, types: "client" });
  const existing = tools.find((t) => t.toolConfig?.name === config.name);
  if (existing) {
    await client.conversationalAi.tools.update(existing.id, { toolConfig: config });
    console.log(`Updated tool ${config.name} (${existing.id})`);
    return existing.id;
  }
  const created = await client.conversationalAi.tools.create({ toolConfig: config });
  console.log(`Created tool ${config.name} (${created.id})`);
  return created.id;
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error("ELEVENLABS_API_KEY is not set. Run with: node --env-file=.env.local scripts/create-agent.mjs");
    process.exit(1);
  }
  if (!VOICE_ID) {
    console.error("ELEVENLABS_VOICE_ID is not set (the Oracle speaks in Carolina's cloned voice).");
    process.exit(1);
  }
  const client = new ElevenLabsClient({ apiKey });
  const { prompt, firstMessage } = await loadPrompt();

  const toolIds = [];
  for (const tool of TOOLS) toolIds.push(await upsertTool(client, tool));

  const body = {
    name: AGENT_NAME,
    tags: ["parallel-universes", "hackathon"],
    conversationConfig: {
      agent: {
        firstMessage,
        language: LANGUAGE,
        prompt: { prompt, llm: LLM, toolIds, temperature: 0.3 },
      },
      tts: { voiceId: VOICE_ID, modelId: TTS_MODEL },
    },
    // Private agent: the browser can only connect with a conversation token from our server.
    platformSettings: { auth: { enableAuth: true } },
  };

  const rawId = process.env.ELEVENLABS_AGENT_ID?.trim() ?? "";
  const existingId = rawId.startsWith("agent_") ? rawId : "";
  if (rawId && !existingId) {
    console.warn(`ELEVENLABS_AGENT_ID is set but is not an agent id (expected "agent_..."); creating a new agent.`);
  }
  if (existingId) {
    await client.conversationalAi.agents.update(existingId, body);
    console.log(`\nUpdated agent "${AGENT_NAME}": ${existingId}`);
  } else {
    const { agentId } = await client.conversationalAi.agents.create(body);
    console.log(`\nCreated agent "${AGENT_NAME}": ${agentId}`);
    console.log(`\nAdd this line to .env.local:\n  ELEVENLABS_AGENT_ID=${agentId}`);
  }
}

main().catch((err) => {
  // Status and message only; never dump request config.
  console.error("Failed:", err?.statusCode ?? "", err?.message ?? err);
  if (err?.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
});

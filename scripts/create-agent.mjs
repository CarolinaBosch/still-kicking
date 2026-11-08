#!/usr/bin/env node
// Creates or updates the "Still Kicking Nurse" ElevenLabs agent and its client tools.
//
//   node --env-file=.env.local scripts/create-agent.mjs
//
// Needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID (Carolina's clone). If ELEVENLABS_AGENT_ID is
// set, that agent is updated in place; otherwise a new agent is created and its id is printed.
// Prompt and first message come from docs/agent-prompt.md. Tools are matched by name, so re-running
// updates them instead of creating duplicates. Tool names and parameters must match the
// useConversationClientTool handlers in src/components/Conversation.tsx and src/lib/types.ts.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const AGENT_NAME = "Still Kicking Nurse";
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID?.trim();
const TTS_MODEL = "eleven_v4_turbo"; // low-latency, good clone accuracy (proven in the previous project)
const LLM = "claude-haiku-4-5"; // fast, reliable tool calls in our previous project
const TEMPERATURE = 0.2;

const str = (description) => ({ type: "string", description });
const bool = (description) => ({ type: "boolean", description });
const num = (description) => ({ type: "number", description });

const SAW = {
  seems_different: "Seems different from usual (mood, energy, behavior).",
  talks_less: "Talks or communicates less than usual.",
  needs_more_help: "Needs more help than usual with daily activities.",
  ate_less: "Ate less / poor appetite.",
  bowel_change: "Change in bowels (no movement, diarrhea, constipation).",
  drank_less: "Drank less fluid than usual.",
  weight_or_swelling: "Weight change or swelling (tight shoes or rings, swollen legs).",
  agitated: "Nervous, agitated or upset.",
  tired_weak_confused: "Tired, weak, sleepy or confused (including wrong day of the week).",
  skin_change: "New sores, rashes or skin color change.",
  walking_toileting_help: "New trouble walking, transferring or getting to the toilet.",
};

const TRIGGER_EMERGENCY_ALERT = {
  type: "client",
  name: "trigger_emergency_alert",
  description:
    "Alert the patient's nurse and caregiver immediately about a possible emergency. Call it the MOMENT any red flag " +
    "is heard (chest pain or pressure, trouble breathing, fall with head hit or can't get up, stroke signs, fainting, " +
    "uncontrolled bleeding / vomiting blood / black stools, not safe at home, sudden confusion or slurred speech), " +
    "before saying anything else. Then tell the person to hang up and call 911.",
  parameters: {
    type: "object",
    required: ["patient_id", "red_flag", "quote"],
    properties: {
      patient_id: str("The patient id from the system prompt, e.g. p1."),
      red_flag: str(
        "One of: chest_pain, breathing, fall, stroke_signs, fainting, bleeding, safety, confusion, other.",
      ),
      quote: str("The person's exact words that raised the concern."),
    },
  },
  expectsResponse: true,
  responseTimeoutSecs: 10,
  preToolSpeech: "off",
};

const SUBMIT_CHECKIN = {
  type: "client",
  name: "submit_checkin",
  description:
    "Save today's structured check-in record and run the two-week review for the nurse. Returns a short summary to " +
    "share with the person before goodbye. Call it exactly once: right before the goodbye, or right after the 911 " +
    "instruction in an emergency. Record only what the person actually said; use null for anything not asked or " +
    "unclear. Never guess.",
  parameters: {
    type: "object",
    required: [
      "patient_id",
      "red_flags",
      "stop_and_watch",
      "pain",
      "medication_adherence",
      "patient_message_for_caregiver",
      "patient_quote",
      "extraction_confidence",
    ],
    properties: {
      patient_id: str("The patient id from the system prompt, e.g. p1."),
      red_flags: {
        type: "array",
        description: "Red flags heard during the call. Empty array if none.",
        items: {
          type: "object",
          description: "One red flag.",
          required: ["type", "quote", "severity"],
          properties: {
            type: str("chest_pain, breathing, fall, stroke_signs, fainting, bleeding, safety, confusion or other."),
            quote: str("The person's exact words."),
            severity: str("emergency, urgent or watch."),
          },
        },
      },
      stop_and_watch: {
        type: "object",
        description:
          "Stop and Watch items. true = problem present, false = person said no problem. Leave out or null if not asked.",
        properties: Object.fromEntries(Object.entries(SAW).map(([k, d]) => [k, bool(d)])),
      },
      pain: {
        type: "object",
        description: "Pain today.",
        properties: {
          present: bool("true if they have pain, false if not. Omit if not asked."),
          location: str("Where it hurts, in their words. Empty if no pain."),
          score: num("0 to 10 as they rated it. Omit if not rated."),
          new_or_worse: bool("true if the pain is new or worse than usual."),
        },
      },
      orientation_correct: bool("true if they named the correct day of the week, false if wrong. Omit if not asked."),
      medication_adherence: {
        type: "object",
        description: "Medicines yesterday and today.",
        properties: {
          all_taken: bool("true if they took every scheduled medicine yesterday and today."),
          missed: {
            type: "array",
            description: "Each missed medicine. Empty array if none.",
            items: {
              type: "object",
              description: "One missed medicine.",
              required: ["med", "doses_missed", "reason"],
              properties: {
                med: str("Medicine name as in the patient's list, e.g. Furosemide."),
                doses_missed: num("Number of doses missed in the last two days."),
                reason: str("Why, in their words, e.g. \"ran out\" or \"makes me pee too much\"."),
              },
            },
          },
          prn_use_increased: bool("true if they used an as-needed medicine more than usual."),
          running_low: {
            type: "array",
            description: "Names of medicines they are running low on. Empty array if none.",
            items: str("Medicine name."),
          },
        },
      },
      phq2_score: num("PHQ-2 total 0-6 (down/hopeless + little interest, each 0-3). Omit if not asked."),
      condition_specific: {
        type: "object",
        description:
          "Condition answers as short snake_case keys with string, number or boolean values, " +
          "e.g. weight_gain_lb 3, sob_lying_flat true, pillows 3, urinary_burning true, rescue_inhaler_more true.",
        properties: {
          weight_gain_lb: num("Pounds gained since usual weight, if they said."),
          pillows: num("Pillows needed to sleep."),
          sob_lying_flat: bool("Short of breath lying flat."),
          leg_swelling: bool("Swollen legs or ankles."),
          cough_or_sputum_change: bool("New cough or sputum change."),
          rescue_inhaler_more: bool("Using rescue inhaler more than usual."),
          blood_sugar: num("Blood sugar reading if they checked."),
          blood_pressure: str("Home blood pressure reading, e.g. 150/90."),
          more_confused: bool("More confused than usual."),
          urinary_burning: bool("Burning when urinating."),
          fever: bool("Fever."),
        },
      },
      weight_lb: num("Today's weight in pounds if they weighed. Omit otherwise."),
      patient_message_for_caregiver: str("What they want passed to their caregiver or nurse. Empty if nothing."),
      patient_quote: str("One short, telling sentence they said, verbatim."),
      extraction_confidence: num("0 to 1: how sure you are this record matches what they said."),
    },
  },
  // Generating the full record takes a few seconds; force a short line first so the line is not silent.
  preToolSpeech: "force",
  // The browser waits up to ~22 s for the Daytona two-week analysis and returns a short summary
  // for the nurse to say before goodbye (or "Saved. Your nurse will review it." on timeout).
  expectsResponse: true,
  responseTimeoutSecs: 25,
};

const TOOLS = [TRIGGER_EMERGENCY_ALERT, SUBMIT_CHECKIN];

// Defaults so the agent also works when a variable is missing (e.g. dashboard tests).
const PLACEHOLDERS = {
  patient_id: "p1",
  preferred_name: "there",
  tone: "calm",
  language: "en",
  caregiver_name: "your family",
  medications: "your usual medicines",
  conditions: "none listed",
  next_call_time: "tomorrow morning",
  today_weekday: "unknown",
};

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
    console.error("ELEVENLABS_VOICE_ID is not set (the nurse speaks in Carolina's cloned voice).");
    process.exit(1);
  }
  const client = new ElevenLabsClient({ apiKey });
  const { prompt, firstMessage } = await loadPrompt();

  const toolIds = [];
  for (const tool of TOOLS) toolIds.push(await upsertTool(client, tool));

  const body = {
    name: AGENT_NAME,
    tags: ["still-kicking", "hackathon"],
    conversationConfig: {
      agent: {
        firstMessage,
        language: "en",
        // Typed as unknown in the SDK, so keys are sent as-is: use the API's snake_case.
        dynamicVariables: { dynamic_variable_placeholders: PLACEHOLDERS },
        prompt: {
          prompt,
          llm: LLM,
          temperature: TEMPERATURE,
          toolIds,
          builtInTools: {
            endCall: {
              type: "system",
              name: "end_call",
              description: "End the call after the goodbye, or after telling the person to call 911.",
              params: { systemToolType: "end_call" },
            },
          },
        },
      },
      // Warm and a little slower than default for older listeners.
      tts: { voiceId: VOICE_ID, modelId: TTS_MODEL, speed: 0.9, stability: 0.6, similarityBoost: 0.8 },
      // Older adults pause mid-sentence; give them time before the agent takes the turn.
      turn: { turnTimeout: 10, turnEagerness: "patient" },
      conversation: { maxDurationSeconds: 600 },
    },
    // Private agent: the browser can only connect with a conversation token from our server.
    platformSettings: { auth: { enableAuth: true } },
  };

  const rawId = process.env.ELEVENLABS_AGENT_ID?.trim() ?? "";
  const existingId = rawId.startsWith("agent_") ? rawId : "";
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

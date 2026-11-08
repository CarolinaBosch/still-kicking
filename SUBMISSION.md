# Still Kicking: submission text

- **Demo video:** https://www.loom.com/share/ede33ea18fb5446dbdf6dd002b8bd0f0
- **Repo:** https://github.com/CarolinaBosch/still-kicking
- **Live app:** https://still-kicking.vercel.app

## Short description (≤140 characters)

A warm AI nurse check-in for older adults at home: it spots changes, separates missed pills from real decline, and gets humans fast.

## Long description

Many older adults live alone with conditions like heart failure, COPD or dementia, where small daily changes matter: a few pounds of fluid, a new cough, a sudden bout of confusion. A nurse can't call everyone every day. Still Kicking is a voice check-in that can.

The Still Kicking nurse, an ElevenLabs agent running Claude, has a short, kind conversation: it confirms who answered, screens for red flags first, then asks questions adapted from INTERACT's "Stop and Watch" early-warning tool (a way to spot changes from a person's usual condition, not a diagnostic score), checks medications, and asks a few condition-specific questions. If the person mentions chest pain, a fall or trouble breathing, it alerts the nurse and caregiver during the call and tells them to hang up and call 911.

At the end of the call the agent submits a structured record. A fresh Daytona sandbox runs our engine on it and the patient's history: trend flags, pattern clusters, and a medication attribution that tells "he skipped his water pill" apart from "something new is happening". The nurse sees a traffic-light status, alerts and a plain-language caregiver summary.

It never diagnoses or advises on medication. It records what was said, flags, and hands off to people.

This is a hackathon prototype with three synthetic patients. Records, analysis and tests run on real Daytona sandboxes, and the agent's tools work over a live ElevenLabs connection. SMS is simulated, calls run in the browser rather than over the phone, and it is not ready for real patient data.

## How we built it

- **Voice:** ElevenLabs conversational agent with Claude Haiku 4.5 as the LLM, Carolina's cloned voice, two client tools (`trigger_emergency_alert`, `submit_checkin`), the `end_call` system tool, and dynamic variables per patient. The browser connects over WebRTC with a short-lived token from our server.
- **Backend:** Next.js API routes and a nurse dashboard. A store keeps an in-process cache and writes through to a Daytona records sandbox in the background, so emergencies never wait on the network.
- **Engine:** Python, stdlib only: red-flag rules, trend flags against the person's own baseline, pattern clusters, adherence attribution, caregiver summary. It runs in a fresh Daytona sandbox per call; its output is validated as untrusted.
- **Tests:** 36 engine tests that run in a Daytona sandbox from a dashboard button.
- **Process:** Carolina led a squad of Claude Code agents (lead, voice, sandbox, builder, demo) working in parallel against a fixed shared contract (`src/lib/types.ts`).

## Challenges

- **Daytona Volumes returned "Access denied" on our account.** We had planned to store records on a Volume. We switched to one long-lived, labeled records sandbox that is found or created on first use, auto-stops when idle and keeps its filesystem. The code is set up so moving to a Volume later only changes one file.
- **The record-building turn takes 7–8 seconds.** Producing the full structured record at the end of the call is the slowest step. We had the agent say "Let me save your notes for the nurse" before calling the tool, so the pause sounds natural rather than broken.
- **Designing for safety.** The agent must never diagnose, never advise on medicines, and never pretend help is coming. Emergencies fire the alert before the agent speaks, then send the person to 911. The engine's wording is "for the nurse to review", and both the agent's record and the engine's output are validated before they touch patient data.

## What's next

- Real outbound phone calls through Twilio at the person's preferred time.
- Real SMS to the nurse and caregiver.
- A setup call that builds the profile and baseline by voice.
- Spanish check-ins.
- Records on a Daytona Volume once our account has access.
- For any real use: BAAs, encryption, access control and audit logs, and clinical validation with nurses.

## Technologies

ElevenLabs Agents (conversational AI, voice cloning, client tools, WebRTC), Claude Haiku 4.5 (via ElevenLabs), Daytona (sandboxes, TypeScript SDK `@daytona/sdk`), Next.js 15, React 19, TypeScript, Tailwind CSS, Python 3 (stdlib), pytest / unittest, Claude Code.

## ElevenLabs

ElevenLabs is the whole patient-facing side. The "Still Kicking Nurse" agent runs Claude Haiku 4.5 inside ElevenLabs and speaks in Carolina's cloned voice, slowed slightly and with patient turn-taking so older adults can pause mid-sentence. Each call starts with dynamic variables (name, tone, caregiver, medications, conditions, next call time, today's weekday) so one agent can call any patient. Two client tools connect the conversation to our system: `trigger_emergency_alert` fires the moment a red flag is heard, and `submit_checkin` sends the structured record at the end. The built-in `end_call` tool lets the agent hang up on its own. The agent is private; the browser connects with a short-lived conversation token.

## Daytona

Daytona is the backend for patient data and every piece of analysis. Patient records live in a long-lived records sandbox (we planned a Volume, but it returned "Access denied" on our account). Every finished call spins up a fresh, labeled, ephemeral sandbox, uploads the engine and one input file, runs it, and deletes the sandbox, so one patient's data never shares a machine with another's and a bad run can't leak into the next. Against real Daytona, Walt's analysis took about 1.1 s end to end. The engine's output is treated as untrusted and validated field by field, no host secrets enter any sandbox, and every step has a timeout. The same pattern runs our 36 engine tests in a sandbox from a dashboard button.

## Team

- **Amy Tran**, team captain, senior student at SDSU
- **Carolina Bosch**
- A squad of Claude Code agents (lead, voice, sandbox, builder, demo)

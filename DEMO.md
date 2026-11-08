# Still Kicking: 2-minute demo (Loom)

Live site: **https://still-kicking.vercel.app**. Two windows side by side:
- **Left, the patient's phone:** `https://still-kicking.vercel.app/patient/walt` (later `/patient/rosa`). Carolina plays the patient by voice; the nurse agent speaks in her cloned voice.
- **Right, the nurse dashboard:** `https://still-kicking.vercel.app/` (alerts, summaries, 14-day pattern grid, Daytona sandbox ids).

**Rule for the whole recording: never narrate a result that didn't happen on screen.** If something fails, say so in one line and use the fallback.

The judges' flow we show: *someone talks → the agent calls a tool → Daytona runs it → the agent says the result out loud, in the same call.*

## Pre-recording checklist

- [ ] On the nurse dashboard press **Reset demo** (restores Rosa stable, Walt and Edie with 14 days of history). Wait for the list to reload.
- [ ] Chrome or Safari. Allow the microphone. One practice call, end it, then **Reset demo** again.
- [ ] **Headphones on** (the agent must not hear itself), but keep its voice audible in the recording.
- [ ] Close other apps that use the mic (Zoom, Meet). Notifications off. No keys or `.env.local` on screen.
- [ ] Arrange the two windows side by side; zoom so the nurse alert queue and Walt's pattern grid are readable.
- [ ] Plan the curveballs: interrupt the agent once, change one answer, ask one off-topic question.

## Script (target 2:00)

| Time | Carolina says / does | On screen | Fallback |
|---|---|---|---|
| 0:00–0:12 | "This is Still Kicking. The user: an older adult living alone with a chronic condition, and their worried family caregiver. The finish line: after every call, the nurse and caregiver know what changed in plain words, and get alerted right away if it's serious." | Nurse dashboard: the User / Finish line / How cards, Rosa, Walt, Edie | None needed |
| 0:12–0:20 | "Walt has heart failure. Here are his last 14 days." Point at Walt's pattern grid. Then on the left window, start the call. | Pattern grid; patient phone "Your nurse is calling" | If the call doesn't connect in 5 s: "The mic isn't connecting on this take" and go to the fallback run |
| 0:20–0:55 | Routine call as Walt, short answers: "Yes, it's Walt." No chest pain, no falls. **Interrupt once** while the nurse is talking. "My ankles are swollen, my shoes feel tight." "I skipped my water pill a couple of days." **Change an answer:** "Actually, I took it yesterday, I missed two days." **Off-topic:** "Who sees my answers?" (answers from the knowledge base, then steers back). "Three pillows." | Live captions; nurse asks one question at a time, recovers from the interruption, confirms the correction | If it loops: answer the question it asked, briefly. If it stalls over 10 s: "Let's wrap up" and end the call |
| 0:55–1:15 | Nurse: "Give me a moment while I look over the last two weeks for your nurse." (Expect ~6 s of quiet before that line while it builds the record; say "it's saving the check-in now".) **Daytona runs the engine**, then the nurse **says the result out loud in the same call** (plain words, "your nurse will look at…", a summary sent to the caregiver), then goodbye. | Patient phone: "Analyzing in Daytona…" → sandbox id. Nurse dashboard (within ~3 s): Walt red, new alert, caregiver summary, finding "likely medication-related" | If the spoken result doesn't come: it says "Saved, your nurse will review it". Say so, and show the nurse dashboard once the analysis lands |
| 1:15–1:25 | On the nurse dashboard: "A fresh Daytona sandbox ran our engine on this call plus 14 days of history. The grid shows it: missed water pill, then swelling and weight up. Likely the skipped dose, not a new decline. The nurse reviews it." Point at the **sandbox id**. | Finding, attribution, sandbox id, pattern grid | Read only what is on screen |
| 1:25–1:45 | Left window: open **Rosa**'s call screen, start the call. "Yes, it's Rosa." When asked about chest pain: "I have chest pressure right now." | Nurse tells her to hang up and call 911. Nurse dashboard: red emergency alert with **Simulated SMS** to nurse and caregiver, during the call (within ~3 s) | If no alert: "The tool didn't fire on this take". Don't claim it did |
| 1:45–2:00 | "It never diagnoses or gives medicine advice. It tells her to call 911 and gets the humans." Click **Acknowledge**. Close: "ElevenLabs runs the voice and tools, Daytona holds the records and runs every analysis. Still kicking." Optional if time: **Run tests in Daytona** (about 4 s, 33 passed). | Alert acknowledged | Skip the tests if over time |

## Fallback run (if the mic fails)

Say plainly that the live mic didn't work on this take, then show only paths that run on screen:
1. **Simulate missed call** three times on Edie → urgent "Unable to reach after 3 attempts" alert.
2. **Run tests in Daytona** → passed/failed counts and the sandbox id.
3. Walt's 14-day pattern grid (seeded data, labeled synthetic).

Do not narrate a voice call that didn't happen.

## Verified so far

| Run | Path | Result | Timing |
|---|---|---|---|
| curl, real Daytona | Patients load from the records sandbox | Rosa, Walt, Edie | n/a |
| curl, real Daytona | Emergency route | Alert + 2 simulated SMS | 0.14 s local, ~0.8–1.3 s on Vercel |
| curl, real Daytona | Walt check-in → engine | "possible heart failure worsening", likely_adherence_related, red, 1 new alert | 1.1 s total |
| curl, Vercel | New alert visible across all instances | 10/10 requests | within ~2 s |
| curl | Edie, 3 missed calls | "Unable to reach after 3 attempts" | n/a |
| curl | Run tests in Daytona | 33 passed, 0 failed | 3.6 s |
| typed text, live agent | "chest pressure" | `trigger_emergency_alert` fired, 911 instruction | 1.1 s |
| typed text, live agent | Walt full call | Record correct; Daytona summary spoken, then goodbye | record turn ~6 s |
| typed text, live agent | Correction, off-topic, medicine question, knowledge base, Spanish | All handled | turns 0.5–1.9 s (no speech) |
| mic | Walt routine call | Pending | |
| mic | Rosa chest pain | Pending | |

Once two mic runs in a row pass, record the Loom before anything else changes.

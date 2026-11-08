# Still Kicking: 2-minute demo (Loom)

Two calls: a routine check-in with Walt (heart failure, skipped Furosemide) and a chest-pain call with Rosa. Carolina plays the patient by voice; the nurse agent speaks in her cloned voice.

**Rule for the whole recording: never narrate a result that didn't happen on screen.** If something fails, say so in one line and switch to the fallback.

## Pre-recording checklist

- [ ] Press **Reset demo** once (restores the 3 seeded patients, clears today's calls and alerts). Wait for the patient list to reload.
- [ ] Chrome or Safari. Allow the microphone for localhost; do one 5-second test call and end it, then Reset demo again.
- [ ] Close other tabs and apps that use the mic (Zoom, Meet, other Loom tabs). Notifications off.
- [ ] No keys on screen: no `.env.local`, no terminal with env output, no ElevenLabs or Daytona dashboard pages that show API keys.
- [ ] Browser zoom so the patient list, call panel and alert queue fit in one screen.
- [ ] Headphones on (stops the agent hearing itself), but keep the agent's voice audible in the recording.
- [ ] Optional: a second tab with the GitHub repo open at `src/lib/daytona/` for the "how it works" beat.

## Script (target 2:00)

| Time | Carolina says / does | On screen | Fallback |
|---|---|---|---|
| 0:00–0:12 | Hook: "Millions of older adults live alone. A daily call catches problems early, but nurses can't call everyone. This is Still Kicking: a warm AI nurse check-in that knows when to get a human." | Dashboard: Rosa, Walt, Edie with status lights | None needed |
| 0:12–0:20 | "Three synthetic patients, 14 days of history each, loaded from a Daytona sandbox." Click **Walt**, then **Start check-in call**. | Walt's detail, call panel "Ringing…" | If the call doesn't connect in 5 s: "The mic isn't connecting, so I'll show the paths we've verified" and jump to the fallback run below |
| 0:20–0:55 | Routine call as Walt. Answer: "Yes, it's Walt." No chest pain, no falls. "I feel a bit more tired." "My ankles are swollen, my shoes are tight." "I skipped my water pill, the Furosemide, two days, I was going out." "Three pillows to sleep." Keep answers short. | Live captions; nurse speaks one question at a time | If the agent drifts or loops: answer the question it asked, briefly. If it stalls over 10 s: "Let's skip to the end" and click **End call** |
| 0:55–1:05 | Agent: "Let me save your notes for the nurse." Say: "That takes a few seconds while it builds the record." | Call panel waits (7–8 s), then "Analyzed in Daytona sandbox" | If no analysis after 20 s: "The analysis didn't come back live; here's the same path run earlier" and show the fallback run |
| 1:05–1:20 | "A fresh Daytona sandbox ran our engine on this call plus Walt's history. It found possible heart failure worsening, and says likely medication-related: he missed Furosemide. Status red, the nurse gets an alert. The caregiver summary is in plain language." Point at the sandbox id and timing. | Engine findings, "Likely medication-related", caregiver summary, sandbox id, Walt's light red, new alert | Read only what is on screen. If the attribution reads differently, say what it reads |
| 1:20–1:42 | Click **Rosa**, **Start check-in call**. Confirm "Yes, it's Rosa." When asked about chest pain: "Actually, I have chest pressure right now." | Agent tells her to hang up and call 911; red emergency alert appears in the queue with simulated SMS to nurse and caregiver | If the alert doesn't appear: "The tool didn't fire on this take" and show the fallback emergency below. Do not claim it fired |
| 1:42–1:52 | "The alert fired during the call, before the agent finished speaking. It never diagnoses and never says help is coming: it tells her to call 911 and gets the humans." Click **Acknowledge** on the alert. | Alert status acknowledged, SMS log | None needed |
| 1:52–2:00 | "How it works: ElevenLabs runs the voice agent with Claude and calls our tools. Daytona holds the records and runs every analysis and our tests in fresh sandboxes." Optional: click **Run tests in Daytona** (about 4 s). Close: "Still kicking." | Optional: "33 passed" with sandbox id | If tests don't return in 10 s, don't wait on camera; cut the beat |

## Fallback run (if the mic fails)

Show the dashboard and the paths we verified against real Daytona today, and say plainly that the live mic didn't work on this take:

1. **Simulate missed call** three times on Edie → urgent "Unable to reach after 3 attempts" alert.
2. **Run tests in Daytona** → passed/failed counts and the sandbox id.
3. Walt's analysis and Rosa's emergency can be driven by the same API routes the agent's tools call (`POST /api/calls/complete`, `POST /api/tools/emergency`). Only show results that come back on screen during the recording.

Do not narrate a voice call that didn't happen.

## Verified so far (no mic)

Logged from today's runs against the running app and real Daytona. The microphone flow has not been smoke-tested yet; add rows below as Carolina's mic runs complete.

| Run | Path | Result | Timing |
|---|---|---|---|
| curl | Patients load from Daytona records sandbox | Rosa, Walt, Edie | n/a |
| curl | Emergency route | Alert + 2 simulated SMS | 0.14 s |
| curl | Walt check-in → engine | "possible heart failure worsening", likely_adherence_related, status red, 1 new alert | 1.1 s total, engine sandbox ~0.86 s |
| curl | Edie, 3 missed calls | "Unable to reach after 3 attempts" | n/a |
| curl | Run tests in Daytona | 33 passed, 0 failed | 3.6 s |
| typed text, live agent | "chest pressure" | `trigger_emergency_alert` fired | 1.1 s after the message |
| typed text, live agent | Full heart-failure check-in | Record extracted correctly | record turn 7–8 s |
| mic | Walt routine call | Pending | |
| mic | Rosa chest pain | Pending | |

Once two mic runs in a row pass cleanly, record a backup video of the full flow before anything else changes.

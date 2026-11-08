# Still Kicking: hackathon plan

Time box: **2.5 hours**. Feature freeze at **+1:45**, then demo prep only. Judges will read the Daytona code.

## Pitch
A warm AI nurse check-in for older adults living at home. It talks with them, notices changes against their own baseline, tells skipped medication apart from real decline, writes the caregiver a plain-language summary, and escalates to humans the moment something looks serious. It never diagnoses or advises on medication.

## Demo (target 2:30)
1. Nurse dashboard: 3 synthetic patients (stable / skipped diuretic → swelling / UTI-like confusion), 14 days of history, status lights.
2. "Start check-in" for a patient: the agent (ElevenLabs, browser call) runs the red-flag screen, Stop and Watch, meds, close. At the end it calls `submit_checkin` with the structured record.
3. A fresh Daytona sandbox runs the engine on the call + 14-day history: trend rules, pattern clusters, medication attribution, caregiver summary. Panel shows findings + sandbox id.
4. Emergency: patient says "I have chest pain". Agent calls `trigger_emergency_alert` DURING the call, tells them to call 911; the dashboard shows a red alert + simulated SMS to nurse and caregiver instantly.
5. "Simulate missed call" ×3 → urgent alert "Unable to reach after 3 attempts". Nurse acknowledges, adds a note, resolves.
6. "Run tests in Daytona": pytest for red-flag rules and 3-missed-call logic runs in a sandbox; shows N passed + sandbox id.

## Daytona (central, not decorative)
- **Records store:** patient records persisted in Daytona (volume if the tier allows; else a long-lived records sandbox). Fallback recorded in code comments.
- **Engine:** `engine/` Python (stdlib only) runs in a fresh, labeled, ephemeral sandbox per call. Output is untrusted and validated.
- **Tests:** `engine/tests/` pytest runs in a sandbox from the dashboard.
- No host secrets in sandboxes. Always pass `apiUrl` to the SDK. Sandboxes have limited internet (PyPI/GitHub ok).

## Interface contract
Types: `src/lib/types.ts`. Store facade: `src/lib/store/index.ts` (function signatures fixed).

| Part | Owner | Files |
|---|---|---|
| Daytona store, engine, tests, seed data | hack-sandbox | `src/lib/store/`, `src/lib/daytona/`, `engine/**`, `data/seed/patients.json` |
| Voice agent + call UI | hack-voice | `scripts/create-agent.mjs`, `docs/agent-prompt.md`, `src/components/Conversation.tsx`, `src/components/CallPanel.tsx`, `src/app/api/elevenlabs/token/route.ts` |
| API routes + dashboard | hack-builder | `src/app/api/**` (except token), `src/app/page.tsx`, `src/components/*` (except voice files) |

### API routes (hack-builder)
- `GET /api/patients` → `PatientState[]`
- `GET /api/patients/[id]` → `PatientState`
- `POST /api/tools/emergency` `EmergencyInput` → `Alert` (client tool, during the call)
- `POST /api/calls/complete` `CheckinRecord` → `AnalysisResult`
- `POST /api/calls/missed` `{patient_id}` → `MissedCallResult`
- `POST /api/alerts/[id]` `{action, by, note?}` → `Alert`
- `POST /api/tests/run` → `TestRunResult`
- `POST /api/demo/reset` → `{ok:true}`
Errors: `ToolError` with an HTTP status.

### Voice client contract (hack-voice ↔ hack-builder)
`<CallPanel patient={Patient} onEmergency={(a: Alert) => void} onAnalysis={(r: AnalysisResult) => void} />`
- Dynamic variables passed at session start: `preferred_name, tone, language, caregiver_name, medications, conditions, next_call_time, patient_id`.
- Client tools: `trigger_emergency_alert(EmergencyInput)` → POST /api/tools/emergency; `submit_checkin(CheckinRecord without call_id/timestamp)` → POST /api/calls/complete (client adds call_id + timestamp).

## Cut (on purpose)
Setup calls (seeded instead), Twilio phone calls (stretch), real SMS (logged on dashboard), Spanish (stretch), weekly charts.

## Safety
Synthetic data only. Public repo. No keys in code. Disclaimer in README.

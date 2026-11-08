"use client";

// Presenter guide for the 2-minute live demo. Every step is a real action in the app:
// it only selects the right patient and points at the part of the screen to use.
import { useEffect, useState } from "react";
import type { PatientState } from "@/lib/types";

interface Step {
  title: string;
  time: string;
  patientName: string | null; // matched on preferred_name or name
  spot: string; // data-tour target
  doThis: string;
  say: string;
}

const STEPS: Step[] = [
  {
    title: "User and finish line",
    time: "0:00",
    patientName: "Walt",
    spot: "patterns",
    doThis: "Point at Walter's last 14 days: swelling and weight climbing on the days he skipped his water pill.",
    say: "Walter is 83, has heart failure and lives alone. Done means his nurse and his daughter know today, in plain words.",
  },
  {
    title: "Live check-in",
    time: "0:15",
    patientName: "Walt",
    spot: "call",
    doThis: "Press Start check-in call and answer as Walter. Interrupt the nurse once, and change one answer mid-call.",
    say: "\"My ankles are puffy again… I skipped my water pill, I didn't want to keep running to the bathroom.\" Then: \"Actually, I did take it this morning.\"",
  },
  {
    title: "Daytona result, out loud",
    time: "0:55",
    patientName: "Walt",
    spot: "summary",
    doThis: "At the close the agent calls submit_checkin; a fresh Daytona sandbox runs the engine and the agent says the result before goodbye. Point at the sandbox id.",
    say: "The trend, the missed-dose check and this caregiver summary were computed in a Daytona sandbox during the call.",
  },
  {
    title: "Emergency",
    time: "1:20",
    patientName: "Rosa",
    spot: "call",
    doThis: "Start Rosa's call and say you have chest pain. Watch the red alert and the SMS to nurse and caregiver appear while she's still talking.",
    say: "\"I have chest pain right now.\" The agent tells her to call 911 and alerts both humans at the same moment.",
  },
  {
    title: "No answer ×3",
    time: "1:40",
    patientName: "Edie",
    spot: "missed",
    doThis: "Press Simulate missed call three times. The third one escalates to a human nurse.",
    say: "If she doesn't pick up three times, a person takes over.",
  },
  {
    title: "Tests in Daytona",
    time: "1:50",
    patientName: null,
    spot: "tests",
    doThis: "Press Run tests in Daytona: the red-flag and missed-call rules run with pytest in a sandbox.",
    say: "Never diagnoses, never touches medication. It observes, flags and hands off to people.",
  },
];

function findPatient(patients: PatientState[], name: string | null) {
  if (!name) return null;
  const n = name.toLowerCase();
  return patients.find((s) => s.patient.preferred_name.toLowerCase() === n || s.patient.name.toLowerCase().startsWith(n)) ?? null;
}

export function DemoTour({
  patients,
  onSelect,
  children,
}: {
  patients: PatientState[] | null;
  onSelect: (id: string) => void;
  children: React.ReactNode; // tests + reset controls
}) {
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (step === null) return;
    const target = STEPS[step].spot;
    // Wait a frame so a newly selected patient's panels are mounted.
    const t = setTimeout(() => {
      document.querySelectorAll(".tour-spot").forEach((el) => el.classList.remove("tour-spot"));
      const el = document.querySelector(`[data-tour="${target}"]`);
      if (el) {
        el.classList.add("tour-spot");
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 120);
    return () => clearTimeout(t);
  }, [step, patients]);

  function go(i: number) {
    setStep(i);
    const p = patients ? findPatient(patients, STEPS[i].patientName) : null;
    if (p) onSelect(p.patient.id);
  }

  function close() {
    setStep(null);
    document.querySelectorAll(".tour-spot").forEach((el) => el.classList.remove("tour-spot"));
  }

  const s = step === null ? null : STEPS[step];
  return (
    <section className="tour" aria-label="Demo tour">
      <div className="tour-top">
        <span className="eyebrow">2-minute demo</span>
        {step === null ? (
          <button type="button" className="btn-quiet" onClick={() => go(0)}>
            Start tour
          </button>
        ) : (
          <>
            <button type="button" className="btn-quiet" onClick={() => go(Math.max(0, step - 1))} disabled={step === 0}>
              Back
            </button>
            <button type="button" className="btn-quiet" onClick={() => (step < STEPS.length - 1 ? go(step + 1) : close())}>
              {step < STEPS.length - 1 ? "Next step" : "Finish tour"}
            </button>
            <button type="button" className="btn-quiet" onClick={close}>
              Hide
            </button>
          </>
        )}
        <span data-tour="tests" style={{ display: "contents" }}>
          {children}
        </span>
      </div>
      {step !== null && (
        <>
          <ol className="tour-steps">
            {STEPS.map((st, i) => (
              <li key={st.title}>
                <button type="button" className="tour-step" aria-current={i === step ? "step" : undefined} onClick={() => go(i)}>
                  <span className="tour-num">{i + 1}</span>
                  {st.title} <span className="text-faint">{st.time}</span>
                </button>
              </li>
            ))}
          </ol>
          {s && (
            <div className="tour-note" aria-live="polite">
              <p>
                <strong>Do:</strong> {s.doThis}
              </p>
              <p>
                <strong>Say:</strong> <span className="tour-say">{s.say}</span>
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

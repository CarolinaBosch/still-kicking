"use client";

// Patient-facing call screen: just the call. No clinical data, alerts or other patients.
import { useCallback, useEffect, useState } from "react";
import CallPanel from "@/components/CallPanel";
import type { PatientState } from "@/lib/types";
import { api, nurseName, patientSlug } from "./client-api";
import { ErrorNote, Spinner } from "./ui";

type Load = { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; state: PatientState };

export default function PatientCallScreen({ slug }: { slug: string }) {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const key = decodeURIComponent(slug).trim().toLowerCase();

  const fetchPatient = useCallback(async () => {
    setLoad({ phase: "loading" });
    try {
      const { data } = await api<PatientState[]>("/api/patients", { timeoutMs: 20_000 });
      const match = data.find((s) => s.patient.id.toLowerCase() === key || patientSlug(s.patient) === key);
      setLoad(match ? { phase: "ready", state: match } : { phase: "error", message: "We could not find this call." });
    } catch (err) {
      setLoad({ phase: "error", message: err instanceof Error ? err.message : "Could not load your call." });
    }
  }, [key]);

  useEffect(() => {
    void fetchPatient();
  }, [fetchPatient]);

  // The nurse dashboard picks up alerts and analysis from the server by polling; nothing to do here.
  const noop = useCallback(() => {}, []);

  return (
    <main className="phone-shell">
      <div className="phone">
        <p className="phone-brand">Still Kicking</p>
        {load.phase === "loading" && (
          <div className="phone-center" aria-busy="true">
            <Spinner label="Connecting…" />
          </div>
        )}
        {load.phase === "error" && <ErrorNote message={load.message} onRetry={() => void fetchPatient()} />}
        {load.phase === "ready" && (
          <>
            <p className="phone-hi">Hi {load.state.patient.preferred_name}</p>
            <h1 className="phone-title">
              Still Kicking nurse is calling
              <span className="phone-sub">on behalf of Nurse {nurseName(load.state.patient.nurse.name)}</span>
            </h1>
            <p className="phone-note">
              Your check-in summary goes to Nurse {nurseName(load.state.patient.nurse.name).split(" ")[0]} and{" "}
              {load.state.patient.caregiver.name}.
            </p>
            <CallPanel patient={load.state.patient} onEmergency={noop} onAnalysis={noop} />
          </>
        )}
        <p className="phone-foot">Prototype. Not a replacement for 911. Synthetic patient.</p>
      </div>
    </main>
  );
}

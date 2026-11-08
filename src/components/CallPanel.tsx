"use client";

// PLACEHOLDER owned by hack-voice. Replaced at merge by the real ElevenLabs call panel.
// It only fixes the props contract so the dashboard builds: see HACKATHON.md "Voice client contract".
import type { Alert, AnalysisResult, Patient } from "@/lib/types";

export interface CallPanelProps {
  patient: Patient;
  onEmergency: (a: Alert) => void;
  onAnalysis: (r: AnalysisResult) => void;
}

export function CallPanel({ patient }: CallPanelProps) {
  return (
    <div className="callpanel-placeholder">
      <p className="font-semibold">Voice check-in for {patient.preferred_name}</p>
      <p className="text-muted">The call panel is not wired up in this build yet.</p>
    </div>
  );
}

export default CallPanel;

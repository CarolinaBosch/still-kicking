// In-process mirror of engine/attempts.py (the canonical, sandbox-tested rule).
// A missed call must update the dashboard instantly, so it does not wait for a
// sandbox; engine/tests/test_attempts.py pins the behavior both follow.

import type { CallAttempt } from "../types";

export const ESCALATE_AFTER = 3;

/** Trailing unanswered attempts (attempts ordered oldest first). */
export function consecutiveMissed(attempts: CallAttempt[]): number {
  let count = 0;
  for (let i = attempts.length - 1; i >= 0 && !attempts[i].answered; i--) count++;
  return count;
}

export function shouldEscalate(attempts: CallAttempt[], hasOpenMissedAlert: boolean): boolean {
  return consecutiveMissed(attempts) >= ESCALATE_AFTER && !hasOpenMissedAlert;
}

/**
 * recording_badge.js — the blinking "REC · This interview is being recorded"
 * indicator on the candidate feed (16 Sep 2026).
 *
 * Shown the moment the candidate is live (first question on screen, proctoring
 * armed) and hidden as soon as the interview is being finalised, whichever of
 * the finalisation paths runs — so it never blinks over a "Thank you" screen.
 */
const BADGE_ID = "recordingBadge";

export function setRecordingBadge(visible) {
  const el = document.getElementById(BADGE_ID);
  if (!el) return;
  el.hidden = !visible;
  el.setAttribute("aria-hidden", visible ? "false" : "true");
}

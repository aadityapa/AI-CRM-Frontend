/**
 * The default recommendation RMG / GM hand to Sales (28 Sep 2026, user ask:
 * "when RMG / GM submit to Sales the message comes by default from the
 * interviews — no manual typing"). One read, `GET …/handover-note` (B-V2
 * `services/handover_note.py`): the recorded rounds, the AI L1, the skill
 * evaluation and the candidate's facts. Every Submit-to-Sales dialog
 * pre-fills its comment with it; the text stays editable.
 *
 * 29 Sep 2026: the same read carries `checks` — what Sales needs (CTCs, notice,
 * experience, locations, contact, CV, the technical verdict) — rendered by
 * `SalesReadinessPanel` so RMG / GM verify, and fill a gap, before submitting.
 */
import { useEffect, useState } from "react";

import { crmGet } from "../api";

export type SalesCheck = {
  key: string;
  label: string;
  value: string | null;
  ok: boolean;
  required: boolean;
  /** `PATCH …/sales-details` key to fill it inline; null = filled elsewhere. */
  field: string | null;
  input: "money_lac" | "number" | "text";
  hint: string | null;
};

/** `note` is "" until loaded (or when the read fails — the field stays typeable). */
export function useHandoverNote(profileId: number | null | undefined, enabled = true): {
  note: string; loading: boolean; checks: SalesCheck[] | null; setChecks: (c: SalesCheck[]) => void;
} {
  const [state, setState] = useState<{ note: string; loading: boolean; checks: SalesCheck[] | null }>(
    { note: "", loading: !!(enabled && profileId), checks: null });
  useEffect(() => {
    if (!enabled || !profileId) { setState({ note: "", loading: false, checks: null }); return; }
    let alive = true;
    setState({ note: "", loading: true, checks: null });
    crmGet<{ note: string; checks?: SalesCheck[] }>(`/api/candidate-profiles/${profileId}/handover-note`)
      .then((r) => { if (alive) setState({ note: r.data?.note || "", loading: false, checks: r.data?.checks ?? [] }); })
      .catch(() => { if (alive) setState({ note: "", loading: false, checks: [] }); });
    return () => { alive = false; };
  }, [profileId, enabled]);
  return { ...state, setChecks: (checks) => setState((s) => ({ ...s, checks })) };
}

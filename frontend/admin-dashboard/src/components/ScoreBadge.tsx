import { useEffect, useMemo, useState } from "react";
import { normalizeScore } from "../utils/scoreUtils";

export function ScoreBadge({ score }: { score: number }) {
  const target = useMemo(() => normalizeScore(score), [score]);
  const [val, setVal] = useState(target);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = val;
    const to = target;
    const dur = 420;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const next = Math.round(from + (to - from) * (0.2 + 0.8 * p));
      setVal(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const cls = val >= 80 ? "text-success" : val >= 70 ? "text-warning" : "text-danger";
  return <span className={`text-display text-lg font-bold tabular-nums ${cls}`}>{val}%</span>;
}


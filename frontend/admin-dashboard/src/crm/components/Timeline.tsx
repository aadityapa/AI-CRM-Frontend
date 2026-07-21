/** Vertical activity-log timeline. */
import React from "react";

export type ActivityEntry = {
  id: number;
  action_type: string;
  comment?: string | null;
  timestamp: string;
  username?: string;
  full_name?: string;
};

export function Timeline({ entries }: { entries: ActivityEntry[] }) {
  if (!entries.length) {
    return <div className="py-6 text-center text-sm text-slate-500">No activity yet</div>;
  }
  return (
    <ol className="relative ml-3 border-l-2 border-slate-200 dark:border-slate-700">
      {entries.map((e) => (
        <li key={e.id} className="mb-5 ml-5">
          <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white dark:border-slate-900 bg-sky-500" />
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {String(e.action_type || "").replace(/_/g, " ")}
          </div>
          {e.comment && <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{e.comment}</div>}
          <div className="mt-0.5 text-xs text-slate-400">
            {e.full_name || e.username || "system"} · {new Date(e.timestamp).toLocaleString()}
          </div>
        </li>
      ))}
    </ol>
  );
}

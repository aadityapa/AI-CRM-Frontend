import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { brand, chartPalette, neutral, violet } from "../../design-system/tokens/tokens";

/* Colors come from the typed token mirrors (design-system/tokens/tokens.ts) —
 * recharts resolves fills once at render, so static mirrors keep this
 * deterministic. No ad-hoc hex in chart code. */

export function SkillBarChart({ data }: { data: { skill: string; score: number }[] }) {
  const chartData = (data || []).map((d) => ({
    name: d.skill.length > 18 ? `${d.skill.slice(0, 16)}…` : d.skill,
    full: d.skill,
    score: Math.max(0, Math.min(100, Math.round(Number(d.score) || 0))),
  }));
  if (!chartData.length) {
    return (
      <div className="flex h-52 items-center justify-center rounded-card border border-dashed border-subtle text-sm text-muted">
        No per-skill breakdown for this interview.
      </div>
    );
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
          <defs>
            <linearGradient id="kx-skill-bar" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={brand[500]} />
              <stop offset="100%" stopColor={violet[500]} />
            </linearGradient>
          </defs>
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} stroke={neutral[400]} />
          <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} stroke={neutral[500]} />
          <Tooltip
            formatter={(v: number) => [`${v}%`, "Score"]}
            labelFormatter={(_, payload) => (payload?.[0]?.payload?.full as string) || ""}
            contentStyle={{ borderRadius: 10, border: `1px solid ${neutral[200]}` }}
          />
          <Bar dataKey="score" radius={[0, 6, 6, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={i === 0 ? "url(#kx-skill-bar)" : chartPalette[i % chartPalette.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

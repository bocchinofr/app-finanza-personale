// components/fire/FireProjectionChart.tsx
"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import type { AnnoProiezione } from "@/lib/fireCalculations";

interface FireProjectionChartProps {
  proiezione: AnnoProiezione[];
}

function formatEuroCompact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k`;
  return `${Math.round(v)}`;
}

interface TooltipPayloadItem {
  color: string;
  name: string;
  value: number;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm shadow-sm">
      <p className="font-medium text-stone-700">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: € {p.value.toLocaleString("it-IT", { maximumFractionDigits: 0 })}
        </p>
      ))}
    </div>
  );
}

export default function FireProjectionChart({ proiezione }: FireProjectionChartProps) {
  const annoFire = proiezione.find((a) => a.fireRaggiunto)?.anno;

  const dati = proiezione.map((a) => ({
    anno: a.anno,
    "Patrimonio rilevante": Math.round(a.patrimonioRilevantePerFire),
    "FIRE number target": Math.round(a.fireNumberTarget),
    "Patrimonio totale": Math.round(a.patrimonioTotale),
  }));

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <p className="mb-4 text-sm text-stone-500">Proiezione patrimonio vs obiettivo FIRE</p>
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={dati} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
          <XAxis dataKey="anno" tick={{ fontSize: 12, fill: "#78716c" }} />
          <YAxis
            tickFormatter={formatEuroCompact}
            tick={{ fontSize: 12, fill: "#78716c" }}
            width={48}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {annoFire && (
            <ReferenceLine
              x={annoFire}
              stroke="#059669"
              strokeDasharray="4 4"
              label={{ value: "FIRE", position: "top", fill: "#059669", fontSize: 12 }}
            />
          )}
          <Line
            type="monotone"
            dataKey="Patrimonio rilevante"
            stroke="#0f766e"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="FIRE number target"
            stroke="#dc2626"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="Patrimonio totale"
            stroke="#a8a29e"
            strokeWidth={1}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

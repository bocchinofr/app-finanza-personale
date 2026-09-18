// components/fire/FireReviewCard.tsx
"use client";

import type { ConfrontoAnnuale } from "@/lib/fireCalculations";

interface FireReviewCardProps {
  confronto: ConfrontoAnnuale;
  annoSnapshot: number; // anno in cui la previsione è stata congelata
}

function formatEuro(v: number): string {
  return v.toLocaleString("it-IT", { maximumFractionDigits: 0 });
}

function Riga({
  label,
  reale,
  previsto,
  invertiColore = false, // true per le spese: reale < previsto è positivo
}: {
  label: string;
  reale: number;
  previsto: number;
  invertiColore?: boolean;
}) {
  const scostamentoPct = previsto !== 0 ? ((reale - previsto) / Math.abs(previsto)) * 100 : 0;
  const positivo = invertiColore ? scostamentoPct <= 0 : scostamentoPct >= 0;
  const colore = positivo ? "text-emerald-700" : "text-amber-700";
  const segno = scostamentoPct >= 0 ? "+" : "";

  return (
    <div className="flex items-center justify-between border-b border-stone-100 py-2.5 last:border-0">
      <span className="text-sm text-stone-600">{label}</span>
      <div className="text-right">
        <p className="font-mono text-sm text-stone-800">
          € {formatEuro(reale)}{" "}
          <span className="text-stone-400">/ € {formatEuro(previsto)} previsti</span>
        </p>
        <p className={`text-xs font-medium ${colore}`}>
          {segno}
          {scostamentoPct.toFixed(1)}%
        </p>
      </div>
    </div>
  );
}

export default function FireReviewCard({ confronto, annoSnapshot }: FireReviewCardProps) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="mb-1 flex items-baseline justify-between">
        <p className="text-sm text-stone-500">Andamento {confronto.anno}</p>
        <p className="text-[11px] text-stone-400">
          previsione congelata a inizio {annoSnapshot}
        </p>
      </div>

      <div className="mt-2">
        <Riga label="Spese annualizzate" reale={confronto.speseReali} previsto={confronto.speseSimulate} invertiColore />
        <Riga
          label="Investimento annualizzato"
          reale={confronto.investimentoReale}
          previsto={confronto.investimentoSimulato}
        />
        <Riga label="Patrimonio (oggi vs fine anno previsto)" reale={confronto.patrimonioReale} previsto={confronto.patrimonioSimulato} />
      </div>

      <p className="mt-3 text-[11px] leading-snug text-stone-400">
        Spese e investimento sono già annualizzati sul ritmo attuale, quindi confrontabili con la proiezione a fine anno. Il patrimonio è il valore di oggi confrontato con il target di fine anno: a metà anno uno scostamento negativo è normale.
      </p>
    </div>
  );
}

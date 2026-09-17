// components/fire/RunwayCard.tsx
"use client";

import { useState } from "react";
import type { RunwayResult } from "@/lib/fireCalculations";

interface RunwayCardProps {
  calcolaRunway: (includiFondoPensione: boolean) => RunwayResult;
}

export default function RunwayCard({ calcolaRunway }: RunwayCardProps) {
  const [includiFondoPensione, setIncludiFondoPensione] = useState(false);
  const risultato = calcolaRunway(includiFondoPensione);

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm text-stone-500">Runway — se smettessi oggi</p>
        <label className="flex items-center gap-1.5 text-xs text-stone-400">
          <input
            type="checkbox"
            checked={includiFondoPensione}
            onChange={(e) => setIncludiFondoPensione(e.target.checked)}
          />
          includi fondo pensione
        </label>
      </div>

      <div className="mt-3">
        {risultato.sostenibileIndefinitamente ? (
          <>
            <p className="font-serif text-3xl text-emerald-700">Indefinitamente</p>
            <p className="mt-0.5 text-xs text-stone-400">
              il rendimento netto copre le spese proiettate entro l&apos;orizzonte
              considerato
            </p>
          </>
        ) : (
          <>
            <p className="font-mono text-3xl text-stone-800">
              {risultato.anniDiAutonomia} anni
            </p>
            <p className="mt-0.5 text-xs text-stone-400">
              capitale esaurito nel {risultato.annoEsaurimento} (età{" "}
              {risultato.etaEsaurimento})
            </p>
          </>
        )}
      </div>
    </div>
  );
}

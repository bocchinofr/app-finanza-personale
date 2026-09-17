// components/fire/FireNumberCard.tsx
"use client";

import type { FireNumberResult } from "@/lib/fireCalculations";

interface FireNumberCardProps {
  risultato: FireNumberResult;
}

function formatEuro(v: number): string {
  return v.toLocaleString("it-IT", { maximumFractionDigits: 0 });
}

export default function FireNumberCard({ risultato }: FireNumberCardProps) {
  const raggiunto = risultato.anniMancanti !== null && risultato.anniMancanti <= 0;

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <p className="text-sm text-stone-500">FIRE Number</p>
      <p className="mt-1 font-serif text-3xl text-stone-800">
        € {formatEuro(risultato.fireNumberOggi)}
      </p>
      <p className="mt-0.5 text-xs text-stone-400">
        capitale target su spese attuali (spese / SWR)
      </p>

      <div className="mt-4 border-t border-stone-100 pt-4">
        {risultato.annoStimato === null ? (
          <p className="text-sm text-amber-600">
            Non raggiunto entro l&apos;orizzonte di proiezione impostato.
          </p>
        ) : raggiunto ? (
          <p className="text-sm text-emerald-700">
            Obiettivo già raggiunto oggi.
          </p>
        ) : (
          <>
            <p className="font-mono text-xl text-emerald-700">
              {risultato.anniMancanti} anni
            </p>
            <p className="text-xs text-stone-400">
              stimato per il {risultato.annoStimato} (età {risultato.etaStimata})
            </p>
          </>
        )}
      </div>
    </div>
  );
}

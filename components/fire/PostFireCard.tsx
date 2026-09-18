// components/fire/PostFireCard.tsx
"use client";

import type { PostFireResult } from "@/lib/fireCalculations";

interface PostFireCardProps {
  risultato: PostFireResult;
  etaRitiroFondoPensione: number;
}

export default function PostFireCard({
  risultato,
  etaRitiroFondoPensione,
}: PostFireCardProps) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <p className="text-sm text-stone-500">Dopo il pensionamento</p>

      <div className="mt-3">
        {!risultato.applicabile ? (
          <>
            <p className="font-serif text-2xl text-stone-400">—</p>
            <p className="mt-0.5 text-xs text-stone-400">
              Raggiungi prima il FIRE number: qui vedrai per quanto dura il capitale
              dopo il pensionamento.
            </p>
          </>
        ) : risultato.sostenibileFinoOrizzonte ? (
          <>
            <p className="font-serif text-3xl text-emerald-700">
              Copre l&apos;intero orizzonte
            </p>
            <p className="mt-0.5 text-xs text-stone-400">
              il capitale non si esaurisce nella proiezione, anche considerando lo
              sblocco del fondo pensione a {etaRitiroFondoPensione} anni
            </p>
          </>
        ) : (
          <>
            <p className="font-mono text-3xl text-amber-700">
              {risultato.anniDiRendita} anni
            </p>
            <p className="mt-0.5 text-xs text-stone-400">
              capitale esaurito nel {risultato.annoEsaurimento} (età{" "}
              {risultato.etaEsaurimento}) — considera di rivedere spese, SWR o età di
              pensionamento
            </p>
          </>
        )}
      </div>
    </div>
  );
}

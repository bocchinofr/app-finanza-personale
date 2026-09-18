// components/fire/FireInfoBox.tsx
"use client";

import { useState } from "react";

export default function FireInfoBox() {
  const [aperto, setAperto] = useState(false);

  return (
    <div className="rounded-xl border border-stone-200 bg-white">
      <button
        type="button"
        onClick={() => setAperto((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-stone-700">
          Come funziona questo calcolo
        </span>
        <span className="text-stone-400">{aperto ? "−" : "+"}</span>
      </button>

      {aperto && (
        <div className="space-y-4 border-t border-stone-200 px-4 py-4 text-sm leading-relaxed text-stone-600">
          <div>
            <p className="font-medium text-stone-700">Due fasi, una sola proiezione</p>
            <p className="mt-1">
              Fino a quando il tuo patrimonio non raggiunge il FIRE number sei in{" "}
              <strong>accumulo</strong>: ogni anno investi la cifra impostata e le
              spese non intaccano il capitale (si assume che le copra il reddito da
              lavoro). Dall&apos;anno successivo al raggiungimento entri in{" "}
              <strong>decumulo</strong>: niente più investimento, le spese nette
              vengono prelevate ogni anno dal capitale. Il grafico mostra entrambe le
              fasi sulla stessa linea temporale.
            </p>
          </div>

          <div>
            <p className="font-medium text-stone-700">FIRE number</p>
            <p className="mt-1">
              È il capitale che ti serve per vivere di rendita: spese annue nette ÷
              SWR. Con SWR al 4%, per 30.000 €/anno di spesa servono 750.000 €. Si
              ricalcola anno per anno sulle spese proiettate (quindi già al netto di
              debiti estinti e dell&apos;eventuale integrazione da fondo pensione).
            </p>
          </div>

          <div>
            <p className="font-medium text-stone-700">Fondo pensione: bloccato, poi sbloccato</p>
            <p className="mt-1">
              Fino all&apos;età di sblocco impostata (default 67 anni) il fondo
              pensione cresce ma non è disponibile: non conta nel patrimonio a meno
              che tu non attivi &quot;Conta anche da bloccato&quot;. Al raggiungimento
              dell&apos;età si divide in due: una quota una tantum (tipo TFR) che si
              somma al capitale investito, e il resto come integrazione annua che
              riduce le spese da coprire con il resto del portafoglio. Da quel momento
              il fondo pensione come voce a sé smette di generare rendimento proprio.
            </p>
          </div>

          <div>
            <p className="font-medium text-stone-700">Debiti</p>
            <p className="mt-1">
              Una rata (es. il mutuo) resta dentro le spese finché non raggiungi
              l&apos;anno di estinzione impostato; da quell&apos;anno sparisce dalle
              spese. Non aumenta automaticamente l&apos;investimento: decidi tu, nel
              pannello parametri, se destinarla altrove.
            </p>
          </div>

          <div>
            <p className="font-medium text-stone-700">Tasse e assunzioni</p>
            <p className="mt-1">
              I rendimenti su investimenti e fondo pensione sono già calcolati al
              netto delle rispettive aliquote (editabili). Spese, investimento e
              inflazione restano costanti nel tempo a meno che tu non imposti una
              crescita percentuale annua per ciascuno.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

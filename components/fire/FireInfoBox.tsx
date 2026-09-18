// components/fire/FireInfoBox.tsx
'use client'
import { useState } from 'react'

export default function FireInfoBox() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Come funziona il calcolo FIRE"
        className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-gray-300 text-gray-500 text-[11px] font-semibold hover:bg-gray-100 hover:text-gray-700 transition-colors"
      >
        i
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Come funziona questo calcolo</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1">✕</button>
            </div>

            <div className="space-y-4 text-xs text-gray-600 leading-relaxed">
              <div>
                <p className="font-semibold text-gray-800 mb-1">Due fasi, una sola proiezione</p>
                <p>
                  Fino a quando il patrimonio non raggiunge il FIRE number sei in <strong>accumulo</strong>: ogni
                  anno investi la cifra impostata e le spese non intaccano il capitale (si assume che le copra il
                  reddito da lavoro). Dall&apos;anno successivo al raggiungimento entri in <strong>decumulo</strong>:
                  niente più investimento, le spese nette vengono prelevate ogni anno dal capitale. Il grafico
                  mostra entrambe le fasi sulla stessa linea temporale.
                </p>
              </div>

              <div>
                <p className="font-semibold text-gray-800 mb-1">Quando sei &ldquo;FIRE&rdquo;</p>
                <p>
                  Non un rapporto fisso (spese ÷ SWR), ma una <strong>verifica simulata</strong>:
                  ogni anno, finché sei in accumulo, si controlla &ldquo;se smettessi di investire
                  da qui, il capitale arriverebbe vivo fino a fine orizzonte?&rdquo; simulando un
                  intero decumulo con le tue assunzioni reali (rendimento, tasse, inflazione,
                  crescita spese, sblocco fondo pensione). Il primo anno in cui la risposta è sì è
                  il tuo anno di raggiungimento. Il &ldquo;FIRE number&rdquo; (spese ÷ SWR) resta
                  mostrato come riferimento della regola storica del 4%, ma non decide più il
                  passaggio da accumulo a decumulo.
                </p>
              </div>

              <div>
                <p className="font-semibold text-gray-800 mb-1">Perché può scattare prima o dopo il riferimento del 4%</p>
                <p>
                  Se le tue spese restano piatte (crescita 0%) o il tuo orizzonte è più corto dei
                  30+ anni assunti dalla regola storica, può bastare meno del target spese/SWR. Se
                  invece le spese crescono più del margine tra rendimento netto e SWR, può servire
                  di più. La simulazione riflette il tuo caso, non la media storica.
                </p>
              </div>

              <div>
                <p className="font-semibold text-gray-800 mb-1">Fondo pensione: bloccato, poi sbloccato</p>
                <p>
                  Fino all&apos;età di sblocco impostata (default 67 anni) il fondo pensione cresce ma non è
                  disponibile: non conta nel patrimonio a meno che tu non attivi &ldquo;Conta anche da
                  bloccato&rdquo;. Al raggiungimento dell&apos;età si divide in due: una quota una tantum (tipo
                  TFR) che si somma al capitale investito, e il resto come integrazione annua che riduce le spese
                  da coprire con il resto del portafoglio. Da quel momento il fondo pensione come voce a sé
                  smette di generare rendimento proprio.
                </p>
              </div>

              <div>
                <p className="font-semibold text-gray-800 mb-1">Debiti</p>
                <p>
                  Una rata (es. il mutuo) resta dentro le spese finché non raggiungi l&apos;anno di estinzione
                  impostato; da quell&apos;anno sparisce dalle spese. Non aumenta automaticamente
                  l&apos;investimento: decidi tu, nel pannello parametri, se destinarla altrove.
                </p>
              </div>

              <div className="bg-surface-50 rounded-lg p-3">
                <p className="font-semibold text-gray-800 mb-1">Safe Withdrawal Rate (SWR)</p>
                <p>
                  Quota di riferimento del capitale storicamente sostenibile da prelevare ogni
                  anno (4% è la regola più usata, Trinity Study, su orizzonti di 30+ anni). Qui
                  serve solo a calcolare il &ldquo;FIRE number&rdquo; mostrato come confronto: il
                  vero criterio di raggiungimento è la simulazione, più precisa perché usa le tue
                  assunzioni invece della media storica.
                </p>
              </div>

              <p className="text-[11px] text-gray-400">
                Tasse su investimenti e fondo pensione sono già applicate al netto nei rendimenti. Spese,
                investimento e inflazione restano costanti nel tempo a meno che tu non imposti una crescita
                percentuale annua per ciascuno.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

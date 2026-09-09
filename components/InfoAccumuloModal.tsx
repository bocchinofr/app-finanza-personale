'use client'
import { useState } from 'react'

interface Props {
  ddMax: number
  frazioneAPmc?: number
}

export default function InfoAccumuloModal({ ddMax, frazioneAPmc = 0.4 }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Come funziona il calcolo dell'investimento consigliato"
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
              <h3 className="text-sm font-semibold text-gray-900">Come si calcola l&apos;investimento consigliato</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1">✕</button>
            </div>

            <div className="space-y-4 text-xs text-gray-600 leading-relaxed">
              <p>
                Questo calcolo si attiva solo se il tuo profilo è impostato su <strong>&ldquo;Contrarian (accumula sui crolli)&rdquo;</strong>.
                Serve a suggerire quanto investire dalla riserva svincolata quando un asset scatta un alert, in due passaggi.
              </p>

              <div>
                <p className="font-semibold text-gray-800 mb-1">1. Quanta riserva spetta a ciascun asset</p>
                <p>
                  La riserva totale (asset e liquidità svincolati) viene divisa tra tutti gli asset che hanno almeno una
                  soglia di alert attiva. Non in parti uguali: chi ha impostato una <strong>soglia più bassa</strong> (es. -5%
                  invece di -20%) segnala di voler accumulare prima, e riceve una fetta più grande. Il peso di ogni asset è
                  proporzionale a <code className="bg-gray-100 px-1 rounded">1 / soglia%</code>.
                </p>
              </div>

              <div>
                <p className="font-semibold text-gray-800 mb-1">2. Quanta parte di quel budget sbloccare adesso</p>
                <p>Il budget dell&apos;asset non viene mai investito tutto in un colpo. Si sblocca gradualmente in due fasi:</p>
                <ul className="list-disc pl-4 mt-1 space-y-1">
                  <li>
                    <strong>Dal massimo (52 settimane) al PMC</strong> (prezzo medio di carico): mano a mano che il prezzo
                    scende verso il tuo prezzo medio, si sblocca in modo lineare fino al <strong>{Math.round(frazioneAPmc * 100)}%</strong> del budget.
                  </li>
                  <li>
                    <strong>Sotto il PMC</strong>: da lì in poi l&apos;asset è &ldquo;in perdita&rdquo; sul tuo costo medio, e la
                    quota si sblocca più rapidamente (curva accelerata, non lineare) man mano che scende ancora — fino al 100%
                    del budget quando il ribasso sotto il PMC raggiunge il <strong>DD max</strong> del tuo profilo (oggi {Math.round(ddMax * 100)}%).
                  </li>
                </ul>
              </div>

              <div className="bg-surface-50 rounded-lg p-3">
                <p className="font-semibold text-gray-800 mb-1">Esempio</p>
                <p>
                  Asset con budget €10.000, PMC a metà strada tra prezzo attuale e massimo. Se il prezzo tocca il PMC, sono
                  sbloccati circa €{Math.round(frazioneAPmc * 10000).toLocaleString('it-IT')}. Se poi scende ancora fino al
                  DD max sotto il PMC, si sbloccano i restanti €{Math.round((1 - frazioneAPmc) * 10000).toLocaleString('it-IT')} —
                  ma non in modo lineare: gli ultimi punti percentuali di ribasso &ldquo;valgono&rdquo; più dei primi.
                </p>
              </div>

              <p className="text-[11px] text-gray-400">
                È un <strong>suggerimento</strong>, non un ordine automatico: l&apos;investimento resta sempre una tua scelta manuale.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// components/portfolio/AnalisiPortafoglioInfoBox.tsx
'use client'
import { useState } from 'react'
import { createPortal } from 'react-dom'

export default function AnalisiPortafoglioInfoBox() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Come funziona il pannello Analisi portafoglio"
        className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-gray-300 text-gray-500 text-xs font-semibold hover:bg-gray-100 hover:text-gray-700 transition-colors"
      >
        i
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Come funziona questo pannello</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1">✕</button>
            </div>

            <div className="space-y-4 text-xs text-gray-600 leading-relaxed">
              <div>
                <p className="font-semibold text-gray-800 mb-1">A cosa serve</p>
                <p>
                  Mostra l&apos;esposizione <strong>reale</strong> del patrimonio: non quanto vale ogni ETF, ma quanto
                  sei esposto a ogni società, settore e paese tenendo conto di tutti gli ETF insieme (look-through).
                  Così vedi le sovrapposizioni, per esempio la stessa società presente in S&amp;P 500 e MSCI World.
                </p>
              </div>

              <div>
                <p className="font-semibold text-gray-800 mb-1">Da dove arrivano i dati</p>
                <p>
                  Posizioni, quantità, prezzo di carico e classe sono quelli già presenti nell&apos;anagrafica
                  portafoglio; i prezzi arrivano da Yahoo Finance. La composizione di ogni ETF (prime 10
                  partecipazioni, settori, paesi) la incolli tu con il pulsante <strong>Dati</strong> accanto allo
                  strumento, copiandola da justETF o dal sito dell&apos;emittente. Il formato è libero: nome e peso
                  sulla stessa riga o su righe consecutive, con virgola o punto decimale.
                </p>
              </div>

              <div>
                <p className="font-semibold text-gray-800 mb-1">Come si calcola</p>
                <p>
                  Esposizione in euro a una società = valore della posizione ETF × peso della società nell&apos;ETF.
                  Poi si sommano gli ETF, riconoscendo la stessa società anche se scritta in modo diverso. Le
                  percentuali sono calcolate sul patrimonio finanziario (portafoglio più liquidità, fondo pensione
                  escluso) e sulla sola componente azionaria. Non si sommano mai direttamente i pesi percentuali di
                  ETF diversi.
                </p>
              </div>

              <div>
                <p className="font-semibold text-gray-800 mb-1">Limiti e copertura</p>
                <p>
                  Le prime 10 partecipazioni coprono solo una parte dell&apos;ETF: la quota restante risulta
                  &ldquo;non dettagliata&rdquo; e non viene mai stimata. La copertura è indicata per ogni ETF e per
                  l&apos;insieme. Gli ETF senza dati inseriti sono segnalati e restano fuori dal look-through. Obbligazioni
                  e componente monetaria non sono scomposte.
                </p>
              </div>

              <div>
                <p className="font-semibold text-gray-800 mb-1">Cosa non modifica</p>
                <p>
                  Questo pannello è in sola lettura rispetto al portafoglio: le composizioni incollate sono salvate a
                  parte e non toccano mai quantità, prezzi di carico o movimenti.
                </p>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

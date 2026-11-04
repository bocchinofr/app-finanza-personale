// components/portfolio/SimulatoreInfoBox.tsx
'use client'
import { useState } from 'react'
import { createPortal } from 'react-dom'

export default function SimulatoreInfoBox() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Come funziona il simulatore"
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
                  Prova vendite e acquisti senza farli davvero e vedi subito come cambiano valore, asset class,
                  società, settori, paesi e liquidità. Tutto vive in memoria: il portafoglio reale, le quantità e i
                  prezzi di carico non vengono mai modificati.
                </p>
              </div>
              <div>
                <p className="font-semibold text-gray-800 mb-1">Operazioni</p>
                <p>
                  Vendi un ETF per intero, in percentuale, per quantità o per importo. Acquista un ETF che hai già
                  oppure uno nuovo aggiunto con <strong>Nuovo strumento</strong> (ETF, azione singola come BRK.B, ETF
                  inverso). Le operazioni sono applicate nell&apos;ordine in cui le vedi. Con{' '}
                  <strong>Variazione liquidità</strong> aggiungi o togli contanti a mano.
                </p>
              </div>
              <div>
                <p className="font-semibold text-gray-800 mb-1">Fiscalità</p>
                <p>
                  Per ogni vendita: plusvalenza = quantità × (prezzo − prezzo medio di carico) − costi; imposta =
                  plusvalenza × aliquota (26% di default, modificabile per operazione, ad esempio per titoli di
                  Stato). Capitale netto reinvestibile = incasso − costi − imposta. In caso di perdita l&apos;imposta è
                  zero e la minusvalenza è solo indicata: non viene compensata con altre plusvalenze, perché per gli
                  ETF le regole sono particolari. Verifica con un professionista.
                </p>
              </div>
              <div>
                <p className="font-semibold text-gray-800 mb-1">ETF inversi e leva</p>
                <p>
                  Un ETF inverso -1x o -2x riduce l&apos;esposizione alle società dell&apos;indice scelto come
                  riferimento (composizione già inserita per quell&apos;ETF), con segno negativo e moltiplicata per la
                  leva. Non è una copertura perfetta: tracking e costi di leva non sono modellati.
                </p>
              </div>
              <div>
                <p className="font-semibold text-gray-800 mb-1">Limiti</p>
                <p>
                  Le esposizioni usano solo i dati che hai incollato (copertura indicata). I prezzi sono quelli di
                  Yahoo, con cambio EUR/USD per i titoli in dollari. Le simulazioni non sono ancora salvabili come
                  scenari. Gli strumenti nuovi restano nella libreria e si possono riusare.
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

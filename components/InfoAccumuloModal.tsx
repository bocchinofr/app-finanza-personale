'use client'
import { useState } from 'react'

interface Props {
  ddMax?: number // non più usato (mantenuto per compatibilità con i vecchi punti di utilizzo)
}

const Passo = ({ n, titolo, children }: { n: number; titolo: string; children: React.ReactNode }) => (
  <li className="flex gap-3">
    <span className="shrink-0 w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-semibold flex items-center justify-center">{n}</span>
    <div className="min-w-0">
      <p className="text-xs font-semibold text-gray-800">{titolo}</p>
      <div className="text-xs text-gray-600 leading-relaxed mt-0.5">{children}</div>
    </div>
  </li>
)

const Formula = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-1 rounded-md bg-surface-50 ring-1 ring-surface-200 px-2.5 py-1.5 font-mono text-[11px] text-gray-700 leading-snug">{children}</p>
)

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function InfoAccumuloModal(_: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Come funziona il piano di accumulo"
        className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-gray-300 text-gray-500 text-[11px] font-semibold hover:bg-gray-100 hover:text-gray-700 transition-colors"
      >
        i
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Quanto investire quando il mercato scende</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1" aria-label="Chiudi">✕</button>
            </div>

            <div className="rounded-lg bg-brand-50 ring-1 ring-brand-100 p-3 mb-4">
              <p className="text-xs font-semibold text-brand-800 mb-1">L&apos;idea, spiegata semplice</p>
              <p className="text-xs text-brand-800/90 leading-relaxed">
                Hai un salvadanaio (la riserva). Lo dividi in barattoli, uno per ogni asset che vuoi comprare quando scende.
                Ogni barattolo ha tanti coperchietti, uno per ogni soglia (−5%, −10%, −15%…). Quando il prezzo scende fino a una soglia
                si apre solo quel coperchietto e il piano ti dice quanto spendere. Gli altri restano chiusi: così hai già i soldi
                per i ribassi più profondi e non li bruci tutti subito.
              </p>
            </div>

            <ol className="space-y-4">
              <Passo n={1} titolo="Riserva (il salvadanaio)">
                Liquidità dei conti svincolati più il valore degli asset svincolati.
                <Formula>R = liquidità svincolata + asset svincolati</Formula>
              </Passo>
              <Passo n={2} titolo="Quota dell'asset (il barattolo)">
                La riserva si divide tra gli asset del piano: in parti uguali oppure con le percentuali che scegli tu.
                <Formula>quota = R × peso asset &nbsp;(uguale: R ÷ n° asset)</Formula>
              </Passo>
              <Passo n={3} titolo="Tranche (il coperchietto)">
                La quota di ogni asset si divide tra le sue soglie. Pesi <em>uguali</em>, <em>crescenti</em> (più scende, più compri: con 4 soglie
                10-20-30-40%) o <em>manuali</em>.
                <Formula>tranche = quota × peso della soglia</Formula>
              </Passo>
              <Passo n={4} titolo="Importo da investire">
                Dipende da dove sta il prezzo rispetto al tuo PMC (prezzo medio di carico):
                <ul className="mt-1.5 space-y-1 list-disc pl-4">
                  <li>
                    <strong className="text-gray-800">Sotto il PMC</strong>: stai comprando a sconto sul tuo costo, quindi compri di più. Più scendi sotto il PMC, più il bonus cresce, fino al tetto che scegli.
                    <Formula>importo = tranche × M &nbsp;con&nbsp; M = 1 + bonus × (% sotto PMC ÷ 10), max moltiplicatore</Formula>
                  </li>
                  <li>
                    <strong className="text-gray-800">Sopra il PMC</strong> (sei in guadagno): compri sui crolli ma senza alzare troppo il PMC. Se il nuovo PMC superasse il limite che hai scelto, l&apos;importo si riduce.
                    <Formula>importo = min(tranche, importo che tiene il nuovo PMC ≤ PMC × (1 + limite))</Formula>
                  </li>
                  <li>In ogni caso non si spende mai più della quota dell&apos;asset: niente prestiti dagli altri barattoli.</li>
                </ul>
              </Passo>
            </ol>

            <div className="mt-5 rounded-lg ring-1 ring-surface-200 p-3">
              <p className="text-xs font-semibold text-gray-800 mb-1.5">Esempio con i numeri</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                Riserva 20.000 €, 2 asset: quota ETF A = 10.000 €. Soglie −5/−10/−15/−20% con pesi crescenti 10/20/30/40%,
                quindi tranche da 1.000 / 2.000 / 3.000 / 4.000 €. Bonus 50% ogni −10% sotto PMC, limite PMC +2%.
                L&apos;ETF scende al −10% dal massimo (massimo 110 €, prezzo 99 €):
              </p>
              <ul className="mt-2 space-y-1.5 text-xs text-gray-600 leading-relaxed">
                <li>
                  <strong className="text-gray-800">PMC 90 € (in guadagno)</strong>: tranche −10% = 2.000 €. Il limite PMC permetterebbe fino a ~2.475 €, quindi investi <strong className="text-brand-700">2.000 €</strong> e il nuovo PMC è circa 91,5 €.
                </li>
                <li>
                  <strong className="text-gray-800">PMC 105 € (sotto PMC)</strong>: il prezzo è 5,7% sotto il PMC, quindi M = 1 + 0,5 × 0,57 ≈ 1,29. Investi 2.000 × 1,29 ≈ <strong className="text-brand-700">2.570 €</strong> e il PMC scende a circa 103,8 €.
                </li>
              </ul>
            </div>

            <div className="mt-4 text-[11px] text-gray-500 leading-relaxed space-y-1.5">
              <p><strong className="text-gray-700">Quando scatta un alert</strong> l&apos;importo indicato è quello della tranche appena scattata. Le tranche già sbloccate prima si considerano gestite.</p>
              <p><strong className="text-gray-700">Il ribasso</strong> è misurato dal massimo: −10% vuol dire che il prezzo è 10% sotto il suo massimo.</p>
              <p><strong className="text-gray-700">Massimo e mese</strong>: gli importi dipendono solo dal ribasso dal massimo (le tranche sostituiscono la soglia &ldquo;Max %&rdquo; dell&apos;Anagrafica per gli asset del piano). La soglia mensile è solo un avviso: l&apos;alert indica a che ribasso dal massimo sei e quale tranche è già scattata. Esempio: scatta il −5% mensile ma sei a −15% dal massimo → ricevi l&apos;avviso senza importo, perché le tranche −5/−10/−15% erano già scattate quando il prezzo le ha attraversate.</p>
              <p><strong className="text-gray-700">Nelle soglie in attesa</strong> il prezzo è quello che l&apos;asset avrebbe in quel punto e il PMC tiene conto delle tranche precedenti.</p>
              <p><strong className="text-gray-700">Riarmo e controllo prima di investire</strong>: una tranche suona di nuovo solo dopo che il prezzo è uscito dalla sua zona e poi ci rientra. Es.: scatta il −5%, il prezzo risale sopra −5%, poi riscende a −7%: la tranche −5% si riarma e ti arriva un nuovo importo. L&apos;app si aggiorna con i tuoi dati più o meno una volta al mese e non sa se hai già comprato, quindi in quel caso l&apos;alert mostra un riquadro ben visibile con: la tranche già scattata (attivazione #2, #3…) e la data dell&apos;ultimo avviso; se dall&apos;ultimo avviso c&apos;è stato un nuovo massimo (se no, è lo stesso ciclo di ribasso e potresti aver già investito); la data a cui sono aggiornati quantità, PMC e liquidità usati per il calcolo. Se hai già acquistato dopo quella data, aggiorna i dati prima di seguire l&apos;importo.</p>
              <p className="text-gray-400">È un suggerimento: decidi sempre tu.</p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

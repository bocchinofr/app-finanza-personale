// components/PatrimonioAnnuale.tsx
// Vista annuale del patrimonio: aggregati di fine anno (stock) e totali annui
// (flussi) con variazione % rispetto all'anno precedente. Carica da sola tutti
// gli anni, quindi non dipende dal selettore anno della pagina.
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { RigaAnnuale, Colonna, caricaRigheAnnuali, congelaAnno } from '@/lib/patrimonioAnnuale'
import InfoBox from '@/components/ui/InfoBox'

const MESI_LABEL: Record<string, string> = {
  gen: 'Gen', feb: 'Feb', mar: 'Mar', apr: 'Apr', mag: 'Mag', giu: 'Giu',
  lug: 'Lug', ago: 'Ago', set: 'Set', ott: 'Ott', nov: 'Nov', dic: 'Dic',
}

function fmtEuro(n: number) {
  return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

const COLONNE: { chiave: Colonna | 'plusminus'; titolo: string; corto: string; invertiColore?: boolean; evidenzia?: boolean }[] = [
  { chiave: 'patrimonio', titolo: 'Patrimonio totale', corto: 'Patrimonio', evidenzia: true },
  { chiave: 'fondo', titolo: 'Fondo pensione', corto: 'Fondo' },
  { chiave: 'capitale', titolo: 'Capitale investito', corto: 'Capitale' },
  { chiave: 'plusminus', titolo: 'Plus/minus a fine anno (investimenti + interessi fondo pensione)', corto: 'Plus/minus' },
  { chiave: 'liquidita', titolo: 'Liquidità', corto: 'Liquidità' },
  { chiave: 'entrate', titolo: 'Entrate', corto: 'Entrate' },
  { chiave: 'uscite', titolo: 'Uscite', corto: 'Uscite', invertiColore: true },
]

// Plus/minus: valore a fine anno, verde se positivo, rosso se negativo (nessuna variazione %)
function CellaPlusMinus({ valore }: { valore: number | null }) {
  const tono = valore == null ? 'text-gray-300' : valore >= 0 ? 'text-green-700' : 'text-red-700'
  return (
    <td className="px-1.5 py-2 text-right align-top border-b border-surface-200/50">
      <p className={`font-mono tabular-nums whitespace-nowrap font-medium ${tono}`}>
        {valore == null ? '–' : `${valore >= 0 ? '+' : ''}${fmtEuro(valore)}`}
      </p>
    </td>
  )
}

function Cella({
  valore, variazione, invertiColore, evidenzia,
}: {
  valore: number
  variazione: number | null
  invertiColore?: boolean
  evidenzia?: boolean
}) {
  const positivo = variazione != null && (invertiColore ? variazione <= 0 : variazione >= 0)
  const tono = variazione == null ? 'text-gray-300' : positivo ? 'text-green-700' : 'text-red-700'
  return (
    <td className="px-1.5 py-2 text-right align-top border-b border-surface-200/50">
      <p className={`font-mono tabular-nums whitespace-nowrap ${evidenzia ? 'text-gray-900 font-semibold' : 'text-gray-600'}`}>
        {fmtEuro(valore)}
      </p>
      <p className={`font-mono tabular-nums whitespace-nowrap text-[11px] 2xl:text-xs min-[1700px]:text-sm font-medium ${tono}`}>
        {variazione == null ? '–' : `${variazione >= 0 ? '▲ +' : '▼ '}${variazione.toFixed(1)}%`}
      </p>
    </td>
  )
}

// embedded: usata dentro la card Patrimonio (tab "Anno su anno"), senza card/titolo propri
export default function PatrimonioAnnuale({ embedded = false }: { embedded?: boolean }) {
  const wrap = embedded ? '' : 'card mt-4'
  const supabase = createClient()
  const [righe, setRighe] = useState<RigaAnnuale[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [salvando, setSalvando] = useState<number | null>(null)
  const [erroreSalvataggio, setErroreSalvataggio] = useState<string | null>(null)

  async function carica(): Promise<RigaAnnuale[] | null> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    return caricaRigheAnnuali(supabase, user.id)
  }

  useEffect(() => {
    let cancelled = false
    carica()
      .then(r => { if (!cancelled && r) setRighe(r) })
      .catch(e => { if (!cancelled) setErrore(e instanceof Error ? e.message : 'errore sconosciuto') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function salvaAnno(anno: number) {
    setSalvando(anno)
    setErroreSalvataggio(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Non autenticato')
      await congelaAnno(supabase, user.id, anno)
      const r = await carica()
      if (r) setRighe(r)
    } catch (e) {
      setErroreSalvataggio(e instanceof Error ? e.message : 'errore sconosciuto')
    } finally {
      setSalvando(null)
    }
  }

  if (errore) {
    return (
      <div className={`${wrap} text-sm text-red-700`}>Vista annuale non disponibile: {errore}</div>
    )
  }
  if (!righe) {
    return <div className={`${wrap} text-sm text-gray-400`}>Caricamento vista annuale…</div>
  }
  if (righe.length === 0) {
    return embedded ? <p className="text-sm text-gray-400 text-center py-12">Nessun dato annuale disponibile</p> : null
  }

  return (
    <div className={wrap}>
      {!embedded && <p className="num-display text-sm font-semibold text-gray-900 mb-3">Vista annuale</p>}

      {erroreSalvataggio && (
        <p className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2 mb-3">
          Salvataggio non riuscito: {erroreSalvataggio}
        </p>
      )}

      {/* Desktop: la tabella sta nel box (colonne a larghezza fissa); sotto md resta scorrevole */}
      <div className="overflow-x-auto md:overflow-visible">
        <table className="w-full min-w-[640px] md:min-w-0 md:table-fixed text-xs 2xl:text-sm min-[1700px]:text-base border-collapse">
          <thead>
            <tr>
              <th className="text-left px-1.5 py-2 w-[100px] 2xl:w-[130px] text-[11px] 2xl:text-xs text-gray-400 font-semibold uppercase tracking-wide">Anno</th>
              {COLONNE.map(c => (
                <th
                  key={c.chiave}
                  title={c.titolo}
                  className={`text-right px-1.5 py-2 text-[11px] 2xl:text-xs font-semibold uppercase tracking-wide whitespace-nowrap ${c.evidenzia ? 'text-gray-500' : 'text-gray-400'}`}
                >
                  {c.corto}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {righe.map(r => (
              <tr key={r.anno}>
                <td className="px-1.5 py-2 align-top text-gray-700 font-medium border-b border-surface-200/50">
                  <span className="text-sm 2xl:text-base">{r.anno}</span>
                  {r.manuale && (
                    <span className={`block w-fit mt-0.5 text-[10px] 2xl:text-[11px] font-medium px-1.5 py-0.5 rounded-full ${r.fonte === 'salvato' ? 'bg-emerald-50 text-emerald-600' : 'bg-sky-50 text-sky-600'}`}>
                      {r.fonte === 'salvato' ? 'salvato' : 'manuale'}
                    </span>
                  )}
                  {r.parziale && (
                    <span className="block w-fit mt-0.5 text-[10px] 2xl:text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">
                      a {MESI_LABEL[r.ultimoMese]}
                    </span>
                  )}
                  {!r.manuale && (
                    <button
                      type="button"
                      onClick={() => salvaAnno(r.anno)}
                      disabled={salvando !== null}
                      title="Congela i totali di quest'anno in archivio, così restano invariati anche se cambiano i dati o il portafoglio"
                      className="mt-1 block text-[10px] 2xl:text-[11px] font-medium px-2 py-0.5 rounded-full border border-surface-300 text-gray-500 hover:bg-surface-50 hover:text-brand-600 transition-colors disabled:opacity-40"
                    >
                      {salvando === r.anno ? 'Salvo…' : r.inArchivio ? '✓ Aggiorna archivio' : 'Salva anno'}
                    </button>
                  )}
                </td>
                {COLONNE.map(c => c.chiave === 'plusminus' ? (
                  <CellaPlusMinus key={c.chiave} valore={r.plusMinus} />
                ) : (
                  <Cella
                    key={c.chiave}
                    valore={r.valori[c.chiave]}
                    variazione={r.variazioni[c.chiave]}
                    invertiColore={c.invertiColore}
                    evidenzia={c.evidenzia}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!embedded && (
        <div className="mt-3">
          <InfoBox title="Come leggere la vista annuale">
            <p>Patrimonio, fondo, capitale e liquidità sono valori di fine anno (per l&apos;anno in corso, ultimo mese con dati). Il plus/minus è quello dell&apos;ultima chiusura mese registrata nell&apos;anno più gli interessi del fondo; senza chiusura registrata resta “–”. Entrate e uscite sono i totali dell&apos;anno; per l&apos;anno in corso la variazione % è sullo stesso periodo dell&apos;anno prima.</p>
            <p>Con &ldquo;Salva anno&rdquo; i totali di un anno vengono congelati (badge &ldquo;salvato&rdquo;). Le righe &ldquo;manuali&rdquo; sono totali inseriti a mano per anni senza dati dettagliati.</p>
          </InfoBox>
        </div>
      )}
    </div>
  )
}

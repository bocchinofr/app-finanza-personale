// components/portfolio/AnalisiPortafoglio.tsx
'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { AssetPortafoglio, statoAttuale } from '@/types/index'
import {
  ComposizioneEtf, EsposizioneVoce, MetaStrumento, PosizioneEtf, VocePeso, calcolaLookthrough,
} from '@/lib/portfolioLookthrough'
import { StrumentoSim } from '@/lib/portfolioSimulation'
import {
  COLORI_CLASSE, fmtData, fmtEuro, fmtPct, fmtPctSegno, fmtPrezzo, fmtQta,
} from '@/lib/portfolioFormat'
import AnalisiPortafoglioInfoBox from './AnalisiPortafoglioInfoBox'
import AllocazioneDonut from './AllocazioneDonut'
import ComposizioneEditor from './ComposizioneEditor'
import NuovoStrumentoModal from './NuovoStrumentoModal'
import SimulatoreRiallocazione from './SimulatoreRiallocazione'

interface Props {
  portafoglio: AssetPortafoglio[]
  prezziAttuali: Record<string, { price: number }>
  liquidita: number
  prefill?: { nonce: number; strumentoId: string; importo: number } | null
  onPrefillConsumed?: () => void
}

const COLORI_ETF = ['#3f6b4f', '#4a6fa1', '#c28b3c', '#8a6aa8', '#b5543f', '#5c8752', '#7a8794']

interface RigaAsset {
  asset: AssetPortafoglio
  qta: number
  pmc: number
  prezzo: number
  investito: number
  valore: number
  plus: number
  plusPct: number | null
  classe: 'azionario' | 'obbligazionario' | 'altro'
}

function BarreVoci({
  voci, baseAzionario, totaleDettagliato,
}: {
  voci: EsposizioneVoce[]; baseAzionario: number; totaleDettagliato: number
}) {
  if (voci.length === 0) return <p className="text-[13px] text-gray-400">Nessun dato inserito.</p>
  const max = Math.max(...voci.map(v => v.euro), 1)
  const nonClass = Math.max(baseAzionario - totaleDettagliato, 0)
  return (
    <div className="space-y-1">
      {voci.slice(0, 12).map(v => (
        <div key={v.nome} className="flex items-center gap-2 text-[13px]">
          <span className="w-32 sm:w-40 truncate text-gray-700" title={v.nome}>{v.nome}</span>
          <div className="flex-1 h-2 rounded-full bg-surface-100 overflow-hidden">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(v.euro / max) * 100}%` }} />
          </div>
          <span className="w-12 text-right font-mono tabular-nums text-gray-800">
            {baseAzionario > 0 ? fmtPct((v.euro / baseAzionario) * 100) : '–'}
          </span>
          <span className="hidden sm:inline w-16 text-right font-mono tabular-nums text-gray-400">{fmtEuro(v.euro)}</span>
        </div>
      ))}
      {voci.length > 12 && <p className="text-[11px] text-gray-400">+ altre {voci.length - 12} voci</p>}
      <div className="flex items-center gap-2 text-[13px] pt-1 border-t border-surface-100">
        <span className="w-32 sm:w-40 text-gray-400">Non classificato</span>
        <div className="flex-1" />
        <span className="w-12 text-right font-mono tabular-nums text-gray-400">
          {baseAzionario > 0 ? fmtPct((nonClass / baseAzionario) * 100) : '–'}
        </span>
        <span className="hidden sm:inline w-16 text-right font-mono tabular-nums text-gray-400">{fmtEuro(nonClass)}</span>
      </div>
    </div>
  )
}

export default function AnalisiPortafoglio({ portafoglio, prezziAttuali, liquidita, prefill, onPrefillConsumed }: Props) {
  const supabase = createClient()
  const [vista, setVista] = useState<'situazione' | 'simulatore'>('situazione')
  const [vistaEsp, setVistaEsp] = useState<'settori' | 'paesi'>('settori')
  const [socEspanse, setSocEspanse] = useState(false)
  const [composizioni, setComposizioni] = useState<ComposizioneEtf[]>([])
  const [loading, setLoading] = useState(true)
  const [errore, setErrore] = useState('')
  const [prezziLocali, setPrezziLocali] = useState<Record<string, { price: number }>>({})
  const [editId, setEditId] = useState<string | null>(null)
  const [nuovoAperto, setNuovoAperto] = useState(false)
  const [saving, setSaving] = useState(false)

  const prezzi = Object.keys(prezziAttuali).length > 0 ? prezziAttuali : prezziLocali
  const prezziLive = Object.keys(prezzi).length > 0

  // Se la pagina non ha ancora i prezzi live, li recupero da solo (stessa API route già in uso)
  useEffect(() => {
    if (Object.keys(prezziAttuali).length > 0) return
    const tickers = [...new Set(portafoglio.map(a => a.ticker).filter(Boolean))]
    if (tickers.length === 0) return
    let annullato = false
    fetch(`/api/quote?tickers=${tickers.join(',')}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j && !annullato) setPrezziLocali(j) })
      .catch(() => { /* si resta al prezzo di carico */ })
    return () => { annullato = true }
  }, [portafoglio, prezziAttuali])

  const carica = useCallback(async () => {
    const { data, error } = await supabase.from('etf_composizione').select('*')
    if (error) {
      setErrore(
        error.message.includes('etf_composizione')
          ? 'Tabella etf_composizione non trovata: esegui la migrazione create_etf_composizione.sql su Supabase.'
          : `Errore nel caricamento: ${error.message}`
      )
      setComposizioni([])
    } else {
      setErrore('')
      setComposizioni((data as ComposizioneEtf[]) ?? [])
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => { carica() }, [carica])
  useEffect(() => { if (prefill) setVista('simulatore') }, [prefill])

  const righe: RigaAsset[] = useMemo(() => portafoglio.map(a => {
    const { quantita, prezzoCarico } = statoAttuale(a)
    const quote = a.ticker ? prezzi[a.ticker] : undefined
    const prezzoAtt = quote?.price ?? prezzoCarico
    const investito = prezzoCarico * quantita
    const valore = prezzoAtt * quantita
    return {
      asset: a, qta: quantita, pmc: prezzoCarico, prezzo: prezzoAtt, investito, valore,
      plus: valore - investito,
      plusPct: investito > 0 ? ((valore - investito) / investito) * 100 : null,
      classe: a.classe_rischio ?? 'altro',
    }
  }), [portafoglio, prezzi])

  const totPortafoglio = righe.reduce((s, r) => s + r.valore, 0)
  const totInvestito = righe.reduce((s, r) => s + r.investito, 0)
  const patrimonio = totPortafoglio + liquidita
  const valAzionario = righe.filter(r => r.classe === 'azionario').reduce((s, r) => s + r.valore, 0)
  const valObblig = righe.filter(r => r.classe === 'obbligazionario').reduce((s, r) => s + r.valore, 0)
  const valAltro = righe.filter(r => r.classe === 'altro').reduce((s, r) => s + r.valore, 0)

  const etfAzionari: PosizioneEtf[] = useMemo(
    () => righe.filter(r => r.classe === 'azionario' && r.asset.id)
      .map(r => ({ id: r.asset.id as string, nome: r.asset.nome || r.asset.asset, ticker: r.asset.ticker, valore: r.valore })),
    [righe]
  )
  const lt = useMemo(() => calcolaLookthrough(etfAzionari, composizioni), [etfAzionari, composizioni])
  const coloreEtf = useMemo(() => {
    const m = new Map<string, string>()
    etfAzionari.forEach((e, i) => m.set(e.id, COLORI_ETF[i % COLORI_ETF.length]))
    return m
  }, [etfAzionari])

  const strumentiReali: StrumentoSim[] = useMemo(
    () => righe.filter(r => r.asset.id).map(r => ({
      id: r.asset.id as string, nome: r.asset.nome || r.asset.asset, ticker: r.asset.ticker,
      classe: r.classe, qta: r.qta, pmc: r.pmc, prezzo: r.prezzo, leva: 1, riferimentoId: null, nuovo: false,
    })),
    [righe]
  )

  const copertAzionario = valAzionario > 0 ? (lt.valoreConDati / valAzionario) * 100 : 0
  const compById = useMemo(() => new Map(composizioni.map(c => [c.portafoglio_id, c])), [composizioni])

  async function scrivi(id: string, payload: Record<string, unknown>) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setErrore('Sessione scaduta: ricarica la pagina.'); return false }
    const { error } = await supabase.from('etf_composizione').upsert(
      { user_id: user.id, portafoglio_id: id, ...payload, aggiornato_at: new Date().toISOString() },
      { onConflict: 'user_id,portafoglio_id' }
    )
    if (error) {
      setErrore(
        error.message.includes('meta')
          ? 'Colonna meta mancante: esegui la migrazione create_etf_composizione_meta.sql su Supabase.'
          : `Salvataggio non riuscito: ${error.message}`
      )
      return false
    }
    return true
  }

  async function salvaComposizione(id: string, dati: { top_holdings: VocePeso[]; settori: VocePeso[]; paesi: VocePeso[] }) {
    setSaving(true)
    const ok = await scrivi(id, dati)
    setSaving(false)
    if (!ok) return
    setEditId(null)
    await carica()
  }

  async function creaStrumento(meta: MetaStrumento) {
    setSaving(true)
    const id = `sim:${meta.ticker.toUpperCase()}`
    const esistente = compById.get(id)
    // Azione singola: la società è la stessa al 100%. Se esiste già, non sovrascrivo i dati inseriti.
    const payload: Record<string, unknown> = { meta }
    if (!esistente && meta.azioneSingola) payload.top_holdings = [{ nome: meta.nome, peso: 100 }]
    const ok = await scrivi(id, payload)
    setSaving(false)
    if (!ok) return
    setNuovoAperto(false)
    await carica()
  }

  async function eliminaStrumento(id: string) {
    const { error } = await supabase.from('etf_composizione').delete().eq('portafoglio_id', id)
    if (error) { setErrore(`Eliminazione non riuscita: ${error.message}`); return }
    await carica()
  }

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">Caricamento analisi…</p>

  const fetteClasse = [
    { nome: 'Azionario', valore: valAzionario, colore: COLORI_CLASSE.azionario },
    { nome: 'Obbligazionario', valore: valObblig, colore: COLORI_CLASSE.obbligazionario },
    { nome: 'Altro', valore: valAltro, colore: COLORI_CLASSE.altro },
    { nome: 'Liquidità', valore: Math.max(liquidita, 0), colore: COLORI_CLASSE.liquidita },
  ]
  const editRealeRow = editId ? righe.find(r => r.asset.id === editId) : null
  const editMeta = editId ? compById.get(editId)?.meta : null
  const editNome = editRealeRow ? (editRealeRow.asset.nome || editRealeRow.asset.asset) : editMeta?.nome ?? ''
  const plusTot = totPortafoglio - totInvestito

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-gray-900">Analisi portafoglio</h2>
        <AnalisiPortafoglioInfoBox />
        <div className="ml-auto inline-flex rounded-lg border border-surface-200 bg-white p-0.5 text-[13px]">
          {([['situazione', 'Situazione attuale'], ['simulatore', 'Simulatore']] as const).map(([k, l]) => (
            <button
              key={k} onClick={() => setVista(k)}
              className={`px-3 py-1.5 rounded-md transition-colors ${vista === k ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-800'}`}
            >{l}</button>
          ))}
        </div>
      </div>

      {errore && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-700">{errore}</div>}
      {!prezziLive && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-800">
          Prezzi live non disponibili: i valori sono calcolati al prezzo di carico.
        </div>
      )}

      {vista === 'simulatore' ? (
        <SimulatoreRiallocazione
          strumentiReali={strumentiReali}
          composizioni={composizioni}
          liquidita={liquidita}
          onNuovo={() => setNuovoAperto(true)}
          onEditComposizione={id => setEditId(id)}
          onElimina={eliminaStrumento}
          prefill={prefill}
          onPrefillConsumed={onPrefillConsumed}
        />
      ) : (
        <>
          {/* KPI compatti */}
          <div className="card !p-0 grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-surface-100">
            {[
              { l: 'Patrimonio finanziario', v: fmtEuro(patrimonio), s: 'portafoglio + liquidità', t: '' },
              {
                l: 'Portafoglio titoli', v: fmtEuro(totPortafoglio),
                s: totInvestito > 0 ? `${fmtPctSegno((plusTot / totInvestito) * 100)} su ${fmtEuro(totInvestito)}` : '',
                t: plusTot >= 0 ? 'text-green-800' : 'text-red-700',
              },
              {
                l: 'Componente azionaria', v: fmtEuro(valAzionario),
                s: patrimonio > 0 ? `${fmtPct((valAzionario / patrimonio) * 100)} del patrimonio` : '', t: '',
              },
              {
                l: 'Copertura look-through', v: valAzionario > 0 ? fmtPct(copertAzionario, 0) : '–', s: 'azionario con dati inseriti',
                t: copertAzionario >= 99 ? 'text-green-800' : copertAzionario > 0 ? 'text-amber-700' : 'text-gray-400',
              },
            ].map(k => (
              <div key={k.l} className="px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-gray-400">{k.l}</p>
                <p className={`num-display text-lg font-bold tabular-nums ${k.t || 'text-gray-900'}`}>{k.v}</p>
                {k.s && <p className="text-[11px] text-gray-400 font-mono tabular-nums">{k.s}</p>}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
            {/* ===== Colonna principale: strumenti + società ===== */}
            <div className="xl:col-span-2 space-y-4 min-w-0">
              <div className="card !p-0 overflow-hidden">
                <p className="text-[13px] font-semibold text-gray-800 px-4 pt-3 pb-1.5">Allocazione per strumento</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px]">
                    <thead>
                      <tr>
                        <th className="table-th">Strumento</th>
                        <th className="table-th text-right">Qtà · PMC</th>
                        <th className="table-th text-right">Valore</th>
                        <th className="table-th text-right">+/–</th>
                        <th className="table-th text-right">% patr. · azion.</th>
                        <th className="table-th text-center">Dati</th>
                      </tr>
                    </thead>
                    <tbody>
                      {righe.map(r => {
                        const az = r.classe === 'azionario'
                        const comp = r.asset.id ? compById.get(r.asset.id) : undefined
                        const ha = !!comp && (comp.top_holdings.length + comp.settori.length + comp.paesi.length > 0)
                        const colore = r.asset.id ? coloreEtf.get(r.asset.id) : undefined
                        return (
                          <tr key={r.asset.id ?? r.asset.asset}>
                            <td className="table-td !py-1.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-3 h-3 rounded-sm shrink-0"
                                  style={{ backgroundColor: colore ?? 'transparent', border: colore ? 'none' : '1px dashed #c3c9b0' }}
                                  title={colore ? 'Colore usato nei grafici per ETF' : 'Non scomposto'}
                                />
                                <div className="min-w-0">
                                  <p className="text-[13px] font-medium text-gray-900 truncate">{r.asset.nome || r.asset.asset}</p>
                                  <p className="text-[11px] text-gray-400 font-mono">{r.asset.ticker || '–'} · {r.asset.isin || '–'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="table-td !py-1.5 text-right text-[13px] font-mono tabular-nums">
                              {fmtQta(r.qta)}
                              <span className="block text-[11px] text-gray-400">@ {fmtPrezzo(r.pmc)}</span>
                            </td>
                            <td className="table-td !py-1.5 text-right text-[13px] font-mono tabular-nums font-medium">
                              {fmtEuro(r.valore)}
                              <span className="block text-[11px] text-gray-400 font-normal">inv. {fmtEuro(r.investito)}</span>
                            </td>
                            <td className={`table-td !py-1.5 text-right text-[13px] font-mono tabular-nums ${r.plus >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                              {fmtEuro(r.plus)}{r.plusPct !== null && <span className="block text-[11px]">{fmtPctSegno(r.plusPct)}</span>}
                            </td>
                            <td className="table-td !py-1.5 text-right text-[13px] font-mono tabular-nums">
                              {patrimonio > 0 ? fmtPct((r.valore / patrimonio) * 100) : '–'}
                              <span className="block text-[11px] text-gray-400">{az && valAzionario > 0 ? fmtPct((r.valore / valAzionario) * 100) : '–'}</span>
                            </td>
                            <td className="table-td !py-1.5 text-center">
                              {az ? (
                                <button
                                  onClick={() => setEditId(r.asset.id ?? null)}
                                  className={`text-[11px] px-2 py-1 rounded-full border transition-colors whitespace-nowrap ${
                                    ha ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                       : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
                                >
                                  {ha ? fmtData(comp?.aggiornato_at ?? null) : 'Inserisci'}
                                </button>
                              ) : <span className="text-[11px] text-gray-300">n/d</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card !p-0 overflow-hidden">
                <div className="px-4 pt-3 pb-1.5">
                  <p className="text-[13px] font-semibold text-gray-800">Esposizione effettiva alle società</p>
                  <p className="text-[11px] text-gray-400">
                    Dettagliato {fmtEuro(lt.euroSocietaDettagliate)}
                    {valAzionario > 0 && <> ({fmtPct((lt.euroSocietaDettagliate / valAzionario) * 100)} dell&apos;azionario)</>}; il resto è non dettagliato.
                    {' '}I colori nella barra corrispondono agli ETF della tabella sopra.
                  </p>
                </div>
                {lt.societa.length === 0 ? (
                  <p className="text-[13px] text-gray-400 px-4 pb-4">Inserisci la composizione di almeno un ETF azionario per vedere l&apos;esposizione.</p>
                ) : (
                  <>
                    <div className={`overflow-x-auto ${socEspanse ? 'max-h-[26rem] overflow-y-auto' : ''}`}>
                      <table className="w-full min-w-[520px]">
                        <thead className={socEspanse ? 'sticky top-0 bg-white z-10' : ''}>
                          <tr>
                            <th className="table-th">Società</th>
                            <th className="table-th text-right">Esposizione</th>
                            <th className="table-th text-right">% patr.</th>
                            <th className="table-th text-right">% azion.</th>
                            <th className="table-th w-32">Per ETF</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(socEspanse ? lt.societa : lt.societa.slice(0, 10)).map((s, i) => (
                            <tr key={s.chiave}>
                              <td className="table-td !py-1.5 text-[13px] font-medium text-gray-900">
                                <span className="text-gray-400 mr-1.5 text-[11px] tabular-nums inline-block w-5">{i + 1}</span>{s.nome}
                                {s.nEtf > 1 && (
                                  <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full bg-accent2-50 text-accent2-700 border border-accent2-100">
                                    {s.nEtf} ETF
                                  </span>
                                )}
                              </td>
                              <td className="table-td !py-1.5 text-right text-[13px] font-mono tabular-nums font-medium">{fmtEuro(s.euro)}</td>
                              <td className="table-td !py-1.5 text-right text-[13px] font-mono tabular-nums">{patrimonio > 0 ? fmtPct((s.euro / patrimonio) * 100, 2) : '–'}</td>
                              <td className="table-td !py-1.5 text-right text-[13px] font-mono tabular-nums">{valAzionario > 0 ? fmtPct((s.euro / valAzionario) * 100, 2) : '–'}</td>
                              <td className="table-td !py-1.5">
                                <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-100">
                                  {s.contributi.map(c => (
                                    <div
                                      key={c.etfId}
                                      style={{ width: `${(c.euro / s.euro) * 100}%`, backgroundColor: coloreEtf.get(c.etfId) ?? '#9ca3af' }}
                                      title={`${c.etfNome}: ${fmtEuro(c.euro)}`}
                                    />
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {lt.societa.length > 10 && (
                      <button
                        onClick={() => setSocEspanse(v => !v)}
                        className="w-full text-[13px] text-brand-700 hover:bg-surface-50 border-t border-surface-100 py-2 transition-colors"
                      >
                        {socEspanse ? 'Mostra solo le prime 10' : `Mostra altre ${lt.societa.length - 10} società`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* ===== Colonna laterale: torta + settori/paesi ===== */}
            <div className="space-y-4 min-w-0">
              <div className="card !p-4">
                <p className="text-[13px] font-semibold text-gray-800 mb-1">Allocazione per asset class</p>
                <AllocazioneDonut fette={fetteClasse} centro={fmtEuro(patrimonio)} sub="patrimonio" altezza={160} />
                <div className="mt-2 space-y-1">
                  {fetteClasse.map(f => (
                    <div key={f.nome} className="flex items-center gap-2 text-[13px]">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: f.colore }} />
                      <span className="text-gray-600 flex-1">{f.nome}</span>
                      <span className="font-mono tabular-nums text-gray-900">{fmtEuro(f.valore)}</span>
                      <span className="font-mono tabular-nums text-gray-400 w-12 text-right">{patrimonio > 0 ? fmtPct((f.valore / patrimonio) * 100) : '–'}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card !p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[13px] font-semibold text-gray-800">Esposizione per {vistaEsp === 'settori' ? 'settore' : 'paese'}</p>
                  <div className="inline-flex rounded-lg border border-surface-200 p-0.5 text-[13px]">
                    {(['settori', 'paesi'] as const).map(v => (
                      <button
                        key={v} onClick={() => setVistaEsp(v)}
                        className={`px-2.5 py-1 rounded-md capitalize ${vistaEsp === v ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-800'}`}
                      >{v}</button>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mb-2">% sulla componente azionaria complessiva</p>
                {(() => {
                  const nr = vistaEsp === 'settori' ? lt.nonRiconosciuti.settori : lt.nonRiconosciuti.paesi
                  return nr.length > 0 ? (
                    <p className="text-[11px] text-amber-700 mb-2">
                      Nomi non unificati (possibili voci doppie): {nr.join(', ')}. Correggili da <strong>Dati</strong>.
                    </p>
                  ) : null
                })()}
                <BarreVoci
                  voci={vistaEsp === 'settori' ? lt.settori : lt.paesi}
                  baseAzionario={valAzionario}
                  totaleDettagliato={vistaEsp === 'settori' ? lt.euroSettoriDettagliati : lt.euroPaesiDettagliati}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {editId && (
        <ComposizioneEditor
          etfNome={editNome}
          iniziale={compById.get(editId) ?? null}
          saving={saving}
          onClose={() => setEditId(null)}
          onSave={dati => salvaComposizione(editId, dati)}
        />
      )}
      {nuovoAperto && (
        <NuovoStrumentoModal
          etfReali={etfAzionari.map(e => ({ id: e.id, nome: e.nome }))}
          saving={saving}
          onClose={() => setNuovoAperto(false)}
          onSave={creaStrumento}
        />
      )}
    </div>
  )
}

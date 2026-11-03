// components/portfolio/AnalisiPortafoglio.tsx
'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { AssetPortafoglio, statoAttuale } from '@/types/index'
import {
  ComposizioneEtf, EsposizioneVoce, PosizioneEtf, VocePeso, calcolaLookthrough,
} from '@/lib/portfolioLookthrough'
import AnalisiPortafoglioInfoBox from './AnalisiPortafoglioInfoBox'
import ComposizioneEditor from './ComposizioneEditor'

interface Props {
  portafoglio: AssetPortafoglio[]
  prezziAttuali: Record<string, { price: number }>
  liquidita: number
}

const fmtEuro = (n: number) => `${n < 0 ? '-' : ''}€${Math.abs(Math.round(n)).toLocaleString('it-IT')}`
const fmtPct = (n: number, d = 1) => `${n.toFixed(d).replace('.', ',')}%`
const fmtPctSegno = (n: number) => `${n > 0 ? '+' : ''}${fmtPct(n)}`
const fmtPrezzo = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtData = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '–'

const COLORI_ETF = ['#3f6b4f', '#4a6fa1', '#c28b3c', '#8a6aa8', '#b5543f', '#5c8752', '#7a8794']

interface RigaAsset {
  asset: AssetPortafoglio
  qta: number
  pmc: number
  investito: number
  valore: number
  plus: number
  plusPct: number | null
  classe: 'azionario' | 'obbligazionario' | 'altro'
}

function Kpi({ label, valore, sub, tono }: { label: string; valore: string; sub?: string; tono?: string }) {
  return (
    <div className="card !p-4">
      <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">{label}</p>
      <p className={`num-display text-xl font-bold tabular-nums ${tono ?? 'text-gray-900'}`}>{valore}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function BarreVoci({
  voci, baseAzionario, totaleDettagliato,
}: {
  voci: EsposizioneVoce[]; baseAzionario: number; totaleDettagliato: number
}) {
  if (voci.length === 0) return <p className="text-xs text-gray-400">Nessun dato inserito.</p>
  const max = Math.max(...voci.map(v => v.euro), 1)
  const nonClass = Math.max(baseAzionario - totaleDettagliato, 0)
  return (
    <div className="space-y-1.5">
      {voci.slice(0, 12).map(v => (
        <div key={v.nome} className="flex items-center gap-2 text-xs">
          <span className="w-36 sm:w-44 truncate text-gray-700" title={v.nome}>{v.nome}</span>
          <div className="flex-1 h-2.5 rounded-full bg-surface-100 overflow-hidden">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(v.euro / max) * 100}%` }} />
          </div>
          <span className="w-14 text-right font-mono tabular-nums text-gray-800">
            {baseAzionario > 0 ? fmtPct((v.euro / baseAzionario) * 100) : '–'}
          </span>
          <span className="hidden sm:inline w-20 text-right font-mono tabular-nums text-gray-400">{fmtEuro(v.euro)}</span>
        </div>
      ))}
      {voci.length > 12 && <p className="text-[11px] text-gray-400">+ altre {voci.length - 12} voci</p>}
      <div className="flex items-center gap-2 text-xs pt-1 border-t border-surface-100">
        <span className="w-36 sm:w-44 text-gray-400">Non classificato</span>
        <div className="flex-1" />
        <span className="w-14 text-right font-mono tabular-nums text-gray-400">
          {baseAzionario > 0 ? fmtPct((nonClass / baseAzionario) * 100) : '–'}
        </span>
        <span className="hidden sm:inline w-20 text-right font-mono tabular-nums text-gray-400">{fmtEuro(nonClass)}</span>
      </div>
    </div>
  )
}

export default function AnalisiPortafoglio({ portafoglio, prezziAttuali, liquidita }: Props) {
  const supabase = createClient()
  const [composizioni, setComposizioni] = useState<ComposizioneEtf[]>([])
  const [loading, setLoading] = useState(true)
  const [errore, setErrore] = useState('')
  const [prezziLocali, setPrezziLocali] = useState<Record<string, { price: number }>>({})
  const [editId, setEditId] = useState<string | null>(null)
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

  const righe: RigaAsset[] = useMemo(() => portafoglio.map(a => {
    const { quantita, prezzoCarico } = statoAttuale(a)
    const quote = a.ticker ? prezzi[a.ticker] : undefined
    const prezzoAtt = quote?.price ?? prezzoCarico
    const investito = prezzoCarico * quantita
    const valore = prezzoAtt * quantita
    return {
      asset: a, qta: quantita, pmc: prezzoCarico, investito, valore,
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

  const copertAzionario = valAzionario > 0 ? (lt.valoreConDati / valAzionario) * 100 : 0
  const top10 = lt.societa.slice(0, 10)
  const multiEtf = lt.societa.filter(s => s.nEtf > 1)
  const compById = useMemo(() => new Map(composizioni.map(c => [c.portafoglio_id, c])), [composizioni])

  async function salva(id: string, dati: { top_holdings: VocePeso[]; settori: VocePeso[]; paesi: VocePeso[] }) {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); setErrore('Sessione scaduta: ricarica la pagina.'); return }
    const { error } = await supabase.from('etf_composizione').upsert(
      { user_id: user.id, portafoglio_id: id, ...dati, aggiornato_at: new Date().toISOString() },
      { onConflict: 'user_id,portafoglio_id' }
    )
    setSaving(false)
    if (error) { setErrore(`Salvataggio non riuscito: ${error.message}`); return }
    setEditId(null)
    await carica()
  }

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">Caricamento analisi…</p>

  const assetClasse = [
    { k: 'Azionario', v: valAzionario, c: 'bg-brand-600' },
    { k: 'Obbligazionario', v: valObblig, c: 'bg-accent2-500' },
    { k: 'Altro', v: valAltro, c: 'bg-surface-400' },
    { k: 'Liquidità', v: liquidita, c: 'bg-amber-400' },
  ]
  const editRow = editId ? righe.find(r => r.asset.id === editId) : null

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-gray-900">Analisi portafoglio</h2>
        <AnalisiPortafoglioInfoBox />
      </div>

      {errore && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{errore}</div>}
      {!prezziLive && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Prezzi live non disponibili: i valori sono calcolati al prezzo di carico.
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Patrimonio finanziario" valore={fmtEuro(patrimonio)} sub="portafoglio + liquidità" />
        <Kpi
          label="Portafoglio titoli" valore={fmtEuro(totPortafoglio)}
          sub={totInvestito > 0 ? `${fmtPctSegno(((totPortafoglio - totInvestito) / totInvestito) * 100)} su ${fmtEuro(totInvestito)} investiti` : undefined}
          tono={totPortafoglio >= totInvestito ? 'text-green-800' : 'text-red-700'}
        />
        <Kpi
          label="Componente azionaria" valore={fmtEuro(valAzionario)}
          sub={patrimonio > 0 ? `${fmtPct((valAzionario / patrimonio) * 100)} del patrimonio` : undefined}
        />
        <Kpi
          label="Copertura look-through" valore={valAzionario > 0 ? fmtPct(copertAzionario, 0) : '–'}
          sub="azionario con composizione inserita"
          tono={copertAzionario >= 99 ? 'text-green-800' : copertAzionario > 0 ? 'text-amber-700' : 'text-gray-400'}
        />
      </div>

      {/* Allocazione per asset class */}
      <div className="card">
        <p className="text-xs font-semibold text-gray-800 mb-3">Allocazione per asset class</p>
        <div className="flex h-3 rounded-full overflow-hidden bg-surface-100">
          {assetClasse.map(a => (
            <div key={a.k} className={a.c} style={{ width: `${patrimonio > 0 ? (a.v / patrimonio) * 100 : 0}%` }} title={a.k} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {assetClasse.map(a => (
            <div key={a.k} className="flex items-start gap-2">
              <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${a.c}`} />
              <div>
                <p className="text-gray-600">{a.k}</p>
                <p className="font-mono tabular-nums text-gray-900">{fmtEuro(a.v)}</p>
                <p className="font-mono tabular-nums text-gray-400">{patrimonio > 0 ? fmtPct((a.v / patrimonio) * 100) : '–'}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Allocazione per strumento */}
      <div className="card !p-0 overflow-hidden">
        <p className="text-xs font-semibold text-gray-800 px-4 pt-4 pb-2">Allocazione per strumento</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead>
              <tr>
                <th className="table-th">Strumento</th>
                <th className="table-th text-right">Qtà</th>
                <th className="table-th text-right">PMC</th>
                <th className="table-th text-right">Investito</th>
                <th className="table-th text-right">Valore</th>
                <th className="table-th text-right">+/–</th>
                <th className="table-th text-right">% patr.</th>
                <th className="table-th text-right">% azion.</th>
                <th className="table-th text-center">Composizione</th>
              </tr>
            </thead>
            <tbody>
              {righe.map(r => {
                const az = r.classe === 'azionario'
                const comp = r.asset.id ? compById.get(r.asset.id) : undefined
                const ha = !!comp && (comp.top_holdings.length + comp.settori.length + comp.paesi.length > 0)
                return (
                  <tr key={r.asset.id ?? r.asset.asset}>
                    <td className="table-td">
                      <p className="text-xs font-medium text-gray-900">{r.asset.nome || r.asset.asset}</p>
                      <p className="text-[11px] text-gray-400 font-mono">{r.asset.ticker || '–'} · {r.asset.isin || '–'}</p>
                    </td>
                    <td className="table-td text-right text-xs font-mono tabular-nums">{r.qta.toLocaleString('it-IT', { maximumFractionDigits: 4 })}</td>
                    <td className="table-td text-right text-xs font-mono tabular-nums">{fmtPrezzo(r.pmc)}</td>
                    <td className="table-td text-right text-xs font-mono tabular-nums">{fmtEuro(r.investito)}</td>
                    <td className="table-td text-right text-xs font-mono tabular-nums font-medium">{fmtEuro(r.valore)}</td>
                    <td className={`table-td text-right text-xs font-mono tabular-nums ${r.plus >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {fmtEuro(r.plus)}{r.plusPct !== null && <span className="block text-[11px]">{fmtPctSegno(r.plusPct)}</span>}
                    </td>
                    <td className="table-td text-right text-xs font-mono tabular-nums">{patrimonio > 0 ? fmtPct((r.valore / patrimonio) * 100) : '–'}</td>
                    <td className="table-td text-right text-xs font-mono tabular-nums">
                      {az && valAzionario > 0 ? fmtPct((r.valore / valAzionario) * 100) : '–'}
                    </td>
                    <td className="table-td text-center">
                      {az ? (
                        <button
                          onClick={() => setEditId(r.asset.id ?? null)}
                          className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                            ha ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                               : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
                        >
                          {ha ? `Dati ${fmtData(comp?.aggiornato_at ?? null)}` : 'Inserisci dati'}
                        </button>
                      ) : <span className="text-[11px] text-gray-300">non scomposto</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Esposizione effettiva alle società */}
      <div className="card !p-0 overflow-hidden">
        <div className="px-4 pt-4 pb-2">
          <p className="text-xs font-semibold text-gray-800">Esposizione effettiva alle società (top 10)</p>
          <p className="text-[11px] text-gray-400">
            Somma degli ETF in euro. Dettagliato: {fmtEuro(lt.euroSocietaDettagliate)}
            {valAzionario > 0 && <> ({fmtPct((lt.euroSocietaDettagliate / valAzionario) * 100)} dell&apos;azionario)</>}; il resto è non dettagliato.
          </p>
        </div>
        {top10.length === 0 ? (
          <p className="text-xs text-gray-400 px-4 pb-4">Inserisci la composizione di almeno un ETF azionario per vedere l&apos;esposizione.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <th className="table-th w-8">#</th>
                  <th className="table-th">Società</th>
                  <th className="table-th text-right">Esposizione</th>
                  <th className="table-th text-right">% patr.</th>
                  <th className="table-th text-right">% azion.</th>
                  <th className="table-th">Contributo per ETF</th>
                </tr>
              </thead>
              <tbody>
                {top10.map((s, i) => (
                  <tr key={s.chiave}>
                    <td className="table-td text-xs text-gray-400">{i + 1}</td>
                    <td className="table-td text-xs font-medium text-gray-900">
                      {s.nome}
                      {s.nEtf > 1 && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-accent2-50 text-accent2-700 border border-accent2-100">
                          in {s.nEtf} ETF
                        </span>
                      )}
                    </td>
                    <td className="table-td text-right text-xs font-mono tabular-nums font-medium">{fmtEuro(s.euro)}</td>
                    <td className="table-td text-right text-xs font-mono tabular-nums">{patrimonio > 0 ? fmtPct((s.euro / patrimonio) * 100, 2) : '–'}</td>
                    <td className="table-td text-right text-xs font-mono tabular-nums">{valAzionario > 0 ? fmtPct((s.euro / valAzionario) * 100, 2) : '–'}</td>
                    <td className="table-td min-w-[200px]">
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
        )}
        {etfAzionari.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3 border-t border-surface-100">
            {etfAzionari.map(e => (
              <span key={e.id} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: coloreEtf.get(e.id) }} />
                {e.nome}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Società presenti in più ETF */}
      {multiEtf.length > 0 && (
        <div className="card">
          <p className="text-xs font-semibold text-gray-800 mb-2">Società presenti in più ETF (tra quelle dettagliate)</p>
          <div className="flex flex-wrap gap-2">
            {multiEtf.map(s => (
              <span key={s.chiave} className="text-xs px-2.5 py-1 rounded-full bg-surface-50 border border-surface-200 text-gray-700">
                {s.nome} <span className="font-mono tabular-nums text-gray-400">· {s.nEtf} ETF · {fmtEuro(s.euro)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Settori e paesi */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card">
          <p className="text-xs font-semibold text-gray-800">Esposizione per settore</p>
          <p className="text-[11px] text-gray-400 mb-3">% sulla componente azionaria complessiva</p>
          <BarreVoci voci={lt.settori} baseAzionario={valAzionario} totaleDettagliato={lt.euroSettoriDettagliati} />
        </div>
        <div className="card">
          <p className="text-xs font-semibold text-gray-800">Esposizione per paese</p>
          <p className="text-[11px] text-gray-400 mb-3">% sulla componente azionaria complessiva</p>
          <BarreVoci voci={lt.paesi} baseAzionario={valAzionario} totaleDettagliato={lt.euroPaesiDettagliati} />
        </div>
      </div>

      {editRow && editId && (
        <ComposizioneEditor
          etfNome={editRow.asset.nome || editRow.asset.asset}
          iniziale={compById.get(editId) ?? null}
          saving={saving}
          onClose={() => setEditId(null)}
          onSave={dati => salva(editId, dati)}
        />
      )}
    </div>
  )
}

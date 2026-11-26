'use client'
import { useState } from 'react'
import KpiCard from '@/components/ui/KpiCard'
import { avvisoImportoTesto, type DettaglioAlert, type DettaglioAsset, type Alloc } from '@/lib/alertDettaglio'

const nf = (n: number, d = 1) => n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
const eur = (n: number) => `€${Math.round(n).toLocaleString('it-IT')}`
const prezzo = (n: number) => `€${nf(n, 2)}`
const pct = (n: number, d = 1) => `${n >= 0 ? '+' : '−'}${nf(Math.abs(n), d)}%`

const TH = 'py-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 bg-surface-50 border-b border-surface-200 leading-tight'
const TD = 'px-2 py-2.5 text-xs tabular-nums'
const NOTA = 'text-[11px] text-gray-400 leading-snug'

function Titolo({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-3">
      <p className="num-display text-sm font-semibold text-gray-900">{children}</p>
      {sub && <p className={`${NOTA} mt-0.5`}>{sub}</p>}
    </div>
  )
}

/* prima → dopo, con il "dopo" in evidenza */
function PrimaDopo({ prima, dopo }: { prima: React.ReactNode; dopo?: React.ReactNode }) {
  if (dopo == null) return <span className="text-gray-700">{prima}</span>
  return (
    <span className="whitespace-nowrap">
      <span className="text-gray-400">{prima}</span>
      <span className="mx-1 text-gray-300">→</span>
      <span className="font-semibold text-gray-900">{dopo}</span>
    </span>
  )
}

function Margine({ v }: { v: number }) {
  return v >= 0 ? <>−{nf(v)}%</> : <span className="text-red-600">in perdita</span>
}

/* ───────── Avvisi da leggere prima di investire (chiudibili) ───────── */
function Avvisi({ asset }: { asset: DettaglioAsset[] }) {
  const [aperto, setAperto] = useState(true)
  const righe = asset.filter(a => a.avviso && a.importo != null).map(a => ({ a, t: avvisoImportoTesto(a.avviso!) }))
  if (righe.length === 0) return null
  const forte = righe.some(r => r.t.forte)
  if (!aperto) {
    return (
      <button type="button" onClick={() => setAperto(true)}
        className={`self-start rounded-full px-3 py-1 text-xs font-medium ${forte ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>
        ⚠ Mostra avvisi ({righe.length})
      </button>
    )
  }
  return (
    <div role="alert" className={`relative rounded-xl border p-4 pr-10 ${forte ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
      <button type="button" onClick={() => setAperto(false)} aria-label="Chiudi avvisi"
        className={`absolute right-2.5 top-2.5 h-6 w-6 rounded-full text-sm leading-none ${forte ? 'text-red-700 hover:bg-red-100' : 'text-amber-700 hover:bg-amber-100'}`}>✕</button>
      <p className={`text-sm font-semibold ${forte ? 'text-red-800' : 'text-amber-800'}`}>
        ⚠ {righe.length === 1 ? 'Un accumulo da verificare' : `${righe.length} accumuli da verificare`} prima di investire
      </p>
      <ul className="mt-2 space-y-2">
        {righe.map(({ a, t }) => (
          <li key={a.id} className={`text-xs leading-snug ${forte ? 'text-red-800' : 'text-amber-800'}`}>
            <span className="font-semibold">{a.nome}</span> · {t.titolo}
            <ul className="mt-0.5 list-disc pl-4 opacity-90">{t.righe.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ───────── Tabella parametri asset ───────── */
function TabellaAsset({ asset }: { asset: DettaglioAsset[] }) {
  return (
    <section className="card p-0 overflow-hidden">
      <div className="px-4 pt-4 pb-3">
        <Titolo sub="Prima → dopo l'acquisto. Margine di ribasso: quanto può ancora scendere il prezzo prima che il PnL diventi negativo.">Parametri asset</Titolo>
      </div>
      <div className="overflow-x-auto border-t border-surface-100">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr>
              <th className={`${TH} text-left px-4`}>Asset</th>
              <th className={`${TH} text-right`}>Accumulo</th>
              <th className={`${TH} text-right`}>PMC</th>
              <th className={`${TH} text-right`}>PnL vs PMC</th>
              <th className={`${TH} text-right`}>Margine ribasso</th>
              <th className={`${TH} text-right px-4`}>Peso patrimonio</th>
            </tr>
          </thead>
          <tbody>
            {asset.map(d => {
              const verifica = !!(d.avviso && d.importo != null)
              return (
                <tr key={d.id} className={`border-b border-surface-100 last:border-b-0 ${verifica ? 'bg-amber-50/50 shadow-[inset_3px_0_0_0_#d97706]' : 'hover:bg-surface-50'} transition-colors`}>
                  <td className={`${TD} px-4`}>
                    <p className="font-medium text-gray-900 truncate max-w-[220px]" title={d.nome}>{d.nome}</p>
                    {d.accumulo && d.quote != null && <p className={NOTA}>≈ {nf(d.quote, 2)} quote a {prezzo(d.prezzo)}</p>}
                  </td>
                  <td className={`${TD} text-right`}>
                    {d.accumulo
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 ring-1 ring-brand-100 px-2 py-0.5 font-semibold">
                          {verifica && <span title="Da verificare">⚠</span>}{eur(d.importo ?? 0)}
                        </span>
                      : <span className="text-gray-300">–</span>}
                  </td>
                  <td className={`${TD} text-right`}><PrimaDopo prima={prezzo(d.pmc)} dopo={d.accumulo && d.nuovoPmc != null ? prezzo(d.nuovoPmc) : undefined} /></td>
                  <td className={`${TD} text-right`}><PrimaDopo prima={pct(d.pnlPct)} dopo={d.accumulo && d.nuovoPnlPct != null ? pct(d.nuovoPnlPct) : undefined} /></td>
                  <td className={`${TD} text-right`}><PrimaDopo prima={<Margine v={d.margineGiuPct} />} dopo={d.accumulo && d.nuovoMargineGiuPct != null ? <Margine v={d.nuovoMargineGiuPct} /> : undefined} /></td>
                  <td className={`${TD} text-right px-4`}>
                    {d.accumulo && d.pesoPrimaPct != null
                      ? <PrimaDopo prima={`${nf(d.pesoPrimaPct)}%`} dopo={`${nf(d.pesoDopoPct ?? 0)}%`} />
                      : <span className="text-gray-300">–</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ───────── Allocazione ───────── */
function BarraAlloc({ label, prima, dopo, target }: { label: string; prima: number; dopo: number; target?: number }) {
  const delta = dopo - prima
  const haTarget = target != null && target > 0
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <span className="text-[11px] text-gray-400 tabular-nums">
          {Math.abs(delta) >= 0.05 && <span className={delta > 0 ? 'text-brand-700' : 'text-gray-500'}>{delta > 0 ? '+' : '−'}{nf(Math.abs(delta))} pt{haTarget ? ' · ' : ''}</span>}
          {haTarget ? `target ${nf(target!, 0)}%` : ''}
        </span>
      </div>
      <div className="relative space-y-1">
        {[['Prima', prima, 'bg-surface-300'], ['Dopo', dopo, 'bg-brand-600']].map(([t, v, cls]) => (
          <div key={t as string} className="flex items-center gap-2">
            <span className="w-9 text-[10px] text-gray-400">{t}</span>
            <div className="relative flex-1 h-2 rounded-full bg-surface-100 overflow-hidden">
              <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.min(v as number, 100)}%` }} />
            </div>
            <span className={`w-12 text-right text-xs tabular-nums ${t === 'Dopo' ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>{nf(v as number)}%</span>
          </div>
        ))}
        {haTarget && <div className="absolute top-0 bottom-0 w-px bg-gray-800/60" style={{ left: `calc(2.75rem + (100% - 2.75rem - 3.5rem) * ${Math.min(target!, 100) / 100})` }} title={`Target ${nf(target!, 0)}%`} />}
      </div>
    </div>
  )
}

function CardAllocazione({ d }: { d: DettaglioAlert }) {
  const al = d.allocazione!
  const classi: [string, keyof Alloc][] = [['Azioni', 'azioni'], ['Obbligazioni', 'obbligazioni'], ['Liquidità', 'liquidita']]
  return (
    <section className="card">
      <Titolo sub={al.target ? 'La linea scura è il peso target.' : undefined}>Allocazione portafoglio</Titolo>
      <div className="space-y-4">
        {classi.map(([label, k]) => <BarraAlloc key={k} label={label} prima={al.prima[k]} dopo={al.dopo[k]} target={al.target?.[k]} />)}
      </div>
    </section>
  )
}

/* ───────── Top holding (3, estendibile a 10) ───────── */
function CardHolding({ d }: { d: DettaglioAlert }) {
  const h = d.holdings!
  const [esteso, setEsteso] = useState(false)
  const puoEstendere = h.dopo.length > 3
  const righe = esteso ? h.dopo.slice(0, 10) : h.dopo.slice(0, 3)
  const max = Math.max(...h.prima.map(v => v.pct), ...righe.map(v => v.pct), 1)
  return (
    <section className="card">
      <div className="flex items-start justify-between gap-3">
        <Titolo sub="Peso sul valore azionario, guardando dentro gli ETF.">{`Top ${righe.length} holding`}</Titolo>
        {puoEstendere && (
          <button type="button" onClick={() => setEsteso(v => !v)}
            className="shrink-0 rounded-full border border-surface-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-surface-50">
            {esteso ? 'Solo top 3' : `Mostra top ${Math.min(h.dopo.length, 10)}`}
          </button>
        )}
      </div>
      <div className="space-y-3">
        {righe.map((v, i) => {
          const prima = h.prima.find(x => x.nome === v.nome)?.pct ?? h.prima[i]?.pct ?? 0
          const delta = v.pct - prima
          return (
            <div key={v.nome}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-gray-800 truncate">{v.nome}</span>
                <span className="text-xs tabular-nums shrink-0">
                  <span className="text-gray-400">{nf(prima)}% → </span>
                  <span className="font-semibold text-gray-900">{nf(v.pct)}%</span>
                  {Math.abs(delta) >= 0.05 && <span className={`ml-1.5 text-[11px] ${delta > 0 ? 'text-brand-700' : 'text-gray-500'}`}>{delta > 0 ? '+' : '−'}{nf(Math.abs(delta))} pt</span>}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-100 overflow-hidden">
                <div className="h-full rounded-full bg-accent2-500" style={{ width: `${(v.pct / max) * 100}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      <p className={`${NOTA} mt-3`}>Copertura dati: {nf(h.coperturaPct, 0)}% del valore azionario.{!puoEstendere && ' Per vedere fino a 10 holding serve un alert generato dopo questo aggiornamento.'}</p>
    </section>
  )
}

/* ───────── Layout ─────────
   1. KPI di sintesi
   2. fondi prelevati + avvisi (chiudibili)
   3. allocazione | top holding
   4. tabella parametri asset a tutta larghezza                          */
export default function AlertDettaglioCard({ dettaglio }: { dettaglio: DettaglioAlert }) {
  const d = dettaglio
  const inAccumulo = d.asset.filter(a => a.accumulo)
  const totImporto = inAccumulo.reduce((s, a) => s + (a.importo ?? 0), 0)
  const daVerificare = d.asset.filter(a => a.avviso && a.importo != null).length
  const b = d.budget
  const usatoPct = b && b.riserva > 0 ? Math.min((b.usato / b.riserva) * 100, 100) : 0
  const pill = (txt: string, cls: string) => <span className={`inline-flex rounded-full text-[11px] font-semibold px-2 py-0.5 ${cls}`}>{txt}</span>

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 items-start">
        {b && (
          <KpiCard variant="compact" label="Budget residuo" color="#4a6fa1" delta={null} value={eur(b.residuo)}
            badge={pill(`${nf(usatoPct, 0)}% della riserva impegnato`, 'bg-blue-50 text-blue-700')}
            minis={[{ label: 'Riserva', value: eur(b.riserva) }]} />
        )}
        <KpiCard variant="compact" label="Da investire ora" color="#3f6b4f" tone="positive" delta={null} value={eur(totImporto)}
          badge={pill(`${inAccumulo.length} asset in accumulo`, 'bg-green-50 text-green-700')} />
        <KpiCard variant="compact" label="Asset analizzati" color="#6b7280" delta={null} value={String(d.asset.length)}
          badge={pill(`${d.asset.length - inAccumulo.length} senza accumulo`, 'bg-surface-100 text-gray-600')} />
        <KpiCard variant="compact" label="Da verificare" color={daVerificare > 0 ? '#d97706' : '#9ca3af'}
          tone={daVerificare > 0 ? 'warning' : 'neutral'} delta={null} value={String(daVerificare)}
          badge={pill(daVerificare > 0 ? 'Leggi gli avvisi sotto' : 'Nessun avviso', daVerificare > 0 ? 'bg-amber-50 text-amber-700' : 'bg-surface-100 text-gray-600')} />
      </div>

      {d.finanziamento && (
        <div className="rounded-xl bg-surface-50 ring-1 ring-surface-200 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1.5">
          <p className="text-sm font-semibold text-gray-800">Fondi prelevati dalla riserva <span className="font-normal text-gray-400">· in proporzione</span></p>
          <p className="text-sm text-gray-700 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-brand-600" />
            <span className="font-bold tabular-nums text-gray-900">{eur(d.finanziamento.daLiquidita)}</span> da liquidità
          </p>
          <p className="text-sm text-gray-700 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-accent2-500" />
            <span className="font-bold tabular-nums text-gray-900">{eur(d.finanziamento.daAssetSvincolati)}</span> da asset svincolati
          </p>
        </div>
      )}

      <Avvisi key={d.generatoAt} asset={d.asset} />

      {(d.allocazione || d.holdings) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {d.allocazione && <CardAllocazione d={d} />}
          {d.holdings && <CardHolding key={d.generatoAt} d={d} />}
        </div>
      )}

      <TabellaAsset asset={d.asset} />
    </div>
  )
}

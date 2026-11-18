'use client'
import type { DettaglioAlert, DettaglioAsset, Alloc } from '@/lib/alertDettaglio'

const nf = (n: number, d = 1) => n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
const eur = (n: number) => `€${Math.round(n).toLocaleString('it-IT')}`
const prezzo = (n: number) => `€${nf(n, 2)}`
const pct = (n: number, d = 1) => `${n >= 0 ? '+' : '−'}${nf(Math.abs(n), d)}%`

const TITOLO = 'text-sm font-semibold text-gray-800'
const NOTA = 'text-[11px] text-gray-400 leading-snug'

function Titolo({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-3">
      <p className={TITOLO}>{children}</p>
      {sub && <p className={NOTA}>{sub}</p>}
    </div>
  )
}

/* ───────── Budget ───────── */
function CardBudget({ d }: { d: DettaglioAlert }) {
  const b = d.budget!
  const usatoPct = b.riserva > 0 ? Math.min((b.usato / b.riserva) * 100, 100) : 0
  const riga = (label: string, v: number, evidenza = false) => (
    <div className="flex items-baseline justify-between py-2 border-b border-surface-100 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`num-display tabular-nums ${evidenza ? 'text-xl font-bold text-brand-700' : 'text-base font-semibold text-gray-800'}`}>{eur(v)}</span>
    </div>
  )
  return (
    <section className="card">
      <Titolo>Budget di accumulo</Titolo>
      {riga('Riserva', b.riserva)}
      {riga('Usati ora', b.usato)}
      {riga('Residui', b.residuo, true)}
      <div className="mt-3" role="img" aria-label={`Usato ${nf(usatoPct, 0)}% della riserva`}>
        <div className="flex h-2 rounded-full overflow-hidden bg-brand-100">
          <div className="bg-brand-600" style={{ width: `${usatoPct}%` }} />
        </div>
        <p className={`${NOTA} mt-1.5`}>{nf(usatoPct, 0)}% della riserva impegnato in questo alert</p>
      </div>
      {d.finanziamento && (
        <p className={`${NOTA} mt-2`}>
          Fondi prelevati in proporzione dalla riserva: {eur(d.finanziamento.daLiquidita)} da liquidità, {eur(d.finanziamento.daAssetSvincolati)} da asset svincolati.
        </p>
      )}
    </section>
  )
}

/* ───────── Parametri asset ───────── */
function Margine({ v }: { v: number }) {
  return v >= 0
    ? <span>−{nf(v)}%</span>
    : <span className="text-red-600">già in perdita</span>
}

function Riga({ label, prima, dopo }: { label: string; prima: React.ReactNode; dopo?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_5.5rem_5.5rem] gap-x-2 items-baseline py-1.5 border-b border-surface-100 last:border-0 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-600 text-right tabular-nums">{prima}</span>
      <span className="text-gray-900 font-semibold text-right tabular-nums">{dopo ?? ''}</span>
    </div>
  )
}

function BloccoAsset({ d }: { d: DettaglioAsset }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0 border-t first:border-t-0 border-surface-200">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-gray-900 leading-tight">{d.nome}</p>
        <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${d.accumulo ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-100' : 'bg-surface-100 text-gray-500'}`}>
          {d.accumulo ? `Accumulo ${eur(d.importo ?? 0)}` : 'Nessun accumulo'}
        </span>
      </div>
      {d.accumulo ? (
        <>
          <div className="grid grid-cols-[1fr_5.5rem_5.5rem] gap-x-2 text-[10px] text-gray-400 pb-0.5">
            <span /><span className="text-right">Prima</span><span className="text-right">Dopo</span>
          </div>
          <Riga label="PMC" prima={prezzo(d.pmc)} dopo={prezzo(d.nuovoPmc ?? d.pmc)} />
          <Riga label="PnL vs PMC" prima={pct(d.pnlPct)} dopo={pct(d.nuovoPnlPct ?? d.pnlPct)} />
          <Riga label="Margine di ribasso" prima={<Margine v={d.margineGiuPct} />} dopo={<Margine v={d.nuovoMargineGiuPct ?? d.margineGiuPct} />} />
          {d.pesoPrimaPct != null && <Riga label="Peso sul patrimonio" prima={`${nf(d.pesoPrimaPct)}%`} dopo={`${nf(d.pesoDopoPct ?? 0)}%`} />}
          {d.quote != null && <p className={`${NOTA} mt-1.5`}>≈ {nf(d.quote, 2)} quote a {prezzo(d.prezzo)}</p>}
        </>
      ) : (
        <>
          <Riga label="PMC" prima={prezzo(d.pmc)} />
          <Riga label="PnL attuale" prima={pct(d.pnlPct)} />
          <Riga label="Margine di ribasso" prima={<Margine v={d.margineGiuPct} />} />
        </>
      )}
    </div>
  )
}

function CardAsset({ asset }: { asset: DettaglioAsset[] }) {
  return (
    <section className="card">
      <Titolo sub="Margine di ribasso: quanto può ancora scendere il prezzo prima che il PnL diventi negativo.">Parametri asset</Titolo>
      {asset.map(d => <BloccoAsset key={d.id} d={d} />)}
    </section>
  )
}

/* ───────── Allocazione ───────── */
function BarraAlloc({ label, prima, dopo, target }: { label: string; prima: number; dopo: number; target?: number }) {
  const delta = dopo - prima
  const haTarget = target != null && target > 0
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <span className="text-[11px] text-gray-400 tabular-nums">
          {Math.abs(delta) >= 0.05 && <span className={delta > 0 ? 'text-brand-700' : 'text-gray-500'}>{delta > 0 ? '+' : '−'}{nf(Math.abs(delta))} pt · </span>}
          {haTarget ? `target ${nf(target!, 0)}%` : ''}
        </span>
      </div>
      <div className="relative">
        {[['Prima', prima, 'bg-surface-300'], ['Dopo', dopo, 'bg-brand-600']].map(([t, v, cls]) => (
          <div key={t as string} className="flex items-center gap-2 mb-1 last:mb-0">
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
      {classi.map(([label, k]) => <BarraAlloc key={k} label={label} prima={al.prima[k]} dopo={al.dopo[k]} target={al.target?.[k]} />)}
    </section>
  )
}

/* ───────── Top 3 holding ───────── */
function CardHolding({ d }: { d: DettaglioAlert }) {
  const h = d.holdings!
  const max = Math.max(...h.prima.map(v => v.pct), ...h.dopo.map(v => v.pct), 1)
  return (
    <section className="card">
      <Titolo sub="Peso sul valore azionario, guardando dentro gli ETF.">Top 3 holding</Titolo>
      <div className="space-y-3">
        {h.dopo.map((v, i) => {
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
      <p className={`${NOTA} mt-3`}>Copertura dati: {nf(h.coperturaPct, 0)}% del valore azionario.</p>
    </section>
  )
}

/* ───────── Layout 2×2 (desktop) ─────────
   riga 1: budget | parametri asset
   riga 2: allocazione | top 3 holding   */
export default function AlertDettaglioCard({ dettaglio }: { dettaglio: DettaglioAlert }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {dettaglio.budget && <CardBudget d={dettaglio} />}
      <CardAsset asset={dettaglio.asset} />
      {dettaglio.allocazione && <CardAllocazione d={dettaglio} />}
      {dettaglio.holdings && <CardHolding d={dettaglio} />}
    </div>
  )
}

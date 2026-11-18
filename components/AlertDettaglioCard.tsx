'use client'
import type { DettaglioAlert, DettaglioAsset, Alloc } from '@/lib/alertDettaglio'

const eur = (n: number) => `€${Math.round(n).toLocaleString('it-IT')}`
const prezzo = (n: number) => `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (n: number, d = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(d)}%`

function Margine({ v }: { v: number }) {
  return v >= 0
    ? <span>-{v.toFixed(1)}% dal prezzo</span>
    : <span className="text-red-600">già sotto PMC ({v.toFixed(1)}%)</span>
}

function Riga({ label, prima, dopo }: { label: string; prima: React.ReactNode; dopo?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-baseline py-1.5 border-b border-surface-100 last:border-0 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-700 text-right">{prima}</span>
      {dopo !== undefined && <span className="text-gray-900 font-semibold text-right min-w-[84px]">{dopo}</span>}
    </div>
  )
}

function CardAsset({ d }: { d: DettaglioAsset }) {
  return (
    <div className="rounded-xl border border-surface-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-semibold text-gray-900 leading-tight">{d.nome}</p>
        <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${d.accumulo ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
          {d.accumulo ? `Accumulo ${eur(d.importo ?? 0)}` : 'Nessun accumulo'}
        </span>
      </div>
      {d.accumulo ? (
        <>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-[10px] uppercase tracking-wide text-gray-400 pb-1">
            <span /><span className="text-right">Prima</span><span className="text-right min-w-[84px]">Dopo</span>
          </div>
          <Riga label="PMC" prima={prezzo(d.pmc)} dopo={prezzo(d.nuovoPmc ?? d.pmc)} />
          <Riga label="PnL vs PMC" prima={pct(d.pnlPct)} dopo={pct(d.nuovoPnlPct ?? d.pnlPct)} />
          <Riga label="Margine prima del PnL negativo" prima={<Margine v={d.margineGiuPct} />} dopo={<Margine v={d.nuovoMargineGiuPct ?? d.margineGiuPct} />} />
          {d.pesoPrimaPct != null && <Riga label="Peso sul patrimonio" prima={`${d.pesoPrimaPct.toFixed(1)}%`} dopo={`${(d.pesoDopoPct ?? 0).toFixed(1)}%`} />}
          {d.quote != null && <p className="text-[10px] text-gray-400 mt-2">≈ {d.quote.toLocaleString('it-IT', { maximumFractionDigits: 2 })} quote a {prezzo(d.prezzo)}</p>}
        </>
      ) : (
        <>
          <Riga label="PMC" prima={prezzo(d.pmc)} />
          <Riga label="PnL attuale" prima={pct(d.pnlPct)} />
          <Riga label="Margine prima del PnL negativo" prima={<Margine v={d.margineGiuPct} />} />
        </>
      )}
    </div>
  )
}

function BarraAlloc({ label, prima, dopo, target }: { label: string; prima: number; dopo: number; target?: number }) {
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="text-gray-500">{prima.toFixed(1)}% → <strong className="text-gray-900">{dopo.toFixed(1)}%</strong>{target != null && target > 0 ? <span className="text-gray-400"> · target {target.toFixed(0)}%</span> : null}</span>
      </div>
      <div className="relative h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-gray-300" style={{ width: `${Math.min(prima, 100)}%` }} />
        <div className="absolute inset-y-0 left-0 bg-emerald-500/80" style={{ width: `${Math.min(dopo, 100)}%`, opacity: 0.75 }} />
        {target != null && target > 0 && <div className="absolute inset-y-0 w-0.5 bg-gray-900" style={{ left: `${Math.min(target, 100)}%` }} />}
      </div>
    </div>
  )
}

export default function AlertDettaglioCard({ dettaglio }: { dettaglio: DettaglioAlert }) {
  const { allocazione: al, holdings: h, budget: b } = dettaglio
  const classi: [string, keyof Alloc][] = [['Azioni', 'azioni'], ['Obbligazioni', 'obbligazioni'], ['Liquidità', 'liquidita']]
  return (
    <div className="space-y-4">
      {b && (
        <div className="grid grid-cols-3 gap-2">
          {[['Riserva', b.riserva], ['Usati', b.usato], ['Residui', b.residuo]].map(([l, v]) => (
            <div key={l as string} className="rounded-xl border border-surface-200 bg-white px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">{l}</p>
              <p className={`text-sm font-semibold ${l === 'Residui' ? 'text-emerald-700' : 'text-gray-900'}`}>{eur(v as number)}</p>
            </div>
          ))}
        </div>
      )}

      {dettaglio.asset.map(d => <CardAsset key={d.id} d={d} />)}

      {al && (
        <div className="rounded-xl border border-surface-200 bg-white p-4">
          <p className="text-sm font-semibold text-gray-900 mb-3">Allocazione portafoglio</p>
          {classi.map(([label, k]) => (
            <BarraAlloc key={k} label={label} prima={al.prima[k]} dopo={al.dopo[k]} target={al.target?.[k]} />
          ))}
          {dettaglio.finanziamento && <p className="text-[10px] text-gray-400 mt-1">Fondi prelevati pro-quota dalla riserva: {eur(dettaglio.finanziamento.daLiquidita)} da liquidità svincolata, {eur(dettaglio.finanziamento.daAssetSvincolati)} da asset svincolati.</p>}
        </div>
      )}

      {h && (
        <div className="rounded-xl border border-surface-200 bg-white p-4">
          <p className="text-sm font-semibold text-gray-900 mb-2">Top 3 holding <span className="text-gray-400 font-normal">(% sul valore azionario)</span></p>
          {h.prima.map((v, i) => (
            <Riga key={v.nome} label={v.nome} prima={`${v.pct.toFixed(1)}%`} dopo={`${(h.dopo.find(x => x.nome === v.nome)?.pct ?? h.dopo[i]?.pct ?? 0).toFixed(1)}%`} />
          ))}
          <p className="text-[10px] text-gray-400 mt-2">Copertura dati composizione: {h.coperturaPct.toFixed(0)}% del valore azionario.</p>
        </div>
      )}
    </div>
  )
}

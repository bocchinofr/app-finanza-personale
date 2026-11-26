'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { Movimento, Liquidita, AssetPortafoglio, AlertSoglia, Profilo, MediaStorica, MESI, statoAttuale } from '@/types'
import AnalisiPortafoglio from '@/components/portfolio/AnalisiPortafoglio'
import PianoAccumulo from '@/components/PianoAccumulo'
import AlertDettaglioSezione from '@/components/AlertDettaglioSezione'
import InfoSoglieModal from '@/components/InfoSoglieModal'
import { useAnno } from '@/lib/AnnoContext'
import { parseDataIt } from '@/lib/riconciliazione'
import { HeatmapCell } from '@/components/charts/HeatmapCell'
import KpiCard, { type MiniDef } from '@/components/ui/KpiCard'
import SegmentedControl from '@/components/ui/SegmentedControl'
import Drawer from '@/components/ui/Drawer'
import { IconSliders, IconClose } from '@/components/ui/Icons'
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid
} from 'recharts'

const MESI_LABEL: Record<string, string> = {
  gen:'Gen',feb:'Feb',mar:'Mar',apr:'Apr',mag:'Mag',giu:'Giu',
  lug:'Lug',ago:'Ago',set:'Set',ott:'Ott',nov:'Nov',dic:'Dic'
}

const CLASSE_LABEL: Record<'azionario' | 'obbligazionario' | 'altro', string> = {
  azionario: 'Azionario', obbligazionario: 'Obbligazionario', altro: 'Altro'
}
const CLASSE_BADGE: Record<'azionario' | 'obbligazionario' | 'altro', string> = {
  azionario: 'bg-[#3f6b4f]/10 text-[#3f6b4f]',
  obbligazionario: 'bg-[#4a6fa1]/10 text-[#4a6fa1]',
  altro: 'bg-[#a67c3d]/10 text-[#a67c3d]',
}
const CLASSE_COLOR: Record<'azionario' | 'obbligazionario' | 'altro' | 'non classificato', string> = {
  azionario: '#3f6b4f', obbligazionario: '#4a6fa1', altro: '#a67c3d', 'non classificato': '#c9c9b8'
}

const CATEGORIE_ENTRATE = new Set([
  'STIPENDIO G','STIPENDIO F','ASSEGNO UNICO','BONUS NIDO','RIMBORSI','INTERESSI','VENDITA TITOLI'
])
const CATEGORIE_INVESTIMENTI = new Set(['INVESTIMENTI'])

function fmt(n: number) {
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtK(n: number) {
  if (n === 0) return '–'
  return `€${Math.round(n).toLocaleString('it-IT')}`
}
function fmtShort(n: number) {
  if (Math.abs(n) >= 1000) return `€${(n/1000).toFixed(1)}k`
  return `€${Math.round(n)}`
}

const PIE_COLORS = [
  '#3b69d6','#22c55e','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6',
  '#a855f7','#eab308','#6366f1','#10b981'
]

// Gradazioni per le torte di distribuzione (verde = entrate, rosso/terracotta = uscite)
const GREEN_SHADES = ['#3f6b4f','#5b8a68','#7aa682','#93bb95','#afe0b4','#cdeed0']
const RED_SHADES   = ['#8a4a3a','#af4b3a','#c17b64','#d5a39a','#e0b7ae','#ecd2cc']

// ============================================================
// COLORI DEI GRAFICI A BARRE (Andamento mensile, Spese per categoria).
// Unico punto da modificare per cambiare la palette in entrambi i grafici.
// Toni meno accesi dei colori "pieni" (es. #22c55e) ma con saturazione/luminosità
// sufficienti a restare ben leggibili — non pastello slavato.
// ============================================================
const BAR_COLORS = {
  entrate: '#4f9370',
  uscite: '#c1735a',
  risparmio: '#5b7fa6',
  liquidita: '#8f76b5',
  altro: '#9a9a86',
  categorie: [
    '#5b9c74','#c98f6b','#c2a63f','#5c85ad','#9a6fb0',
    '#4fa39c','#c98545','#7a9c4f','#bd5f8c','#5f8fbd',
    '#ad9a4f','#8f5fbd',
  ],
}

// Colori base per la heatmap (min saturazione → max saturazione), allineati al tema Foglio Vivo
const HEAT_COLORS: Record<'green' | 'red' | 'blue' | 'amber', { light: string; dark: string; textLight: string; textDark: string }> = {
  green: {
    light: '#f4f7ef',   // quasi trasparente sulla carta (min)
    dark: '#afe0b4',    // verde salvia pieno (max) — brand-700
    textLight: '#3f6b4f',
    textDark: '#162b19',
  },
  red: {
    light: '#faf4f2',
    dark: '#d5a39a',    // terracotta, coerente con la palette "uscite" scelta nel prototipo
    textLight: '#af4b3a',
    textDark: '#5c2419',
  },
  blue: {
    light: '#eef2f6',
    dark: '#8da6c6',    // blu ardesia — accent2, usato per gli investimenti
    textLight: '#3c5a82',
    textDark: '#22374f',
  },
  amber: {
    light: '#fffbeb',   // vicino al massimo → colore quasi assente
    dark: '#b45309',    // molto sotto il massimo → colore pieno
    textLight: '#b45309',
    textDark: '#78350f',
  },
};

// Scostamento (%) dal massimo 52 settimane oltre il quale il badge raggiunge l'intensità massima.
// Modifica questo valore per rendere la scala più o meno sensibile.
const HIGH_DEVIATION_SCALE_MAX = 30

function interpolateColor(color1: string, color2: string, t: number): string {
  const c1 = parseInt(color1.slice(1), 16);
  const c2 = parseInt(color2.slice(1), 16);
  const r = Math.round(((c1 >> 16) & 0xff) + (((c2 >> 16) & 0xff) - ((c1 >> 16) & 0xff)) * t);
  const g = Math.round(((c1 >> 8) & 0xff) + (((c2 >> 8) & 0xff) - ((c1 >> 8) & 0xff)) * t);
  const b = Math.round((c1 & 0xff) + ((c2 & 0xff) - (c1 & 0xff)) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Scostamento minimo del picco di riga/colonna rispetto alla media, sotto il quale
// consideriamo i valori "comparabili" e non li coloriamo (es. 121 vs 110 → nessun colore).
// Aumenta per colorare solo scostamenti più marcati, diminuisci per colorare anche variazioni lievi.
const PEAK_DEVIATION_THRESHOLD = 0.35

function HeatCell({ value, values, palette, format, total = false }: {
  value: number; values: number[]; palette: 'green' | 'red' | 'blue'; format: (n: number) => string; total?: boolean
}) {
  // Colonna "Totale": bordo di separazione dai mesi + valore in grassetto, niente heat coloring
  const tdClass = total ? 'text-center p-0.5 border-l border-surface-200' : 'text-center p-0.5'
  const weightClass = total ? 'font-bold' : 'font-medium'

  // Ignora valori <= 1
  if (value <= 1) {
    return (
      <td className={tdClass}>
        <div className={`bg-surface-50 text-gray-400 py-1 rounded-lg text-xs ${total ? 'font-bold' : ''}`}>–</div>
      </td>
    );
  }

  const nonZero = values.filter(v => v > 1)
  const mean = nonZero.length > 0 ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0
  const max = nonZero.length > 0 ? Math.max(...nonZero) : 0
  const peakDeviation = mean > 0 ? (max - mean) / mean : 0
  const isFlat = peakDeviation < PEAK_DEVIATION_THRESHOLD

  // Riga/colonna "piatta" (nessun valore fuori scala) o valore nella norma → nessuna colorazione
  if (isFlat || value <= mean) {
    return (
      <td className={tdClass}>
        <div className={`${total ? 'bg-surface-100' : 'bg-surface-50'} text-gray-700 py-1 rounded-lg text-xs ${weightClass}`}>{format(value)}</div>
      </td>
    );
  }

  // Intensità proporzionale a quanto il valore supera la media, verso il picco della riga/colonna
  const t = Math.min((value - mean) / (max - mean), 1);
  const bg = interpolateColor(HEAT_COLORS[palette].light, HEAT_COLORS[palette].dark, t);
  const textColor = t > 0.5 ? HEAT_COLORS[palette].textDark : HEAT_COLORS[palette].textLight;

  return (
    <td className={tdClass}>
      <div
        className={`py-1 rounded-lg text-xs font-mono tabular-nums transition-transform duration-150 hover:scale-105 hover:shadow-md ${weightClass}`}
        style={{ backgroundColor: bg, color: textColor, fontWeight: total ? 700 : 500 + Math.round(t * 300) }}
      >
        {format(value)}
      </div>
    </td>
  );
}

// Cella "Media" riutilizzata sia nel riepilogo aggregato che nel dettaglio per categoria.
// Stesso box arrotondato grigio chiaro delle celle "piatte" della heatmap, valore non in grassetto.
function MediaCell({ value, className = '' }: { value: number | undefined; className?: string }) {
  return (
    <td className={`text-center p-0.5 ${className}`}>
      {/* Colore testo di queste celle "secondarie": cambia qui text-gray-500 */}
      <div className={`py-0.5 text-[11px] font-mono tabular-nums ${value == null ? 'text-gray-300' : 'text-gray-400'}`}>
        {value == null ? '–' : fmtK(value)}
      </div>
    </td>
  )
}

// Cella percentuale in stile "secondario" (stesse dimensioni/colore di MediaCell), usata per
// le medie delle righe "% Risparmio del mese" / "% Risparmio investito" (anno corrente e precedente).
function PctCell({ value, className = '' }: { value: number | null | undefined; className?: string }) {
  return (
    <td className={`text-center p-0.5 ${className}`}>
      <div className={`py-0.5 text-[11px] font-mono tabular-nums ${value == null ? 'text-gray-300' : 'text-gray-400'}`}>
        {value == null ? '–' : `${value.toFixed(0)}%`}
      </div>
    </td>
  )
}

// Variazione % del valore attuale rispetto allo stesso valore dell'anno precedente.
// Neutra come le altre celle di sintesi: solo una freccia a indicare la direzione.
function VarCell({ attuale, precedente, className = '', anno }: { attuale: number; precedente: number | undefined; className?: string; anno?: number }) {
  const pct = precedente ? ((attuale - precedente) / Math.abs(precedente)) * 100 : null
  return (
    <td className={`text-center p-0.5 ${className}`} title={precedente != null && anno ? `${anno - 1}: ${fmtK(precedente)}` : undefined}>
      {/* Colore testo di queste celle "secondarie": cambia qui text-gray-500 */}
      <div className={`py-0.5 text-[11px] font-mono tabular-nums ${pct == null ? 'text-gray-300' : 'text-gray-400'}`}>
        {pct == null ? '–' : `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(0)}%`}
      </div>
    </td>
  )
}

// Tooltip per "Spese per categoria": mostra solo le voci realmente presenti nel mese
// (le prime 10 categorie di quel mese + Altro), non l'intero elenco di dataKey del grafico.
type SpeseTooltipPayload = { dataKey: string; value: number; color: string }
function SpeseCategoriaTooltip({ active, payload, label }: {
  active?: boolean; payload?: SpeseTooltipPayload[]; label?: string
}) {
  if (!active || !payload) return null
  const items = payload.filter(p => p.value > 0).sort((a, b) => b.value - a.value)
  if (items.length === 0) return null
  return (
    <div className="bg-white border border-surface-200 rounded-lg shadow-lg px-3 py-2 text-xs space-y-1">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {items.map(p => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: p.color }} />
            <span className="text-gray-600 truncate">{p.dataKey}</span>
          </span>
          <span className="font-mono font-semibold text-gray-800 shrink-0">{fmtK(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

type DraftSoglia = { massimo: number; mensile: number; attivo: boolean; accumulo: boolean }

const PAGE_SIZE = 20
type FiltroKey = 'mese' | 'cat' | 'conto'

/** Gruppo di filtro a selezione multipla con modalità Includi / Escludi. */
function FiltroGruppo({ titolo, opzioni, selezionati, escludi, onToggle, onModo, onReset }: {
  titolo: string
  opzioni: { value: string; label: string }[]
  selezionati: string[]
  escludi: boolean
  onToggle: (v: string) => void
  onModo: (escludi: boolean) => void
  onReset: () => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {titolo}{selezionati.length > 0 && <span className="ml-1.5 normal-case text-gray-400">({selezionati.length})</span>}
        </p>
        <div className="flex items-center gap-2">
          {selezionati.length > 0 && (
            <button type="button" onClick={onReset} className="text-[11px] font-medium text-gray-400 hover:text-gray-700">Deseleziona</button>
          )}
          <SegmentedControl
            ariaLabel={`Modalità filtro ${titolo}`} value={escludi ? 'escludi' : 'includi'}
            onChange={v => onModo(v === 'escludi')}
            options={[{ value: 'includi', label: 'Includi' }, { value: 'escludi', label: 'Escludi' }]}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {opzioni.map(o => {
          const on = selezionati.includes(o.value)
          return (
            <button key={o.value} type="button" onClick={() => onToggle(o.value)} aria-pressed={on}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                on
                  ? escludi ? 'bg-red-50 border-red-200 text-red-700 line-through decoration-red-300' : 'bg-brand-50 border-brand-200 text-brand-700'
                  : 'bg-white border-surface-200 text-gray-600 hover:bg-surface-50'
              }`}>
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
type SortKey = 'mese' | 'data_operazione' | 'descrizione' | 'importo' | 'categoria' | 'componente'
type SortDir = 'asc' | 'desc'

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`ml-1 text-xs ${active ? 'text-brand-600' : 'text-gray-300'}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )
}

// ===== Cash flow: tabelle e grafici =====
const CF_TH = 'py-2 px-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-gray-400 bg-surface-50 border-b border-surface-200 leading-tight'
const CF_TONE = {
  green: { dot: '#3f6b4f', text: 'text-green-800' },
  red:   { dot: '#c0504d', text: 'text-red-800' },
  blue:  { dot: '#4a6fa1', text: 'text-blue-800' },
}
type PrecAgg = { media: number; totale: number } | undefined

/** Variazione in punti percentuali (righe % del riepilogo); il valore dell'anno prima è nel tooltip. */
function PtCell({ attuale, precedente, anno, className = '' }: { attuale: number | null; precedente: number | null; anno: number; className?: string }) {
  const d = attuale != null && precedente != null ? attuale - precedente : null
  return (
    <td className={`text-center p-0.5 ${className}`} title={precedente != null ? `${anno - 1}: ${precedente.toFixed(0)}%` : undefined}>
      <div className={`py-0.5 text-[11px] font-mono tabular-nums ${d == null ? 'text-gray-300' : 'text-gray-400'}`}>
        {d == null ? '–' : `${d >= 0 ? '↑' : '↓'} ${Math.abs(d).toFixed(0)} pt`}
      </div>
    </td>
  )
}

/** Intestazione condivisa da riepilogo e dettaglio. */
function CfHead({ prima, mesi }: { prima: string; mesi: string[] }) {
  return (
    <thead>
      <tr>
        <th className={`${CF_TH} sticky left-0 z-10 text-left px-3 min-w-[11rem]`}>{prima}</th>
        {mesi.map(m => <th key={m} className={`${CF_TH} min-w-[62px]`}>{MESI_LABEL[m]}</th>)}
        <th className={`${CF_TH} min-w-[84px] text-right px-3 !bg-surface-100 text-gray-600 border-l border-surface-200`}>Totale</th>
        <th className={`${CF_TH} min-w-[56px]`}>Media</th>
        <th className={`${CF_TH} min-w-[56px] border-l border-surface-200`}><span className="block">Var.</span><span className="block">media</span></th>
        <th className={`${CF_TH} min-w-[56px]`}><span className="block">Var.</span><span className="block">totale</span></th>
      </tr>
    </thead>
  )
}

/** Riga di totale (entrate / uscite / investimenti / risparmio) del riepilogo mensile. */
function CfTotRow({ label, tone, prec, valori, totale, media, anno }: {
  label: string; tone: 'green' | 'red' | 'blue' | 'risp'; prec: PrecAgg
  valori: number[]; totale: number; media: number; anno: number
}) {
  const t = tone === 'risp' ? (totale >= 0 ? CF_TONE.green : CF_TONE.red) : CF_TONE[tone]
  return (
    <tr className="border-b border-surface-100 hover:bg-surface-50 transition-colors group">
      <td className="sticky left-0 z-10 bg-white group-hover:bg-surface-50 transition-colors px-3 py-2 whitespace-nowrap">
        <span className={`inline-flex items-center gap-2 text-xs font-semibold ${t.text}`}>
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.dot }} />{label}
        </span>
      </td>
      {valori.map((v, i) => (
        <td key={i} className={`px-1.5 py-2 text-center font-mono tabular-nums text-xs ${
          tone === 'risp' ? (v >= 0 ? 'text-green-800 font-semibold' : 'text-red-700 font-semibold') : `${t.text} font-medium`}`}>
          {fmtK(v)}
        </td>
      ))}
      <td className={`px-3 py-2 text-right font-mono tabular-nums text-xs font-bold border-l border-surface-200 ${
        tone === 'risp' ? (totale >= 0 ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700') : `bg-surface-50 ${t.text}`}`}>
        {fmtK(totale)}
      </td>
      <MediaCell value={media} />
      <VarCell attuale={media} precedente={prec?.media} anno={anno} className="border-l border-surface-200" />
      <VarCell attuale={totale} precedente={prec?.totale} anno={anno} />
    </tr>
  )
}

/** Riga percentuale (tasso di risparmio, quota investita). */
function CfPctRow({ label, precMedia, precTot, valori, totale, media, colora, anno }: {
  label: string; precMedia: number | null; precTot: number | null; valori: (number | null)[]
  totale: number | null; media: number | null; colora: boolean; anno: number
}) {
  return (
    <tr className="border-b border-surface-100 last:border-b-0">
      <td className="sticky left-0 z-10 bg-white px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{label}</td>
      {valori.map((v, i) => (
        <td key={i} className={`px-1.5 py-2 text-center font-mono tabular-nums text-xs ${
          v == null ? 'text-gray-300' : colora ? (v >= 0 ? 'text-green-700' : 'text-red-700') : 'text-gray-600'}`}>
          {v == null ? '–' : `${v.toFixed(0)}%`}
        </td>
      ))}
      <td className={`px-3 py-2 text-right font-mono tabular-nums text-xs font-bold bg-surface-50 border-l border-surface-200 ${
        totale == null ? 'text-gray-300' : colora ? (totale >= 0 ? 'text-green-700' : 'text-red-700') : 'text-gray-700'}`}>
        {totale == null ? '–' : `${totale.toFixed(0)}%`}
      </td>
      <PctCell value={media} />
      <PtCell attuale={media} precedente={precMedia} anno={anno} className="border-l border-surface-200" />
      <PtCell attuale={totale} precedente={precTot} anno={anno} />
    </tr>
  )
}

/** Intestazione di sezione nella tabella per categoria (resta visibile durante lo scroll orizzontale). */
function CfSezione({ label, color, colSpan }: { label: string; color: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="pt-4 pb-1.5 px-3 border-b border-surface-200 bg-white">
        <div className="sticky left-3 w-max inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{label}
        </div>
      </td>
    </tr>
  )
}

/** Riga di categoria con heatmap sui mesi. */
function CfCatRow({ cat, vals, mesi, total, totaliColonna, nMesi, prec, palette, anno }: {
  cat: string; vals: Record<string, number>; mesi: string[]; total: number; totaliColonna: number[]
  nMesi: number; prec: PrecAgg; palette: 'green' | 'red' | 'blue'; anno: number
}) {
  const rowValues = mesi.map(m => vals[m] ?? 0)
  const media = total / nMesi
  return (
    <tr className="group border-b border-surface-100 hover:bg-surface-50 transition-colors">
      <td className="sticky left-0 z-10 bg-white group-hover:bg-surface-50 transition-colors py-1 px-3 text-xs text-gray-600 whitespace-nowrap">{cat}</td>
      {mesi.map(m => <HeatCell key={m} value={vals[m] ?? 0} values={rowValues} palette={palette} format={fmtK} />)}
      <HeatCell value={total} values={totaliColonna} palette={palette} format={fmtK} total />
      <MediaCell value={media} />
      <VarCell attuale={media} precedente={prec?.media} anno={anno} className="border-l border-surface-200" />
      <VarCell attuale={total} precedente={prec?.totale} anno={anno} />
    </tr>
  )
}

/** Donut di distribuzione con totale al centro e legenda. */
function DonutDistribuzione({ titolo, sottotitolo, data, shades, totale }: {
  titolo: string; sottotitolo: string; data: { name: string; value: number }[]; shades: string[]; totale: number
}) {
  return (
    <div className="flex flex-col">
      <p className="num-display text-sm font-semibold text-gray-900">{titolo}</p>
      <p className="text-xs text-gray-400 mt-0.5 mb-3">{sottotitolo}</p>
      <div className="flex flex-wrap items-center justify-center gap-5">
        <div className="relative shrink-0" style={{ width: 220, height: 220 }}>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Totale</p>
            <p className="num-display text-base font-bold text-gray-900">{fmtK(totale)}</p>
          </div>
          <ResponsiveContainer width={220} height={220}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={108} innerRadius={70}>
                {data.map((_, i) => <Cell key={i} fill={shades[i % shades.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => fmtK(v)} wrapperStyle={{ zIndex: 50 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="min-w-[160px] flex-1 max-w-[240px] space-y-1.5">
          {data.map((d, i) => (
            <div key={d.name} className="flex justify-between items-center gap-2 text-[11px]">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: shades[i % shades.length] }} />
                <span className="text-gray-600 truncate">{d.name}</span>
              </div>
              <span className="font-semibold text-gray-800 shrink-0 tabular-nums">{totale > 0 ? `${((d.value / totale) * 100).toFixed(0)}%` : '–'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const supabase = createClient()
  const [tab, setTab] = useState<'movimenti' | 'cashflow' | 'portafoglio' | 'analisi'>('movimenti')
  const [showHeatmap, setShowHeatmap] = useState(false)   // false = Riepilogo, true = Per categoria
  const [cfGrafico, setCfGrafico] = useState<'andamento' | 'spese' | 'distribuzione'>('andamento')
  const [movimenti, setMovimenti] = useState<Movimento[]>([])
  const [liquidita, setLiquidita] = useState<Liquidita[]>([])
  const [portafoglio, setPortafoglio] = useState<AssetPortafoglio[]>([])
  const [loading, setLoading] = useState(true)
  const { anno } = useAnno()
  type QuoteInfo = { price: number; high52: number | null; changeFromHigh: number | null; changeFromMonth: number | null }
  const [prezziAttuali, setPrezziAttuali] = useState<Record<string, QuoteInfo>>({})
  const [loadingPrezzi, setLoadingPrezzi] = useState(false)
  const [savingSnapshot, setSavingSnapshot] = useState(false)
  const [snapshotSalvato, setSnapshotSalvato] = useState<number | null>(null)
  const [portafoglioStorico, setPortafoglioStorico] = useState<
    { mese: string; portafoglio_id: string; prezzo: number }[]
  >([])
  // Media mensile dell'anno precedente, per categoria (inserita manualmente su Supabase
  // quando non ci sono movimenti dettagliati per quell'anno). '–' se assente.
  const [storicoAnnoPrec, setStoricoAnnoPrec] = useState<Record<string, { media: number; totale: number }>>({})

  // Soglie di allerta portafoglio
  const [soglie, setSoglie] = useState<AlertSoglia[]>([])
  const [profilo, setProfilo] = useState<Profilo | null>(null)
  const [showSoglieForm, setShowSoglieForm] = useState(false)
  const [globalSogliaMax, setGlobalSogliaMax] = useState(15)
  const [globalSogliaMese, setGlobalSogliaMese] = useState(10)
  const [draftSoglie, setDraftSoglie] = useState<Record<string, DraftSoglia>>({})
  const [savingSoglie, setSavingSoglie] = useState(false)
  const [simPrefill, setSimPrefill] = useState<{ nonce: number; strumentoId: string; importo: number } | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [bannerChiusuraDismissed, setBannerChiusuraDismissed] = useState(false)

  // Sezioni apribili/richiudibili del tab Portafoglio (toggle indipendenti)
  // Asset inclusi nel Piano di accumulo: per loro la soglia "dal massimo" è gestita dalle tranche del piano
  const [idPiano, setIdPiano] = useState<Set<string>>(new Set())
  const [openSection, setOpenSection] = useState({
    riserva: false,
    storico: false,
    alert: false,
  })
  // Pallino sul bottone "Dettaglio alert" finché l'ultimo alert con dettaglio non è stato aperto
  const [ultimoAlertTs, setUltimoAlertTs] = useState<string | null>(null)
  const [alertVisto, setAlertVisto] = useState<string | null>(null)
  useEffect(() => {
    try { setAlertVisto(localStorage.getItem('alertDettaglioVisto')) } catch { /* storage non disponibile */ }
    let attivo = true
    async function carica() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('notifiche').select('created_at')
        .eq('user_id', user.id).not('dettaglio', 'is', null)
        .order('created_at', { ascending: false }).limit(1)
      if (attivo) setUltimoAlertTs((data as { created_at: string }[] | null)?.[0]?.created_at ?? null)
    }
    carica()
    window.addEventListener('notifiche:refresh', carica)
    return () => { attivo = false; window.removeEventListener('notifiche:refresh', carica) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (openSection.alert && ultimoAlertTs) {
      try { localStorage.setItem('alertDettaglioVisto', ultimoAlertTs) } catch { /* ignora */ }
      setAlertVisto(ultimoAlertTs)
    }
  }, [openSection.alert, ultimoAlertTs])
  const alertNuovo = !!ultimoAlertTs && ultimoAlertTs !== alertVisto

  // Link dalla mail/campanello: ?tab=portafoglio&sezione=alert
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('tab') === 'portafoglio') setTab('portafoglio')
    if (q.get('sezione') === 'alert') setOpenSection({ riserva: false, storico: false, alert: true })
  }, [])
  const closeSections = () => setOpenSection({ riserva: false, storico: false, alert: false })
  // Aprendo un pannello si chiudono gli altri; ricliccando il pulsante si richiude
  function toggleSection(key: keyof typeof openSection) {
    setOpenSection(prev => {
      const eraAperta = prev[key]
      return { riserva: false, storico: false, alert: false, [key]: !eraAperta }
    })
  }

  // Valore attuale di ogni asset (fallback al valore di carico se manca la quotazione live)
  const assetValori = useMemo(() => {
    return portafoglio.map(a => {
      const { quantita: qtaAttuale, prezzoCarico } = statoAttuale(a)
      const quote = a.ticker ? prezziAttuali[a.ticker] : undefined
      const prezzoAtt = quote?.price ?? prezzoCarico
      return { asset: a, valore: prezzoAtt * qtaAttuale }
    }).filter(v => v.valore > 0)
  }, [portafoglio, prezziAttuali])

  const totaleValori = useMemo(() => assetValori.reduce((s, v) => s + v.valore, 0), [assetValori])

  // Allocazione per classe (donut)
  const allocazioneClasse = useMemo(() => {
    const gruppi: Record<'azionario' | 'obbligazionario' | 'altro' | 'non classificato', number> = {
      azionario: 0, obbligazionario: 0, altro: 0, 'non classificato': 0,
    }
    for (const { asset, valore } of assetValori) {
      const key = asset.classe_rischio ?? 'non classificato'
      gruppi[key] += valore
    }
    return (Object.entries(gruppi) as [keyof typeof gruppi, number][])
      .filter(([, value]) => value > 0)
      .map(([key, value]) => ({
        name: key === 'non classificato' ? 'Non classificato' : CLASSE_LABEL[key],
        value,
        color: CLASSE_COLOR[key],
      }))
  }, [assetValori])

  // Peso % di ogni asset sul totale investito (barre), colorate per classe di rischio
  const pesoAsset = useMemo(() => {
    return assetValori
      .map(({ asset, valore }) => ({
        nome: asset.nome || asset.asset,
        peso: totaleValori > 0 ? (valore / totaleValori) * 100 : 0,
        classe: (asset.classe_rischio ?? 'non classificato') as keyof typeof CLASSE_COLOR,
      }))
      .sort((a, b) => b.peso - a.peso)
      .slice(0, 12)
  }, [assetValori, totaleValori])

  // Filters
  const [expandedAssetRow, setExpandedAssetRow] = useState<number | null>(null)
  // Filtri multi-selezione: per ogni gruppo si può includere o escludere i valori scelti
  const [filtri, setFiltri] = useState<Record<FiltroKey, string[]>>({ mese: [], cat: [], conto: [] })
  const [escludi, setEscludi] = useState<Record<FiltroKey, boolean>>({ mese: false, cat: false, conto: false })
  const [filterType, setFilterType] = useState<'all' | 'in' | 'out'>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [showFiltri, setShowFiltri] = useState(false)
  const [selectedMov, setSelectedMov] = useState<Movimento | null>(null)
  useEffect(() => { setPage(1) }, [anno])

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('mese')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const [movRes, liqRes, portRes, sogRes, profRes, medieRes, pianoRes] = await Promise.all([
      supabase.from('movimenti').select('*').eq('user_id', user.id).eq('anno', anno),
      supabase.from('liquidita').select('*').eq('user_id', user.id).eq('anno', anno),
      supabase.from('portafoglio').select('*').eq('user_id', user.id),
      supabase.from('alert_soglie').select('*').eq('user_id', user.id),
      supabase.from('profili').select('*').eq('user_id', user.id).single(),
      supabase.from('medie_storiche').select('*').eq('user_id', user.id).eq('anno', anno - 1),
      supabase.from('accumulo_asset').select('portafoglio_id').eq('user_id', user.id).eq('attivo', true),
    ])

    setMovimenti((movRes.data as Movimento[]) ?? [])
    setLiquidita((liqRes.data as Liquidita[]) ?? [])
    setPortafoglio((portRes.data as AssetPortafoglio[]) ?? [])
    setSoglie((sogRes.data as AlertSoglia[]) ?? [])
    setProfilo((profRes.data as Profilo) ?? null)
    setIdPiano(new Set(((pianoRes.data as { portafoglio_id: string }[]) ?? []).map(r => r.portafoglio_id)))
    setStoricoAnnoPrec(
      Object.fromEntries(((medieRes.data as MediaStorica[]) ?? []).map(r => [r.categoria, { media: r.media, totale: r.totale }]))
    )
    setLoading(false)
  }, [anno])

  useEffect(() => { loadData() }, [loadData])

  // Inizializza il form soglie con i valori salvati (o i default globali)
  useEffect(() => {
    setDraftSoglie(prev => {
      const next: Record<string, DraftSoglia> = {}
      portafoglio.forEach(a => {
        if (!a.id) return
        const sMax = soglie.find(s => s.portafoglio_id === a.id && s.tipo === 'storico')
        const sMese = soglie.find(s => s.portafoglio_id === a.id && s.tipo === 'mensile')
        next[a.id] = prev[a.id] ?? {
          massimo: sMax?.soglia_pct ?? globalSogliaMax,
          mensile: sMese?.soglia_pct ?? globalSogliaMese,
          attivo: sMax?.attivo ?? sMese?.attivo ?? true,
          accumulo: sMax?.accumulo ?? sMese?.accumulo ?? true,
        }
      })
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portafoglio, soglie])

  // Prezzi attuali via Yahoo Finance, recuperati tramite la nostra API route
  // (la chiamata diretta a Yahoo dal browser viene bloccata da CORS)
  async function fetchPrezziAttuali() {
    const tickers = [...new Set(portafoglio.map(a => a.ticker).filter(Boolean))]
    if (tickers.length === 0) return
    setLoadingPrezzi(true)
    try {
      const res = await fetch(`/api/quote?tickers=${tickers.join(',')}`)
      if (!res.ok) throw new Error(`API prezzi: ${res.status}`)
      const json = await res.json()
      setPrezziAttuali(json)

      // Check soglie on-demand: inserisce eventuali notifiche + invia email,
      // poi aggiorna il campanello in UI senza bisogno di ricaricare la pagina.
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        const alertRes = await fetch('/api/check-alerts-now', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (alertRes.ok) {
          const alertJson = await alertRes.json()
          if (alertJson.nuoveNotifiche > 0) {
            const { data } = await supabase.from('alert_soglie').select('*').eq('user_id', session.user.id)
            setSoglie((data as AlertSoglia[]) ?? [])
            window.dispatchEvent(new Event('notifiche:refresh'))
            setBannerDismissed(false)
          }
        }
      }
    } catch (err) {
      console.error('Errore nel recupero dei prezzi', err)
    } finally {
      setLoadingPrezzi(false)
    }
  }

  // Il bottone registra sempre la chiusura dell'ULTIMO MESE CONCLUSO, non
  // quello in corso: se oggi è il 5 agosto, registra il 31/07 (luglio è
  // l'ultimo mese completo).
  function meseDaRegistrare() {
    const oggi = new Date()
    const meseIdx = oggi.getMonth() // 0=gennaio ... 11=dicembre
    const meseScorsoIdx = meseIdx === 0 ? 11 : meseIdx - 1
    const annoScorso = meseIdx === 0 ? oggi.getFullYear() - 1 : oggi.getFullYear()
    return { mese: MESI[meseScorsoIdx], anno: annoScorso }
  }

  // Salva prezzo/valore/plus-minus di ogni singolo asset per l'ultimo mese
  // concluso, per costruire lo storico prezzi e il rendimento per asset.
  // Riusa i prezzi già in sessione se presenti, altrimenti li recupera ora.
  async function salvaSnapshotFineMese() {
    const tickers = [...new Set(portafoglio.map(a => a.ticker).filter(Boolean))]
    if (tickers.length === 0) return

    setSavingSnapshot(true)
    setSnapshotSalvato(null)
    try {
      let prezzi = prezziAttuali
      if (Object.keys(prezzi).length === 0) {
        const res = await fetch(`/api/quote?tickers=${tickers.join(',')}`)
        if (!res.ok) throw new Error(`API prezzi: ${res.status}`)
        prezzi = await res.json()
        setPrezziAttuali(prezzi)
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { mese: meseTarget, anno: annoTarget } = meseDaRegistrare()

      const righe = portafoglio
        .filter(a => a.id && a.ticker)
        .map(a => {
          const { quantita, prezzoCarico } = statoAttuale(a)
          const prezzo = a.ticker && prezzi[a.ticker] ? prezzi[a.ticker].price : prezzoCarico
          return {
            user_id: user.id,
            anno: annoTarget,
            mese: meseTarget,
            portafoglio_id: a.id!,
            ticker: a.ticker,
            quantita,
            prezzo,
            prezzo_carico: prezzoCarico,
            valore_mercato: prezzo * quantita,
            valore_carico: prezzoCarico * quantita,
            plus_minus: (prezzo - prezzoCarico) * quantita,
          }
        })

      if (righe.length > 0) {
        await supabase.from('portafoglio_storico').delete().eq('user_id', user.id).eq('anno', annoTarget).eq('mese', meseTarget)
        const { error } = await supabase.from('portafoglio_storico').insert(righe)
        if (error) throw error
        setSnapshotSalvato(righe.length)
      }
    } catch (err) {
      console.error('Errore nel salvataggio dello snapshot', err)
    } finally {
      setSavingSnapshot(false)
    }
  }

  useEffect(() => {
    async function loadStoricoPrezzi() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('portafoglio_storico')
        .select('mese, portafoglio_id, prezzo')
        .eq('user_id', user.id)
        .eq('anno', anno)
      setPortafoglioStorico(data ?? [])
    }
    loadStoricoPrezzi()
  }, [anno, snapshotSalvato])

  // Il check soglie + insert notifiche + invio email è gestito server-side
  // dalla route /api/check-alerts (chiamata via cron GitHub Actions).
  // Il bottone "Aggiorna prezzi" qui serve solo per la visualizzazione in UI.

  // Applica i due valori globali a tutti gli asset nel form (prima di salvare)
  function applicaSoglieATutti() {
    setDraftSoglie(prev => {
      const next = { ...prev }
      portafoglio.forEach(a => {
        if (!a.id) return
        next[a.id] = { ...(next[a.id] ?? { attivo: true, accumulo: true }), massimo: globalSogliaMax, mensile: globalSogliaMese }
      })
      return next
    })
  }

  // Salva le soglie impostate nel form su Supabase (upsert: 2 righe per asset)
  async function saveSoglie() {
    setSavingSoglie(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSavingSoglie(false); return }

    const rows: Partial<AlertSoglia>[] = []
    portafoglio.forEach(a => {
      if (!a.id) return
      const d = draftSoglie[a.id]
      if (!d) return
      rows.push({ user_id: user.id, portafoglio_id: a.id, tipo: 'storico', soglia_pct: d.massimo, attivo: d.attivo, accumulo: d.accumulo })
      rows.push({ user_id: user.id, portafoglio_id: a.id, tipo: 'mensile', soglia_pct: d.mensile, attivo: d.attivo, accumulo: d.accumulo })
    })

    if (rows.length === 0) {
      console.error('Nessuna riga da salvare: gli asset del portafoglio non hanno un id valido (a.id è undefined). Verifica che la tabella "portafoglio" abbia una colonna "id".')
      alert('Nessun asset valido da salvare: manca l\'id nella tabella portafoglio. Controlla la console per i dettagli.')
      setSavingSoglie(false)
      return
    }

    const { error } = await supabase.from('alert_soglie').upsert(rows, { onConflict: 'user_id,portafoglio_id,tipo' })
    if (error) {
      console.error('Errore salvataggio soglie:', error)
      alert(`Errore salvataggio soglie: ${error.message}`)
    } else {
      const { data, error: reloadError } = await supabase.from('alert_soglie').select('*').eq('user_id', user.id)
      if (reloadError) console.error('Errore ricaricamento soglie:', reloadError)
      setSoglie((data as AlertSoglia[]) ?? [])
    }
    setSavingSoglie(false)
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }

  const componenti = [...new Set(movimenti.map(m => m.componente).filter(Boolean))].sort()

  function passaFiltro(k: FiltroKey, val: string) {
    const sel = filtri[k]
    if (sel.length === 0) return true
    return escludi[k] ? !sel.includes(val) : sel.includes(val)
  }
  function toggleFiltro(k: FiltroKey, v: string) {
    setFiltri(f => ({ ...f, [k]: f[k].includes(v) ? f[k].filter(x => x !== v) : [...f[k], v] }))
    setPage(1)
  }
  function azzeraFiltri() {
    setFiltri({ mese: [], cat: [], conto: [] })
    setEscludi({ mese: false, cat: false, conto: false })
    setSearch(''); setFilterType('all'); setPage(1)
  }

  const filtered = movimenti.filter(m => {
    if (!passaFiltro('conto', m.componente)) return false
    if (!passaFiltro('mese', m.mese)) return false
    if (!passaFiltro('cat', m.categoria)) return false
    if (filterType === 'in' && m.entrate === 0) return false
    if (filterType === 'out' && m.uscite === 0) return false
    if (search && !m.descrizione.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const getMesiIdx = (m: Movimento) => MESI.indexOf(m.mese as typeof MESI[number])
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    switch (sortKey) {
      case 'mese': cmp = getMesiIdx(a) - getMesiIdx(b); if (cmp === 0) cmp = (a.data_operazione ?? '').localeCompare(b.data_operazione ?? ''); break
      case 'data_operazione': cmp = (a.data_operazione ?? '').localeCompare(b.data_operazione ?? ''); break
      case 'descrizione': cmp = a.descrizione.localeCompare(b.descrizione); break
      case 'importo': cmp = (a.entrate + a.uscite) - (b.entrate + b.uscite); break
      case 'categoria': cmp = a.categoria.localeCompare(b.categoria); break
      case 'componente': cmp = (a.componente ?? '').localeCompare(b.componente ?? ''); break
    }
    return sortDir === 'asc' ? cmp : -cmp
  })

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageData = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalIn = filtered.reduce((s, m) => s + m.entrate, 0)
  const totalOut = filtered.reduce((s, m) => s + m.uscite, 0)
  const saldo = totalIn - totalOut
  const cats = [...new Set(movimenti.map(m => m.categoria))].sort()
  const filtriAttivi = filtri.mese.length + filtri.cat.length + filtri.conto.length
  const qualcosaDaAzzerare = filtriAttivi > 0 || search !== '' || filterType !== 'all'
  const flussiPct = (v: number) => ((totalIn + totalOut) > 0 ? ((v / (totalIn + totalOut)) * 100).toFixed(0) : '0')

  // Ripartizione Entrate/Uscite per componente (conto), stesso stile della card Liquidità
  const entratePerComponente = componenti.length > 0
    ? componenti.map(c => ({ componente: c, val: filtered.filter(m => m.componente === c).reduce((s, m) => s + m.entrate, 0) })).filter(c => c.val !== 0)
    : []
  const uscitePerComponente = componenti.length > 0
    ? componenti.map(c => ({ componente: c, val: filtered.filter(m => m.componente === c).reduce((s, m) => s + m.uscite, 0) })).filter(c => c.val !== 0)
    : []

  // Liquidità: ultima registrazione disponibile per i movimenti
  const ultimaLiquidita = (() => {
    if (liquidita.length === 0) return null
    const sorted = [...liquidita].sort((a, b) => {
      const mi = MESI.indexOf(a.mese as typeof MESI[number]) - MESI.indexOf(b.mese as typeof MESI[number])
      return mi
    })
    const lastMese = sorted[sorted.length - 1].mese
    const rows = sorted.filter(l => l.mese === lastMese)
    const total = rows.reduce((s, l) => s + l.saldo, 0)
    return { mese: lastMese, total, conti: rows }
  })()

  // Cash Flow data
  const mesiPresenti = MESI.filter(m => movimenti.some(r => r.mese === m))
  const cfEntrate: Record<string, Record<string, number>> = {}
  const cfUscite: Record<string, Record<string, number>> = {}
  const cfInv: Record<string, Record<string, number>> = {}

  for (const m of movimenti) {
    const cat = m.categoria
    const isEntrata = CATEGORIE_ENTRATE.has(cat)
    const isInv = CATEGORIE_INVESTIMENTI.has(cat)
    const target = isInv ? cfInv : isEntrata ? cfEntrate : cfUscite
    if (!target[cat]) target[cat] = {}
    target[cat][m.mese] = (target[cat][m.mese] ?? 0) + (m.entrate > 0 ? m.entrate : m.uscite)
  }

  const cfTotIn  = mesiPresenti.map(ms => Object.values(cfEntrate).reduce((s, r) => s + (r[ms] ?? 0), 0))
  const cfTotOut = mesiPresenti.map(ms => Object.values(cfUscite).reduce((s, r) => s + (r[ms] ?? 0), 0))
  const cfTotInv = mesiPresenti.map(ms => Object.values(cfInv).reduce((s, r) => s + (r[ms] ?? 0), 0))
  // Risparmio = entrate - uscite (l'investimento è una destinazione del risparmio, non un costo)
  const cfRisparmio = mesiPresenti.map((_, i) => cfTotIn[i] - cfTotOut[i])

  // Ogni riga/categoria ha la propria scala (min→max di quella riga): mette in evidenza le
  // anomalie della singola categoria, anche quando gli importi assoluti sono piccoli.
  // La riga "Totale" ha invece una scala propria calcolata sui totali mensili, per far
  // risaltare i mesi fuori scala sul totale complessivo.
  const entrateTotals = Object.entries(cfEntrate).map(([cat, vals]) => ({ cat, total: Object.values(vals).reduce((a, b) => a + b, 0) })).filter(d => d.total > 0)
  const usciteTotals  = Object.entries(cfUscite).map(([cat, vals]) => ({ cat, total: Object.values(vals).reduce((a, b) => a + b, 0) })).filter(d => d.total > 0)
  const invTotals     = Object.entries(cfInv).map(([cat, vals]) => ({ cat, total: Object.values(vals).reduce((a, b) => a + b, 0) })).filter(d => d.total > 0)

  const maxPerEntrata: Record<string, number> = {}
  Object.entries(cfEntrate).forEach(([cat, vals]) => { maxPerEntrata[cat] = Math.max(...Object.values(vals), 0) })
  const maxPerUscita: Record<string, number> = {}
  Object.entries(cfUscite).forEach(([cat, vals]) => { maxPerUscita[cat] = Math.max(...Object.values(vals), 0) })
  const maxPerInv: Record<string, number> = {}
  Object.entries(cfInv).forEach(([cat, vals]) => { maxPerInv[cat] = Math.max(...Object.values(vals), 0) })

  const ytdIn   = cfTotIn.reduce((a, b) => a + b, 0)
  const ytdOut  = cfTotOut.reduce((a, b) => a + b, 0)
  const ytdInv  = cfTotInv.reduce((a, b) => a + b, 0)
  const ytdRisp = cfRisparmio.reduce((a, b) => a + b, 0)
  const nMesi = mesiPresenti.length || 1
  const mediaEntrateMensili = ytdIn / nMesi
  const mediaUsciteMensili = ytdOut / nMesi
  const pctInvestitoSuEntrate = ytdIn > 0 ? (ytdInv / ytdIn) * 100 : 0
  const savingRate = ytdIn > 0 ? (ytdRisp / ytdIn) * 100 : 0

  // Media delle percentuali mensili (diversa dal rapporto YTD "Totale" sopra, perché pesa ogni mese allo stesso modo)
  const pctRisparmioMensile = mesiPresenti.map((_, i) => cfTotIn[i] > 0 ? (cfRisparmio[i] / cfTotIn[i]) * 100 : null)
  const pctRisparmioMediaMensile = (() => {
    const vals = pctRisparmioMensile.filter((v): v is number => v != null)
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  })()
  const pctInvestitoMensile = mesiPresenti.map((_, i) => {
    const lordo = cfRisparmio[i]
    return lordo > 0 ? (cfTotInv[i] / lordo) * 100 : (cfTotInv[i] > 0 ? null : 0)
  })
  const pctInvestitoMediaMensile = (() => {
    const vals = pctInvestitoMensile.filter((v): v is number => v != null)
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  })()

  // Anno precedente: non abbiamo il dettaglio mensile, solo gli aggregati storicoAnnoPrec (media/totale per categoria)
  const entratePrecTot = storicoAnnoPrec['TOTALE_ENTRATE']?.totale
  const entratePrecMedia = storicoAnnoPrec['TOTALE_ENTRATE']?.media
  const rispPrecTot = storicoAnnoPrec['RISPARMIO_NETTO']?.totale
  const rispPrecMedia = storicoAnnoPrec['RISPARMIO_NETTO']?.media
  const investPrecTot = storicoAnnoPrec['TOTALE_INVESTIMENTI']?.totale
  const investPrecMedia = storicoAnnoPrec['TOTALE_INVESTIMENTI']?.media
  const pctRisparmioPrecTotale = entratePrecTot && entratePrecTot > 0 ? ((rispPrecTot ?? 0) / entratePrecTot) * 100 : null
  const pctRisparmioPrecMedia = entratePrecMedia && entratePrecMedia > 0 ? ((rispPrecMedia ?? 0) / entratePrecMedia) * 100 : null
  const pctInvestitoPrecTotale = rispPrecTot && rispPrecTot > 0 ? ((investPrecTot ?? 0) / rispPrecTot) * 100 : null
  const pctInvestitoPrecMedia = rispPrecMedia && rispPrecMedia > 0 ? ((investPrecMedia ?? 0) / rispPrecMedia) * 100 : null

  // Periodo coperto e numero di colonne della tabella per categoria
  const periodoCf = mesiPresenti.length > 1
    ? `${MESI_LABEL[mesiPresenti[0]]}–${MESI_LABEL[mesiPresenti[mesiPresenti.length - 1]]}`
    : mesiPresenti.length === 1 ? MESI_LABEL[mesiPresenti[0]] : '–'
  const cfColSpan = mesiPresenti.length + 5
  // Mini dettaglio "variazione media mensile vs anno precedente" (goodUp = se l'aumento è positivo)
  const miniVar = (att: number, prec: number | undefined, goodUp: boolean): MiniDef[] => {
    if (!prec) return []
    const v = ((att - prec) / Math.abs(prec)) * 100
    const up = v >= 0
    return [{ label: `Media vs ${anno - 1}`, value: `${up ? '+' : '−'}${Math.abs(v).toFixed(0)}%`, tone: up === goodUp ? 'positive' : 'negative' }]
  }

  const lineData = mesiPresenti.map((m, i) => ({
    mese: MESI_LABEL[m],
    Entrate: Math.round(cfTotIn[i]),
    Uscite: Math.round(cfTotOut[i]),
    Risparmio: Math.round(cfRisparmio[i]),
    Liquidità: Math.round(liquidita.filter(l => l.mese === m).reduce((s, l) => s + l.saldo, 0)) || undefined,
  }))

  const lineSeries: { key: string; color: string; dash?: boolean }[] = [
    { key: 'Entrate', color: BAR_COLORS.entrate },
    { key: 'Uscite', color: BAR_COLORS.uscite },
    { key: 'Risparmio', color: BAR_COLORS.risparmio, dash: true },
    ...(liquidita.length > 0 ? [{ key: 'Liquidità', color: BAR_COLORS.liquidita }] : []),
  ]

  const rawPieData = Object.entries(cfUscite)
    .map(([cat, vals]) => ({ name: cat, value: Math.round(Object.values(vals).reduce((a, b) => a + b, 0)) }))
    .filter(d => d.value > 0).sort((a, b) => b.value - a.value)
  const top5Pie = rawPieData.slice(0, 5)
  const otherValue = rawPieData.slice(5).reduce((s, d) => s + d.value, 0)
  const pieData = otherValue > 0 ? [...top5Pie, { name: 'Altre', value: otherValue }] : top5Pie
  const allUsciteCats = rawPieData.map(d => d.name)

  const rawPieDataEntrate = Object.entries(cfEntrate)
    .map(([cat, vals]) => ({ name: cat, value: Math.round(Object.values(vals).reduce((a, b) => a + b, 0)) }))
    .filter(d => d.value > 0).sort((a, b) => b.value - a.value)
  const top5PieEntrate = rawPieDataEntrate.slice(0, 5)
  const otherValueEntrate = rawPieDataEntrate.slice(5).reduce((s, d) => s + d.value, 0)
  const pieDataEntrate = otherValueEntrate > 0 ? [...top5PieEntrate, { name: 'Altre', value: otherValueEntrate }] : top5PieEntrate

  const barData = mesiPresenti.map((m) => {
    const row: Record<string, number | string> = { mese: MESI_LABEL[m] }
    allUsciteCats.forEach(cat => { row[cat] = 0 })
    const catsDelMese = allUsciteCats
      .map(cat => ({ cat, val: Math.round(cfUscite[cat]?.[m] ?? 0) }))
      .filter(d => d.val > 0)
      .sort((a, b) => b.val - a.val)
    catsDelMese.slice(0, 10).forEach(d => { row[d.cat] = d.val })
    row['Altro'] = catsDelMese.slice(10).reduce((s, d) => s + d.val, 0)
    return row
  })

  // Portafoglio
  const assetClasses = [...new Set(portafoglio.map(a => a.asset).filter(Boolean))]
  const valoreCaricoTotale = portafoglio.reduce((s, a) => { const { quantita, prezzoCarico } = statoAttuale(a); return s + prezzoCarico * quantita }, 0)
  const valoreAttualeTotale = portafoglio.reduce((s, a) => {
    const { quantita, prezzoCarico } = statoAttuale(a)
    const prezzoAtt = a.ticker && prezziAttuali[a.ticker] ? prezziAttuali[a.ticker].price : prezzoCarico
    return s + (prezzoAtt * quantita)
  }, 0)
  const plusminus = valoreAttualeTotale - valoreCaricoTotale
  const movimentiDaRiconciliare = movimenti.filter(m => m.categoria === 'INVESTIMENTI' && !m.riconciliato).length

  const usaValoreMonetario = valoreCaricoTotale > 0
  const piePortafoglio = assetClasses.map(cls => {
    const assetsInClass = portafoglio.filter(a => a.asset === cls)
    const valore = assetsInClass.reduce((s, a) => {
      const { quantita, prezzoCarico } = statoAttuale(a)
      const p = a.ticker && prezziAttuali[a.ticker] ? prezziAttuali[a.ticker].price : prezzoCarico
      return s + p * quantita
    }, 0)
    return {
      name: cls,
      value: usaValoreMonetario ? Math.round(valore) : assetsInClass.length,
    }
  }).filter(d => d.value > 0)

  if (loading) return <div className="flex items-center justify-center h-64 text-sm text-gray-400">Caricamento…</div>

  if (movimenti.length === 0) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p className="text-sm text-gray-500">Nessun dato per il {anno}.</p>
      <a href="/dashboard/upload" className="btn-primary text-sm">Importa dati</a>
    </div>
  )

  return (
    <div className="max-w-[1680px] mx-auto">
      {/* Sottomenu Gestione */}
      <div className="mb-4 overflow-x-auto">
        <SegmentedControl
          ariaLabel="Sezioni di Gestione" value={tab} onChange={setTab}
          options={[
            { value: 'movimenti', label: 'Movimenti conto' },
            { value: 'cashflow', label: 'Cash flow' },
            { value: 'portafoglio', label: 'Portafoglio' },
            { value: 'analisi', label: 'Analisi' },
          ]}
        />
      </div>

      {/* ===== MOVIMENTI ===== */}
      {tab === 'movimenti' && (
        <div className="flex flex-col gap-4 xl:h-[calc(100dvh-160px)]">
          {/* KPI: seguono i filtri attivi */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              variant="compact" label="Entrate" color="#3f6b4f" tone="positive" delta={null}
              value={`€ ${fmt(totalIn)}`}
              badge={<span className="inline-flex rounded-full bg-green-50 text-green-700 text-[11px] font-semibold px-2 py-0.5">{flussiPct(totalIn)}% dei flussi</span>}
              minis={entratePerComponente.length > 1 ? entratePerComponente.map(c => ({ label: c.componente, value: `€ ${fmt(c.val)}` })) : undefined}
            />
            <KpiCard
              variant="compact" label="Uscite" color="#c0504d" tone="negative" delta={null}
              value={`€ ${fmt(totalOut)}`}
              badge={<span className="inline-flex rounded-full bg-red-50 text-red-700 text-[11px] font-semibold px-2 py-0.5">{flussiPct(totalOut)}% dei flussi</span>}
              minis={uscitePerComponente.length > 1 ? uscitePerComponente.map(c => ({ label: c.componente, value: `€ ${fmt(c.val)}` })) : undefined}
            />
            <KpiCard
              variant="compact" label="Saldo" color={saldo >= 0 ? '#3f6b4f' : '#c0504d'} tone={saldo >= 0 ? 'positive' : 'negative'} delta={null}
              value={`${saldo < 0 ? '−' : ''}€ ${fmt(Math.abs(saldo))}`}
              badge={<span className={`inline-flex rounded-full text-[11px] font-semibold px-2 py-0.5 ${saldo >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>Saving rate {totalIn > 0 ? ((saldo / totalIn) * 100).toFixed(0) : 0}%</span>}
            />
            <KpiCard
              variant="compact" label={`Liquidità${ultimaLiquidita ? ` · ${MESI_LABEL[ultimaLiquidita.mese]}` : ''}`} color="#4a6fa1" delta={null}
              value={ultimaLiquidita ? fmtK(ultimaLiquidita.total) : '–'}
              badge={<span className="inline-flex rounded-full bg-surface-100 text-gray-500 text-[11px] font-medium px-2 py-0.5">Ultimo saldo</span>}
              minis={ultimaLiquidita && ultimaLiquidita.conti.length > 1 ? ultimaLiquidita.conti.map(c => ({ label: c.conto, value: fmtK(c.saldo) })) : undefined}
            />
          </div>

          {/* Barra filtri: ricerca + tipo + filtri avanzati (multi-selezione, includi/escludi) */}
          <div className="flex flex-wrap items-center gap-2">
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Cerca descrizione…" className="input flex-1 min-w-[180px] sm:max-w-xs text-sm py-1.5" />
            <SegmentedControl
              ariaLabel="Tipo di movimento" value={filterType}
              onChange={v => { setFilterType(v); setPage(1) }}
              options={[{ value: 'all', label: 'Tutti' }, { value: 'in', label: 'Entrate' }, { value: 'out', label: 'Uscite' }]}
            />
            <div className="relative">
              <button type="button" onClick={() => setShowFiltri(o => !o)}
                className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs">
                <IconSliders size={14} /> Filtri
                {filtriAttivi > 0 && <span className="rounded-full bg-brand-600 text-white text-[10px] font-semibold px-1.5 py-px">{filtriAttivi}</span>}
              </button>
              {showFiltri && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowFiltri(false)} />
                  <div className="z-50 card p-4 shadow-xl flex flex-col gap-4 panel-in overflow-y-auto
                                  max-sm:fixed max-sm:inset-x-3 max-sm:top-28 max-sm:max-h-[70vh]
                                  sm:absolute sm:left-0 sm:top-full sm:mt-2 sm:w-[420px] sm:max-h-[70vh]">
                    <FiltroGruppo
                      titolo="Categoria" opzioni={cats.map(c => ({ value: c, label: c }))}
                      selezionati={filtri.cat} escludi={escludi.cat}
                      onToggle={v => toggleFiltro('cat', v)}
                      onModo={x => { setEscludi(e => ({ ...e, cat: x })); setPage(1) }}
                      onReset={() => { setFiltri(f => ({ ...f, cat: [] })); setPage(1) }}
                    />
                    <FiltroGruppo
                      titolo="Mese" opzioni={MESI.map(m => ({ value: m, label: MESI_LABEL[m] }))}
                      selezionati={filtri.mese} escludi={escludi.mese}
                      onToggle={v => toggleFiltro('mese', v)}
                      onModo={x => { setEscludi(e => ({ ...e, mese: x })); setPage(1) }}
                      onReset={() => { setFiltri(f => ({ ...f, mese: [] })); setPage(1) }}
                    />
                    {componenti.length > 0 && (
                      <FiltroGruppo
                        titolo="Conto" opzioni={componenti.map(c => ({ value: c, label: c }))}
                        selezionati={filtri.conto} escludi={escludi.conto}
                        onToggle={v => toggleFiltro('conto', v)}
                        onModo={x => { setEscludi(e => ({ ...e, conto: x })); setPage(1) }}
                        onReset={() => { setFiltri(f => ({ ...f, conto: [] })); setPage(1) }}
                      />
                    )}
                    <div className="flex items-center justify-between pt-3 border-t border-surface-100">
                      <button type="button" onClick={azzeraFiltri} disabled={!qualcosaDaAzzerare}
                        className="text-xs font-medium text-brand-700 disabled:text-gray-300">Azzera filtri</button>
                      <button type="button" onClick={() => setShowFiltri(false)} className="btn-primary px-3 py-1.5 text-xs">Fatto</button>
                    </div>
                  </div>
                </>
              )}
            </div>
            {/* Riepilogo dei filtri attivi: un chip per gruppo, si toglie con un clic */}
            {(['cat', 'mese', 'conto'] as FiltroKey[]).filter(k => filtri[k].length > 0).map(k => {
              const nome = k === 'cat' ? 'Categoria' : k === 'mese' ? 'Mese' : 'Conto'
              const vals = filtri[k].map(v => k === 'mese' ? MESI_LABEL[v] : v).join(', ')
              return (
                <button key={k} type="button" onClick={() => { setFiltri(f => ({ ...f, [k]: [] })); setPage(1) }}
                  className={`inline-flex items-center gap-1 max-w-[280px] rounded-full text-[11px] font-medium px-2 py-1 ${
                    escludi[k] ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                  }`}>
                  <span className="truncate">{nome}: {escludi[k] ? 'tutti tranne ' : ''}{vals}</span>
                  <IconClose size={11} className="shrink-0" />
                </button>
              )
            })}
            {qualcosaDaAzzerare && (
              <button type="button" onClick={azzeraFiltri} className="text-xs font-medium text-gray-500 hover:text-gray-800 underline underline-offset-2">Azzera filtri</button>
            )}
            <span className="ml-auto text-xs text-gray-400">{filtered.length} movimenti</span>
          </div>

          {/* Tabella (desktop) / lista a card (smartphone) */}
          <div className="card p-0 overflow-hidden flex flex-col xl:flex-1 min-h-0">
            <div className="hidden sm:block overflow-auto flex-1 min-h-0">
              <table className="w-full min-w-[640px]">
                <thead className="sticky top-0 z-10">
                  <tr>
                    {([
                      { key: 'mese', label: 'Mese', w: 'w-16' },
                      { key: 'data_operazione', label: 'Data', w: 'w-24' },
                      { key: 'descrizione', label: 'Descrizione', w: '' },
                      { key: 'importo', label: 'Importo', w: 'w-32' },
                      { key: 'categoria', label: 'Categoria', w: 'w-40' },
                      ...(componenti.length > 0 ? [{ key: 'componente', label: 'Conto', w: 'w-24' }] : []),
                    ] as { key: SortKey; label: string; w: string }[]).map(col => (
                      <th key={col.key} onClick={() => toggleSort(col.key)}
                        className={`table-th cursor-pointer select-none hover:bg-surface-100 ${col.w} ${col.key === 'importo' ? 'text-right' : ''}`}>
                        {col.label}<SortIcon active={sortKey === col.key} dir={sortDir} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageData.map((m, i) => {
                    const isIn = m.entrate > 0
                    const amt = isIn ? m.entrate : m.uscite
                    return (
                      <tr key={i} onClick={() => setSelectedMov(m)} className="cursor-pointer hover:bg-surface-50 transition-colors">
                        <td className="table-td text-gray-400 text-xs">{m.mese}</td>
                        <td className="table-td text-gray-400 text-xs">{m.data_operazione}</td>
                        <td className="table-td max-w-xs"><span className="block truncate text-sm" title={m.descrizione}>{m.descrizione}</span></td>
                        <td className={`table-td text-right text-sm font-medium font-mono tabular-nums ${isIn ? 'text-green-700' : 'text-red-600'}`}>
                          {isIn ? '+' : '−'} € {fmt(amt)}
                        </td>
                        <td className="table-td"><span className="text-xs bg-surface-100 text-gray-600 px-2 py-0.5 rounded-full">{m.categoria}</span></td>
                        {componenti.length > 0 && <td className="table-td text-xs text-gray-400">{m.componente}</td>}
                      </tr>
                    )
                  })}
                  {pageData.length === 0 && <tr><td colSpan={6} className="table-td text-center text-gray-400 py-8">Nessun risultato</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="sm:hidden divide-y divide-surface-100">
              {pageData.map((m, i) => {
                const isIn = m.entrate > 0
                return (
                  <button key={i} type="button" onClick={() => setSelectedMov(m)} className="w-full text-left px-4 py-3 flex items-start justify-between gap-3 active:bg-surface-50">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 truncate">{m.descrizione}</p>
                      <p className="mt-1 text-[11px] text-gray-400">{m.data_operazione} · <span className="bg-surface-100 text-gray-600 px-1.5 py-px rounded-full">{m.categoria}</span></p>
                    </div>
                    <span className={`shrink-0 text-sm font-semibold font-mono tabular-nums ${isIn ? 'text-green-700' : 'text-red-600'}`}>
                      {isIn ? '+' : '−'}€ {fmt(isIn ? m.entrate : m.uscite)}
                    </span>
                  </button>
                )
              })}
              {pageData.length === 0 && <p className="text-center text-sm text-gray-400 py-8">Nessun risultato</p>}
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-surface-100 shrink-0">
              <span className="text-xs text-gray-400">{sorted.length} righe</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary px-2 py-1 text-xs disabled:opacity-30">←</button>
                <span className="text-xs text-gray-600">Pag. {page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-secondary px-2 py-1 text-xs disabled:opacity-30">→</button>
              </div>
            </div>
          </div>

          {/* Dettaglio movimento (sola lettura) */}
          <Drawer
            open={!!selectedMov} onClose={() => setSelectedMov(null)} variant="center"
            title="Dettaglio movimento" subtitle={selectedMov ? `${selectedMov.data_operazione} · ${selectedMov.mese} ${anno}` : undefined}
          >
            {selectedMov && (() => {
              const m = selectedMov
              const isIn = m.entrate > 0
              const righe: [string, string | undefined][] = [
                ['Categoria', m.categoria], ['Sottocategoria', m.sottocategoria || undefined],
                ['Conto', m.componente || undefined], ['ETF / strumento', m.nome_etf || undefined],
                ['Riconciliato', m.categoria === 'INVESTIMENTI' ? (m.riconciliato ? 'Sì' : 'No') : undefined],
              ]
              return (
                <div>
                  <p className={`num-display text-3xl font-semibold ${isIn ? 'text-green-700' : 'text-red-600'}`}>
                    {isIn ? '+' : '−'} € {fmt(isIn ? m.entrate : m.uscite)}
                  </p>
                  <p className="mt-2 text-sm text-gray-700 leading-snug">{m.descrizione}</p>
                  <dl className="mt-5 border-t border-surface-100">
                    {righe.filter(([, v]) => v).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-4 py-2.5 border-b border-surface-100">
                        <dt className="text-xs text-gray-500">{k}</dt>
                        <dd className="text-sm font-medium text-gray-800 text-right">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )
            })()}
          </Drawer>
        </div>
      )}

      {/* ===== CASH FLOW ===== */}
      {tab === 'cashflow' && (
        <div className="flex flex-col gap-4">
          {/* KPI dell'anno */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              variant="compact" label="Entrate" color="#3f6b4f" tone="positive" delta={null}
              value={fmtK(ytdIn)}
              badge={<span className="inline-flex rounded-full bg-surface-100 text-gray-500 text-[11px] font-medium px-2 py-0.5">{periodoCf}</span>}
              minis={[{ label: 'Media mensile', value: fmtK(mediaEntrateMensili) }, ...miniVar(mediaEntrateMensili, entratePrecMedia, true)]}
            />
            <KpiCard
              variant="compact" label="Uscite" color="#c0504d" tone="negative" delta={null}
              value={fmtK(ytdOut)}
              badge={<span className="inline-flex rounded-full bg-surface-100 text-gray-500 text-[11px] font-medium px-2 py-0.5">{periodoCf}</span>}
              minis={[{ label: 'Media mensile', value: fmtK(mediaUsciteMensili) }, ...miniVar(mediaUsciteMensili, storicoAnnoPrec['TOTALE_USCITE']?.media, false)]}
            />
            <KpiCard
              variant="compact" label="Investimenti" color="#4a6fa1" delta={null}
              value={fmtK(ytdInv)}
              badge={<span className="inline-flex rounded-full bg-blue-50 text-blue-700 text-[11px] font-semibold px-2 py-0.5">{pctInvestitoSuEntrate.toFixed(0)}% delle entrate</span>}
              minis={[{ label: 'Media mensile', value: fmtK(ytdInv / nMesi) }, ...miniVar(ytdInv / nMesi, investPrecMedia, true)]}
            />
            <KpiCard
              variant="compact" label="Risparmio netto" color={ytdRisp >= 0 ? '#3f6b4f' : '#c0504d'} tone={ytdRisp >= 0 ? 'positive' : 'negative'} delta={null}
              value={fmtK(ytdRisp)}
              badge={<span className={`inline-flex rounded-full text-[11px] font-semibold px-2 py-0.5 ${ytdRisp >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>Saving rate {savingRate.toFixed(0)}%</span>}
              minis={[{ label: 'Media mensile', value: fmtK(ytdRisp / nMesi) }, ...miniVar(ytdRisp / nMesi, rispPrecMedia, true)]}
            />
          </div>

          {/* Tabella mensile a tutta larghezza: Riepilogo | Per categoria */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 pt-4 pb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="num-display text-sm font-semibold text-gray-900">Cash flow mensile</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {showHeatmap ? 'Per categoria · colore più intenso = voce più pesante rispetto alla sua media' : 'Totali e tasso di risparmio'} · Var. = variazione rispetto al {anno - 1} (valore al passaggio del mouse)
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl
                  ariaLabel="Vista della tabella" value={showHeatmap ? 'categorie' : 'riepilogo'}
                  onChange={v => setShowHeatmap(v === 'categorie')}
                  options={[{ value: 'riepilogo', label: 'Riepilogo' }, { value: 'categorie', label: 'Per categoria' }]}
                />
              </div>
            </div>
            <div className="overflow-x-auto border-t border-surface-100">
              <table className="w-full text-xs border-collapse">
                <CfHead prima={showHeatmap ? 'Voce / categoria' : 'Voce'} mesi={mesiPresenti} />
                <tbody>
                  {!showHeatmap ? (
                    <>
                      <CfTotRow label="Totale entrate" tone="green" prec={storicoAnnoPrec['TOTALE_ENTRATE']} valori={cfTotIn} totale={ytdIn} media={mediaEntrateMensili} anno={anno} />
                      <CfTotRow label="Totale uscite" tone="red" prec={storicoAnnoPrec['TOTALE_USCITE']} valori={cfTotOut} totale={ytdOut} media={mediaUsciteMensili} anno={anno} />
                      {invTotals.length > 0 && (
                        <CfTotRow label="Totale investimenti" tone="blue" prec={storicoAnnoPrec['TOTALE_INVESTIMENTI']} valori={cfTotInv} totale={ytdInv} media={ytdInv / nMesi} anno={anno} />
                      )}
                      <CfTotRow label="Risparmio netto" tone="risp" prec={storicoAnnoPrec['RISPARMIO_NETTO']} valori={cfRisparmio} totale={ytdRisp} media={ytdRisp / nMesi} anno={anno} />
                      <CfPctRow label="% risparmio del mese" precMedia={pctRisparmioPrecMedia} precTot={pctRisparmioPrecTotale}
                        valori={pctRisparmioMensile} totale={savingRate} media={pctRisparmioMediaMensile} anno={anno} colora />
                      <CfPctRow label="% risparmio investito" precMedia={pctInvestitoPrecMedia} precTot={pctInvestitoPrecTotale}
                        valori={pctInvestitoMensile} totale={ytdRisp > 0 ? (ytdInv / ytdRisp) * 100 : null} media={pctInvestitoMediaMensile} anno={anno} colora={false} />
                    </>
                  ) : (
                    <>
                      <CfSezione label="Entrate" color="#3f6b4f" colSpan={cfColSpan} />
                      {entrateTotals.map(({ cat, total }) => (
                        <CfCatRow key={cat} cat={cat} vals={cfEntrate[cat]} mesi={mesiPresenti} total={total} totaliColonna={entrateTotals.map(e => e.total)}
                          nMesi={nMesi} prec={storicoAnnoPrec[cat]} palette="green" anno={anno} />
                      ))}
                      <CfSezione label="Uscite" color="#c0504d" colSpan={cfColSpan} />
                      {usciteTotals.map(({ cat, total }) => (
                        <CfCatRow key={cat} cat={cat} vals={cfUscite[cat]} mesi={mesiPresenti} total={total} totaliColonna={usciteTotals.map(u => u.total)}
                          nMesi={nMesi} prec={storicoAnnoPrec[cat]} palette="red" anno={anno} />
                      ))}
                      {invTotals.length > 0 && <>
                        <CfSezione label="Investimenti" color="#4a6fa1" colSpan={cfColSpan} />
                        {invTotals.map(({ cat, total }) => (
                          <CfCatRow key={cat} cat={cat} vals={cfInv[cat]} mesi={mesiPresenti} total={total} totaliColonna={invTotals.map(v => v.total)}
                            nMesi={nMesi} prec={storicoAnnoPrec[cat]} palette="blue" anno={anno} />
                        ))}
                      </>}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Grafici in un'unica card, uno alla volta */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 pt-4 pb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="num-display text-sm font-semibold text-gray-900">
                  {cfGrafico === 'andamento' ? 'Andamento mensile' : cfGrafico === 'spese' ? 'Spese per categoria' : 'Distribuzione YTD'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {cfGrafico === 'andamento' ? 'Entrate, uscite e risparmio nel tempo' : cfGrafico === 'spese' ? 'Confronto mensile per categoria di spesa' : 'Da dove arrivano le entrate e dove vanno le uscite'}
                </p>
              </div>
              <SegmentedControl
                ariaLabel="Grafico" value={cfGrafico} onChange={setCfGrafico}
                options={[{ value: 'andamento', label: 'Andamento' }, { value: 'spese', label: 'Spese' }, { value: 'distribuzione', label: 'Distribuzione' }]}
              />
            </div>
            <div className="px-4 pb-4 border-t border-surface-100 pt-4">
              {cfGrafico === 'andamento' && (
                <>
                  <div className="flex flex-wrap items-center gap-4 mb-3">
                    {lineSeries.map(s => (
                      <span key={s.key} className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
                        <span className="w-2.5 h-2.5 inline-block rounded-sm" style={{ backgroundColor: s.color }} />{s.key}
                      </span>
                    ))}
                  </div>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={lineData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }} barGap={2} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" vertical={false} />
                      <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number) => fmtK(v)} wrapperStyle={{ zIndex: 50 }} />
                      {lineSeries.map(s => <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[4, 4, 0, 0]} />)}
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
              {cfGrafico === 'spese' && (
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={barData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }} barGap={2} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" vertical={false} />
                    <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => fmtShort(v)} />
                    <Tooltip content={<SpeseCategoriaTooltip />} wrapperStyle={{ zIndex: 50 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {allUsciteCats.map((cat, i) => (
                      <Bar key={cat} dataKey={cat} fill={BAR_COLORS.categorie[i % BAR_COLORS.categorie.length]} radius={[4, 4, 0, 0]} />
                    ))}
                    <Bar key="Altro" dataKey="Altro" fill={BAR_COLORS.altro} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
              {cfGrafico === 'distribuzione' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <DonutDistribuzione titolo="Entrate" sottotitolo="Provenienza per categoria" data={pieDataEntrate} shades={GREEN_SHADES} totale={ytdIn} />
                  <DonutDistribuzione titolo="Uscite" sottotitolo="Spesa per categoria" data={pieData} shades={RED_SHADES} totale={ytdOut} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== ANALISI PORTAFOGLIO (look-through) ===== */}
      {tab === 'analisi' && (
        <AnalisiPortafoglio
          portafoglio={portafoglio}
          prezziAttuali={prezziAttuali}
          liquidita={ultimaLiquidita?.total ?? 0}
          prefill={simPrefill}
          onPrefillConsumed={() => setSimPrefill(null)}
        />
      )}

      {/* ===== PORTAFOGLIO ===== */}
      {tab === 'portafoglio' && (
        <div className="flex flex-col gap-4">
          {movimentiDaRiconciliare > 0 && (
            <a
              href="/dashboard/riconciliazione"
              className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100 transition-colors"
            >
              <span className="text-sm text-amber-800">
                <strong>{movimentiDaRiconciliare}</strong> movimento/i ETF da riconciliare con il portafoglio
              </span>
              <span className="text-xs font-medium text-amber-700">Vai alla riconciliazione →</span>
            </a>
          )}
          {portafoglio.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <p className="text-sm text-gray-500">Nessun asset nel portafoglio.</p>
              <p className="text-xs text-gray-400">
                {`Compila il foglio "Anagrafica Portafoglio" e risincronizza.`}
              </p>
            </div>
          ) : (
            <>
              {/* Banner soglie superate */}
              {(() => {
                const breaches = soglie.filter(s => s.in_breach)
                if (breaches.length === 0 || bannerDismissed) return null
                return (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 relative">
                    <button
                      onClick={() => setBannerDismissed(true)}
                      aria-label="Chiudi avviso"
                      className="absolute top-3 right-3 text-red-400 hover:text-red-600 text-sm leading-none"
                    >
                      ✕
                    </button>
                    <p className="text-sm font-semibold text-red-700 mb-2 pr-6">⚠ {breaches.length} soglia/e superata/e</p>
                    <ul className="space-y-1">
                      {breaches.map(s => {
                        const asset = portafoglio.find(a => a.id === s.portafoglio_id)
                        const quote = asset?.ticker ? prezziAttuali[asset.ticker] : undefined
                        const dev = s.tipo === 'storico' ? quote?.changeFromHigh : quote?.changeFromMonth
                        return (
                          <li key={s.id} className="text-xs text-red-700">
                            <strong>{asset?.nome || asset?.descrizione || asset?.ticker}</strong>
                            {' — '}{s.tipo === 'storico' ? 'dal massimo' : 'nel mese'}: {dev != null ? `${dev.toFixed(1)}%` : '–'} (soglia {s.soglia_pct}%)
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })()}

              {/* Banner promemoria: mese concluso non ancora registrato */}
              {(() => {
                const { mese: meseTarget, anno: annoTarget } = meseDaRegistrare()
                const registrato = annoTarget === anno && portafoglioStorico.some(r => r.mese === meseTarget)
                if (registrato || bannerChiusuraDismissed) return null
                return (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 relative flex items-center justify-between gap-3 flex-wrap">
                    <button
                      onClick={() => setBannerChiusuraDismissed(true)}
                      aria-label="Chiudi avviso"
                      className="absolute top-3 right-3 text-amber-400 hover:text-amber-600 text-sm leading-none"
                    >
                      ✕
                    </button>
                    <span className="text-sm text-amber-800 pr-6">
                      📅 Il mese di <strong>{MESI_LABEL[meseTarget]}</strong> {annoTarget !== anno ? annoTarget : ''} è concluso ma non ancora registrato: lo storico prezzi non sarà valorizzato correttamente finché non lo registri.
                    </span>
                    <button
                      onClick={() => setOpenSection(prev => ({ ...prev, storico: true }))}
                      className="text-xs font-medium text-amber-700 underline shrink-0"
                    >
                      Vai a Storico prezzi →
                    </button>
                  </div>
                )
              })()}

              {/* Strumenti: pannelli laterali (Piano di accumulo, Storico prezzi, Alert) */}
              {(() => {
                const { mese: meseTarget, anno: annoTarget } = meseDaRegistrare()
                const chiusuraMancante = !(annoTarget === anno && portafoglioStorico.some(r => r.mese === meseTarget))
                const sectionBtns: { key: keyof typeof openSection; label: string; badge?: boolean }[] = [
                  { key: 'riserva', label: 'Piano di accumulo' },
                  { key: 'storico', label: 'Storico prezzi', badge: chiusuraMancante },
                  { key: 'alert', label: 'Dettaglio alert', badge: alertNuovo },
                ]
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    {sectionBtns.map(b => (
                      <button key={b.key} type="button" onClick={() => toggleSection(b.key)}
                        className="relative btn-secondary px-3 py-1.5 text-xs">
                        {b.label}
                        {b.badge && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-white" />}
                      </button>
                    ))}
                  </div>
                )
              })()}

              {/* KPI */}
              {(() => {
                const hasPrezzi = Object.keys(prezziAttuali).length > 0
                const pctPlusMinus = valoreCaricoTotale > 0 ? (plusminus / valoreCaricoTotale) * 100 : 0
                const pill = (txt: string, cls: string) => <span className={`inline-flex rounded-full text-[11px] font-semibold px-2 py-0.5 ${cls}`}>{txt}</span>
                return (
                  <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
                    <KpiCard variant="compact" label="Valore di carico" color="#4a6fa1" delta={null}
                      value={fmtK(valoreCaricoTotale)} badge={pill(`${portafoglio.length} asset`, 'bg-blue-50 text-blue-700')} />
                    <KpiCard variant="compact" label="Valore attuale" color="#3f6b4f" delta={null}
                      value={hasPrezzi ? fmtK(valoreAttualeTotale) : '–'}
                      badge={pill(hasPrezzi ? `${pctPlusMinus >= 0 ? '+' : ''}${pctPlusMinus.toFixed(1)}% vs carico` : 'In attesa di quotazioni', 'bg-surface-100 text-gray-600')} />
                    <KpiCard variant="compact" label="Plus/Minus latente"
                      color={!hasPrezzi ? '#9ca3af' : plusminus >= 0 ? '#3f6b4f' : '#c0504d'}
                      tone={!hasPrezzi ? 'neutral' : plusminus >= 0 ? 'positive' : 'negative'} delta={null}
                      value={hasPrezzi ? fmtK(plusminus) : '–'}
                      badge={pill(hasPrezzi ? `${pctPlusMinus >= 0 ? '+' : ''}${pctPlusMinus.toFixed(1)}% sul capitale` : 'Nessuna quotazione',
                        !hasPrezzi ? 'bg-surface-100 text-gray-600' : plusminus >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600')} />
                    <KpiCard variant="compact" label="Asset" color="#6b7280" delta={null}
                      value={portafoglio.length.toString()} badge={pill(`${assetClasses.length || 1} asset class`, 'bg-surface-100 text-gray-600')}
                      minis={allocazioneClasse.length > 1 ? allocazioneClasse.map(d => ({ label: d.name, value: fmtK(d.value) })) : undefined} />
                  </div>
                )
              })()}

              {/* Grafici allocazione portafoglio — i 3 sulla stessa riga */}
              {assetValori.length > 0 && (
                <div className="card p-4">
                  <p className="num-display text-sm font-semibold text-gray-900 mb-3">Allocazione portafoglio</p>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Per classe di rischio</p>
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie
                            data={allocazioneClasse}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={50}
                            outerRadius={80}
                            paddingAngle={2}
                          >
                            {allocazioneClasse.map((d, i) => (
                              <Cell key={i} fill={d.color} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number) => fmtK(v)} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Peso % per asset</p>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={pesoAsset} layout="vertical" margin={{ left: 8, right: 16 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e4e7d8" />
                          <XAxis type="number" tickFormatter={v => `${v.toFixed(0)}%`} fontSize={10} />
                          <YAxis type="category" dataKey="nome" width={90} fontSize={10}
                            tickFormatter={v => (v.length > 14 ? v.slice(0, 14) + '…' : v)} />
                          <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                          <Bar dataKey="peso" radius={[0, 4, 4, 0]}>
                            {pesoAsset.map((d, i) => (
                              <Cell key={i} fill={CLASSE_COLOR[d.classe]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Per categoria</p>
                      {!usaValoreMonetario && (
                        <p className="text-[10px] text-gray-400 mb-1">Conteggio per numero di asset</p>
                      )}
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={piePortafoglio} dataKey="value" nameKey="name" cx="50%" cy="45%"
                            outerRadius={65} innerRadius={32}
                            label={({ percent }) => percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ''} labelLine={false}>
                            {piePortafoglio.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v: number) => usaValoreMonetario ? fmtK(v) : `${v} asset`} />
                          <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}


              {/* Banner: asset con data acquisto più avanti dei dati mensili caricati.
                  Non è un errore — il capitale investito si aggiornerà da solo appena
                  liquidità/movimenti raggiungono quel mese. */}
              {(() => {
                const mesiConDati = new Set([...movimenti.map(m => m.mese), ...liquidita.map(l => l.mese)])
                const ultimoMeseConDati = MESI.filter(m => mesiConDati.has(m)).pop()
                if (!ultimoMeseConDati) return null
                const chiaveUltimo = anno * 12 + MESI.indexOf(ultimoMeseConDati)
                const assetInAnticipo = portafoglio.filter(a => {
                  const d = parseDataIt(a.data_acquisto)
                  if (!d) return false
                  const chiaveAcquisto = d.getFullYear() * 12 + d.getMonth()
                  return chiaveAcquisto > chiaveUltimo
                })
                if (assetInAnticipo.length === 0) return null
                return (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                    <strong>{assetInAnticipo.length} asset</strong> {assetInAnticipo.length === 1 ? 'ha' : 'hanno'} una data di acquisto ({assetInAnticipo.map(a => a.nome || a.asset).join(', ')}) successiva
                    all&apos;ultimo mese con dati di liquidità/movimenti caricati ({ultimoMeseConDati}). Il capitale investito nel grafico &quot;Andamento patrimonio&quot; si aggiornerà
                    automaticamente non appena sincronizzi i mesi successivi.
                  </div>
                )
              })()}

              {/* Tabella asset con gestione soglie integrata */}
              <div className="card p-0 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-3">
                  <div className="flex items-center gap-3">
                    <p className="num-display text-sm font-semibold text-gray-900">Anagrafica portafoglio</p>
                    <InfoSoglieModal />
                    <button onClick={fetchPrezziAttuali} disabled={loadingPrezzi} className="btn-secondary text-xs px-2.5 py-1">
                      {loadingPrezzi ? '⟳ Caricamento…' : '↻ Aggiorna prezzi'}
                    </button>
                    {Object.keys(prezziAttuali).length > 0 && (
                      <span className="text-xs text-green-600">✓ {Object.keys(prezziAttuali).length} aggiornati</span>
                    )}
                  </div>
                  {!showSoglieForm ? (
                    <button onClick={() => setShowSoglieForm(true)} className="text-xs text-brand-600 font-medium">
                      ✎ Modifica soglie
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button onClick={() => setShowSoglieForm(false)} className="text-xs text-gray-400 font-medium">
                        Annulla
                      </button>
                      <button onClick={async () => { await saveSoglie(); setShowSoglieForm(false) }} disabled={savingSoglie} className="btn-primary text-xs">
                        {savingSoglie ? 'Salvataggio…' : 'Salva soglie'}
                      </button>
                    </div>
                  )}
                </div>

                {showSoglieForm && (
                  <div className="mx-4 mt-3 flex flex-wrap items-end gap-3 p-3 bg-surface-50 rounded-lg">
                    <p className="text-[10px] text-gray-400 w-full">
                      Notifica in app quando lo scostamento dal massimo o dal mese scende sotto la soglia (es. 10% → notifica a -10% o peggio). Le percentuali si intendono sempre come ribasso. Sono solo notifiche: gli importi da investire sui ribassi si configurano nel Piano di accumulo (bottone sopra i KPI). Per gli asset nel piano la soglia dal massimo è sostituita dalle sue tranche (colonna Max % = Piano); resta la soglia mensile, che è solo un avviso.
                    </p>
                    <div>
                      <label className="text-[10px] text-gray-400 block mb-1">Soglia da massimo (%)</label>
                      <input type="number" min={0} step={0.5} value={globalSogliaMax}
                        onChange={e => setGlobalSogliaMax(Number(e.target.value))} className="input w-24 text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 block mb-1">Soglia mensile (%)</label>
                      <input type="number" min={0} step={0.5} value={globalSogliaMese}
                        onChange={e => setGlobalSogliaMese(Number(e.target.value))} className="input w-24 text-sm" />
                    </div>
                    <button onClick={applicaSoglieATutti} className="btn-secondary text-xs">Applica a tutti gli asset</button>
                  </div>
                )}

                <div className="overflow-x-auto border-t border-surface-100 mt-3">
                  <table className="w-full min-w-[640px]">
                    <thead>
                      <tr>
                        <th className="table-th">Asset</th>
                        <th className="table-th">Nome / Ticker</th>
                        <th className="table-th w-20 text-right">Qtà</th>
                        <th className="table-th w-24 text-center">Da massimo</th>
                        <th className="table-th w-24 text-center">Var. mese</th>
                        <th className="table-th w-28 text-right">Valore carico</th>
                        <th className="table-th w-28 text-right">Valore att.</th>
                        <th className="table-th w-24 text-right">+/–</th>
                        <th className="table-th w-28 text-center">Classe</th>
                        <th className="table-th w-24 text-center">Svincolato</th>
                        <th className="table-th w-14 px-1 text-center bg-amber-50/60" title="Soglia di scostamento dal massimo storico — modificabile dall'app">Max %</th>
                        <th className="table-th w-14 px-1 text-center bg-amber-50/60" title="Soglia di scostamento dal massimo mensile — modificabile dall'app">Mese %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portafoglio.map((a, i) => {
                        const { quantita: qtaAttuale, prezzoCarico } = statoAttuale(a)
                        const quote = a.ticker ? prezziAttuali[a.ticker] : undefined
                        const prezzoAtt = quote ? quote.price : null
                        const valCarico = prezzoCarico * qtaAttuale
                        const valAtt = prezzoAtt ? prezzoAtt * qtaAttuale : null
                        const pm = valAtt ? valAtt - valCarico : null
                        const breachAsset = soglie.filter(x => x.in_breach && x.portafoglio_id === a.id)
                        const inBreach = breachAsset.length > 0
                        const pmPct = pm && valCarico > 0 ? (pm / valCarico * 100).toFixed(1) : null
                        const highDev = quote?.changeFromHigh ?? null
                        const highT = highDev != null ? Math.min(Math.abs(highDev) / HIGH_DEVIATION_SCALE_MAX, 1) : 0
                        const highBg = highDev != null ? interpolateColor(HEAT_COLORS.amber.light, HEAT_COLORS.amber.dark, highT) : undefined
                        const highText = highDev != null ? (highT > 0.5 ? HEAT_COLORS.amber.textDark : HEAT_COLORS.amber.textLight) : undefined
                        const dSoglia = a.id ? draftSoglie[a.id] : undefined
                        const sMaxSaved = a.id ? soglie.find(s => s.portafoglio_id === a.id && s.tipo === 'storico') : undefined
                        const sMeseSaved = a.id ? soglie.find(s => s.portafoglio_id === a.id && s.tipo === 'mensile') : undefined
                        return (
                          <tr key={i} className={`transition-colors ${inBreach ? 'bg-red-50/70 shadow-[inset_3px_0_0_0_#dc2626]' : 'hover:bg-surface-50'}`}>
                            <td className="table-td"><span className="text-xs bg-surface-100 text-gray-600 px-2 py-0.5 rounded-full">{a.asset}</span>{inBreach && <span title={breachAsset.map(x => `${x.tipo === 'mensile' ? 'nel mese' : 'dal massimo'} (soglia ${x.soglia_pct}%)`).join(', ')} className="ml-1.5 text-[10px] font-medium text-red-700 bg-red-100 px-1.5 py-0.5 rounded-full">soglia</span>}</td>
                            <td className="table-td">
                              <p
                                className={`text-xs font-medium text-gray-700 cursor-pointer hover:text-brand-600 ${expandedAssetRow === i ? 'whitespace-normal break-words' : 'truncate max-w-36'}`}
                                title={a.nome || a.descrizione}
                                onClick={() => setExpandedAssetRow(expandedAssetRow === i ? null : i)}
                              >
                                {a.nome || a.descrizione}
                              </p>
                              {(a.ticker || a.isin) && <p className="text-[11px] text-gray-400 font-mono">{[a.ticker, a.isin].filter(Boolean).join(' · ')}</p>}
                            </td>
                            <td className="table-td text-right text-xs tabular-nums">{qtaAttuale.toLocaleString('it-IT', { maximumFractionDigits: 4 })}</td>
                            <td className="table-td text-center">
                              {quote?.changeFromHigh != null ? (
                                <span
                                  className="inline-block min-w-16 px-2 py-1 rounded-md text-xs font-semibold tabular-nums transition-transform hover:scale-105"
                                  style={{ backgroundColor: highBg, color: highText }}
                                  title="Variazione dal massimo a 52 settimane"
                                >
                                  {quote.changeFromHigh.toFixed(1)}%
                                </span>
                              ) : <span className="text-gray-300 text-xs">–</span>}
                            </td>
                            <td className="table-td text-center">
                              {quote?.changeFromMonth != null ? (
                                <span
                                  className={`inline-flex items-center gap-0.5 px-2 py-1 rounded-md text-xs font-medium tabular-nums ${quote.changeFromMonth >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}
                                  title="Variazione rispetto a circa 30 giorni fa"
                                >
                                  {quote.changeFromMonth >= 0 ? '▲' : '▼'} {Math.abs(quote.changeFromMonth).toFixed(1)}%
                                </span>
                              ) : <span className="text-gray-300 text-xs">–</span>}
                            </td>
                            <td className="table-td text-right text-xs font-medium tabular-nums">{fmtK(valCarico)}</td>
                            <td className="table-td text-right text-xs font-medium tabular-nums">
                              {valAtt ? fmtK(valAtt) : <span className="text-gray-300">–</span>}
                            </td>
                            <td className={`table-td text-right text-xs font-medium tabular-nums ${pm ? (pm >= 0 ? 'text-green-700' : 'text-red-600') : ''}`}>
                              {pm ? `${pm >= 0 ? '+' : ''}${fmtK(pm)} (${pmPct}%)` : <span className="text-gray-300">–</span>}
                            </td>
                            <td className="table-td text-center px-1">
                              {a.classe_rischio ? (
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CLASSE_BADGE[a.classe_rischio]}`}>
                                  {CLASSE_LABEL[a.classe_rischio]}
                                </span>
                              ) : <span className="text-gray-300 text-xs">–</span>}
                            </td>
                            <td className="table-td text-center">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                a.svincolato ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500'
                              }`}>
                                {a.svincolato ? 'Sì' : 'No'}
                              </span>
                            </td>
                            <td className="table-td text-center px-1 bg-amber-50/40">
                              {a.id && idPiano.has(a.id) ? (
                                <span className="inline-block px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700 ring-1 ring-brand-100 text-[10px] font-medium whitespace-nowrap" title="La soglia dal massimo è gestita dalle tranche del Piano di accumulo">Piano</span>
                              ) : showSoglieForm && a.id ? (
                                <div className="flex items-center justify-center gap-1">
                                  <input type="number" min={0} step={0.5}
                                    value={dSoglia?.massimo ?? globalSogliaMax}
                                    onChange={e => setDraftSoglie(prev => ({ ...prev, [a.id!]: { ...(prev[a.id!] ?? { massimo: globalSogliaMax, mensile: globalSogliaMese, attivo: true, accumulo: true }), massimo: Number(e.target.value) } }))}
                                    className="w-11 border border-surface-200 rounded-md px-1 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
                                  <input type="checkbox" title="Soglia attiva" checked={dSoglia?.attivo ?? true}
                                    onChange={e => setDraftSoglie(prev => ({ ...prev, [a.id!]: { ...(prev[a.id!] ?? { massimo: globalSogliaMax, mensile: globalSogliaMese, attivo: true, accumulo: true }), attivo: e.target.checked } }))} />
                                </div>
                              ) : (
                                <span className="text-xs tabular-nums text-gray-500">
                                  {sMaxSaved && sMaxSaved.attivo ? `${sMaxSaved.soglia_pct}%` : <span className="text-gray-300">–</span>}
                                </span>
                              )}
                            </td>
                            <td className="table-td text-center px-1 bg-amber-50/40">
                              {showSoglieForm && a.id ? (
                                <input type="number" min={0} step={0.5}
                                  value={dSoglia?.mensile ?? globalSogliaMese}
                                  onChange={e => setDraftSoglie(prev => ({ ...prev, [a.id!]: { ...(prev[a.id!] ?? { massimo: globalSogliaMax, mensile: globalSogliaMese, attivo: true, accumulo: true }), mensile: Number(e.target.value) } }))}
                                  className="w-11 border border-surface-200 rounded-md px-1 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
                              ) : (
                                <span className="text-xs tabular-nums text-gray-500">
                                  {sMeseSaved && sMeseSaved.attivo ? `${sMeseSaved.soglia_pct}%` : <span className="text-gray-300">–</span>}
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pannelli laterali */}
              <Drawer open={openSection.riserva} onClose={closeSections} size="xl" closeOnBlankClick={false}
                title="Piano di accumulo" subtitle="Riserva, soglie e importi">
              {/* Sezione aperta (riserva o simulatore) */}
              {openSection.riserva && (
                <PianoAccumulo
                  portafoglio={portafoglio}
                  liquidita={liquidita}
                  prezziAttuali={prezziAttuali}
                  behaviorLabel={profilo?.behavior_label ?? null}
                  pmcMaxAumento={profilo?.pmc_max_aumento_pct ?? null}
                  bonusSottoPmc={profilo?.accumulo_bonus_pmc ?? null}
                  moltMax={profilo?.accumulo_molt_max ?? null}
                  onSaved={loadData}
                  onSimula={(assetId, importo) => { closeSections(); setSimPrefill({ nonce: Date.now(), strumentoId: assetId, importo }); setTab('analisi') }}
                  onAggiornaPrezzi={fetchPrezziAttuali}
                  loadingPrezzi={loadingPrezzi}
                />
              )}

              </Drawer>
              <Drawer open={openSection.storico} onClose={closeSections} size="xl"
                title={`Storico prezzi ${anno}`} subtitle="Prezzi mensili e chiusura del mese">
              {openSection.storico && <div className="overflow-x-auto">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <p className="text-xs text-gray-400 pt-1">
                    Prezzi a fine mese · colore = variazione % rispetto al mese precedente
                  </p>
                  {(() => {
                    const { mese: meseTarget, anno: annoTarget } = meseDaRegistrare()
                    const registrato = annoTarget === anno && portafoglioStorico.some(r => r.mese === meseTarget)
                    return (
                      <div className={`rounded-lg px-3 py-2 flex items-center gap-3 flex-wrap ${registrato ? 'bg-surface-50' : 'bg-amber-50 border border-amber-200'}`}>
                        <span className="text-xs text-gray-600">
                          📅 Chiusura <strong>{MESI_LABEL[meseTarget]}</strong>{annoTarget !== anno ? ` ${annoTarget}` : ''}
                        </span>
                        <button
                          onClick={salvaSnapshotFineMese}
                          disabled={savingSnapshot}
                          className="btn-primary text-xs px-3 py-1.5"
                        >
                          {savingSnapshot ? '⟳ Salvataggio…' : registrato ? '💾 Aggiorna registrazione' : '💾 Registra chiusura'}
                        </button>
                        {snapshotSalvato != null ? (
                          <span className="text-xs text-green-600">✓ Salvato per {snapshotSalvato} asset</span>
                        ) : registrato ? (
                          <span className="text-xs text-gray-400">✓ Già registrato</span>
                        ) : null}
                      </div>
                    )
                  })()}
                </div>
                {(() => {
                  const assetAttiviStorico = portafoglio.filter(a => a.id && a.ticker)

                  const prezziPerAsset = new Map<string, Record<string, number>>()
                  for (const r of portafoglioStorico) {
                    if (!prezziPerAsset.has(r.portafoglio_id)) prezziPerAsset.set(r.portafoglio_id, {})
                    prezziPerAsset.get(r.portafoglio_id)![r.mese] = r.prezzo
                  }

                  let maxAbsPct = 0
                  const variazioniPerAsset = new Map<string, Record<string, number | null>>()
                  for (const a of assetAttiviStorico) {
                    if (!a.id) continue
                    const prezzi = prezziPerAsset.get(a.id) ?? {}
                    const rowVar: Record<string, number | null> = {}
                    let prezzoPrec: number | null = null
                    for (const m of MESI) {
                      const p = prezzi[m]
                      if (p != null && prezzoPrec != null && prezzoPrec !== 0) {
                        const pct = ((p - prezzoPrec) / prezzoPrec) * 100
                        rowVar[m] = pct
                        maxAbsPct = Math.max(maxAbsPct, Math.abs(pct))
                      } else {
                        rowVar[m] = null
                      }
                      if (p != null) prezzoPrec = p
                    }
                    variazioniPerAsset.set(a.id, rowVar)
                  }

                  if (assetAttiviStorico.length === 0) {
                    return <p className="text-xs text-gray-400">Nessun asset attivo in portafoglio.</p>
                  }

                  return (
                    <table className="min-w-full text-xs border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide sticky left-0 bg-white">
                            Asset
                          </th>
                          {MESI.map(m => (
                            <th key={m} className="text-right px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide">
                              {MESI_LABEL[m]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {assetAttiviStorico.map(a => {
                          if (!a.id) return null
                          const prezzi = prezziPerAsset.get(a.id) ?? {}
                          const rowVar = variazioniPerAsset.get(a.id) ?? {}
                          return (
                            <tr key={a.id}>
                              <td className="px-3 py-1.5 text-gray-700 font-medium sticky left-0 bg-white whitespace-nowrap border-b border-surface-200/50">
                                {a.nome || a.ticker}
                              </td>
                              {MESI.map(m => {
                                const prezzo = prezzi[m]
                                if (prezzo == null) {
                                  return (
                                    <td key={m} className="px-3 py-1.5 text-right text-gray-300 border-b border-surface-200/50">
                                      –
                                    </td>
                                  )
                                }
                                const pct = rowVar[m] ?? 0
                                return (
                                  <HeatmapCell
                                    key={m}
                                    value={Math.abs(pct)}
                                    max={maxAbsPct}
                                    isPositive={pct >= 0}
                                    format={() =>
                                      `€${prezzo.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                    }
                                  />
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )
                })()}
              </div>}

              </Drawer>
              <Drawer open={openSection.alert} onClose={closeSections}
                title="Dettaglio alert" subtitle="Ultime notifiche con dettaglio">
                {openSection.alert && <AlertDettaglioSezione />}
              </Drawer>

            </>
          )}
        </div>
      )}
    </div>
  )
}

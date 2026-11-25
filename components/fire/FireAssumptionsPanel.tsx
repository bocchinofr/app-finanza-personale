// components/fire/FireAssumptionsPanel.tsx
// (include l'editor dei debiti)
// Contenuto del Drawer "Ipotesi": tutti i parametri modificabili del modello.
// Le modifiche si applicano subito alla proiezione (stessa logica di prima).
'use client'

import type { ReactNode } from 'react'
import type { Debito, FireParametri } from '@/lib/fireCalculations'
import { useState } from 'react'
import { IconPlus, IconTrash } from '@/components/ui/Icons'

function Campo({
  label, value, onChange, suffix, step = 1, nota,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  suffix?: string
  step?: number
  nota?: string
}) {
  return (
    <label className="block">
      <span className="block text-[12px] leading-tight text-gray-500">{label}</span>
      <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-transparent">
        <input
          type="number"
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full min-w-0 border-0 p-0 font-mono text-sm tabular-nums text-gray-900 outline-none bg-transparent"
        />
        {suffix && <span className="shrink-0 text-[10px] text-gray-400">{suffix}</span>}
      </div>
      {nota && <p className="mt-1 text-[11px] leading-snug text-gray-400">{nota}</p>}
    </label>
  )
}

function Sezione({ titolo, colore, children, className = '' }: { titolo: string; colore: string; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h4 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-gray-900">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colore }} />
        {titolo}
      </h4>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

// ─── Editor debiti ───────────────────────────────────────────────
function nuovoDebitoVuoto(): Debito {
  return {
    id: crypto.randomUUID(),
    nome: '',
    rataAnnua: 0,
    annoEstinzione: new Date().getFullYear() + 1,
  }
}

const CAMPO = 'rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent'

function DebitiEditor({
  debiti, onChange,
}: {
  debiti: Debito[]
  onChange: (debiti: Debito[]) => void
}) {
  const [nuovo, setNuovo] = useState<Debito>(nuovoDebitoVuoto())

  function aggiungiDebito() {
    if (!nuovo.nome.trim() || nuovo.rataAnnua <= 0) return
    onChange([...debiti, nuovo])
    setNuovo(nuovoDebitoVuoto())
  }

  function rimuoviDebito(id: string) {
    onChange(debiti.filter(d => d.id !== id))
  }

  function aggiornaDebito(id: string, campo: keyof Debito, valore: string | number) {
    onChange(debiti.map(d => (d.id === id ? { ...d, [campo]: valore } : d)))
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-gray-500">
        Rate incluse nelle spese attuali che verranno rimosse dall&apos;anno di estinzione (es. mutuo).
        L&apos;importo liberato riduce solo le spese, non aumenta automaticamente l&apos;investimento.
      </p>

      {debiti.length > 0 && (
        <div className="divide-y divide-surface-100 rounded-lg border border-surface-200">
          {debiti.map(d => (
            <div key={d.id} className="flex flex-wrap items-center gap-2 p-2.5">
              <input
                type="text"
                value={d.nome}
                onChange={e => aggiornaDebito(d.id, 'nome', e.target.value)}
                placeholder="Nome (es. Mutuo casa)"
                className={`${CAMPO} min-w-[140px] flex-1`}
              />
              <label className="flex items-center gap-1 text-[12px] text-gray-500">
                Rata annua €
                <input
                  type="number"
                  value={d.rataAnnua}
                  onChange={e => aggiornaDebito(d.id, 'rataAnnua', Number(e.target.value))}
                  className={`${CAMPO} w-24 font-mono tabular-nums`}
                />
              </label>
              <label className="flex items-center gap-1 text-[12px] text-gray-500">
                Estinto entro
                <input
                  type="number"
                  value={d.annoEstinzione}
                  onChange={e => aggiornaDebito(d.id, 'annoEstinzione', Number(e.target.value))}
                  className={`${CAMPO} w-20 font-mono tabular-nums`}
                />
              </label>
              <button
                type="button"
                onClick={() => rimuoviDebito(d.id)}
                className="ml-auto h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                aria-label={`Rimuovi ${d.nome || 'debito'}`}
                title="Rimuovi"
              >
                <IconTrash size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-surface-300 p-2.5">
        <input
          type="text"
          value={nuovo.nome}
          onChange={e => setNuovo({ ...nuovo, nome: e.target.value })}
          placeholder="Nome debito"
          className={`${CAMPO} min-w-[140px] flex-1`}
        />
        <input
          type="number"
          value={nuovo.rataAnnua || ''}
          onChange={e => setNuovo({ ...nuovo, rataAnnua: Number(e.target.value) })}
          placeholder="Rata annua €"
          className={`${CAMPO} w-28 font-mono tabular-nums`}
        />
        <input
          type="number"
          value={nuovo.annoEstinzione}
          onChange={e => setNuovo({ ...nuovo, annoEstinzione: Number(e.target.value) })}
          title="Anno di estinzione"
          className={`${CAMPO} w-20 font-mono tabular-nums`}
        />
        <button type="button" onClick={aggiungiDebito} className="btn-primary !px-3 !py-1.5 text-sm inline-flex items-center gap-1.5">
          <IconPlus size={14} /> Aggiungi
        </button>
      </div>
    </div>
  )
}

// ─── Pannello ipotesi ────────────────────────────────────────────
export default function FireAssumptionsPanel({
  parametri, onChange,
}: {
  parametri: FireParametri
  onChange: (parametri: FireParametri) => void
}) {
  function set<K extends keyof FireParametri>(campo: K, valore: FireParametri[K]) {
    onChange({ ...parametri, [campo]: valore })
  }

  return (
    <div className="space-y-6">
      <p className="text-[12px] leading-relaxed text-gray-500">
        Le modifiche aggiornano subito grafico e KPI. Premi <strong>Ricalcola</strong> per salvarle come nuova previsione di riferimento.
      </p>

      <div className="grid grid-cols-1 gap-x-6 gap-y-7 sm:grid-cols-2">
        <Sezione titolo="Entrate" colore="#5d8a7a">
          <Campo
            label="Entrate annue base"
            value={parametri.entrateAnnueBase}
            onChange={v => set('entrateAnnueBase', v)}
            suffix="€/anno"
            nota="Media annualizzata di stipendi, assegno unico e bonus. Esclusi interessi, rimborsi e vendita titoli. Si azzerano quando raggiungi il FIRE."
          />
          <Campo label="Crescita entrate" value={parametri.crescitaEntratePct} onChange={v => set('crescitaEntratePct', v)} suffix="%/anno" step={0.1} />
        </Sezione>

        <Sezione titolo="Spese" colore="#78716c">
          <Campo label="Spese annue base" value={parametri.speseAnnueBase} onChange={v => set('speseAnnueBase', v)} suffix="€/anno" />
          <Campo label="Crescita spese" value={parametri.crescitaSpesePct} onChange={v => set('crescitaSpesePct', v)} suffix="%/anno" step={0.1} />
        </Sezione>

        <Sezione titolo="Investimenti" colore="#3f6b4f">
          <Campo label="Investimento annuo" value={parametri.investimentoAnnuoBase} onChange={v => set('investimentoAnnuoBase', v)} suffix="€/anno" />
          <Campo label="Crescita investimento" value={parametri.crescitaInvestimentoPct} onChange={v => set('crescitaInvestimentoPct', v)} suffix="%/anno" step={0.1} />
          <Campo label="Rendimento atteso" value={parametri.rendimentoInvestimentiPct} onChange={v => set('rendimentoInvestimentiPct', v)} suffix="%/anno" step={0.1} />
          <Campo label="Tassazione interessi" value={parametri.tassazioneInteressiPct} onChange={v => set('tassazioneInteressiPct', v)} suffix="%" step={0.5} />
        </Sezione>

        <Sezione titolo="Fondo pensione" colore="#a67c3d">
          <Campo label="Rendimento atteso" value={parametri.rendimentoFondoPensionePct} onChange={v => set('rendimentoFondoPensionePct', v)} suffix="%/anno" step={0.1} />
          <Campo label="Tassazione fondo" value={parametri.tassazioneFondoPensionePct} onChange={v => set('tassazioneFondoPensionePct', v)} suffix="%" step={0.5} />
          <Campo
            label="Età sblocco"
            value={parametri.etaRitiroFondoPensione}
            onChange={v => set('etaRitiroFondoPensione', v)}
            suffix="anni"
            nota="Da questa età il fondo si libera: una parte come capitale, il resto come integrazione annua."
          />
          <Campo
            label="Quota capitale (TFR)"
            value={parametri.quotaCapitaleFondoPensionePct}
            onChange={v => set('quotaCapitaleFondoPensionePct', v)}
            suffix="%"
            nota="Il resto esce come integrazione annua che riduce le spese nette."
          />
          <label className="flex items-center gap-2 pt-0.5 text-[12px] text-gray-600">
            <input
              type="checkbox"
              checked={parametri.includiFondoPensioneInFireNumber}
              onChange={e => set('includiFondoPensioneInFireNumber', e.target.checked)}
              className="h-3.5 w-3.5 accent-[#3f6b4f]"
            />
            Conta anche da bloccato nel FIRE number
          </label>
        </Sezione>
      </div>

      <Sezione titolo="Generali" colore="#8a8f7a" className="border-t border-surface-100 pt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Campo
            label="Inflazione"
            value={parametri.inflazionePct}
            onChange={v => set('inflazionePct', v)}
            suffix="%/anno"
            step={0.1}
            nota="Riferimento: per farla incidere sulle spese imposta anche la «Crescita spese»."
          />
          <Campo
            label="Safe Withdrawal Rate"
            value={parametri.swrPct}
            onChange={v => set('swrPct', v)}
            suffix="%"
            step={0.1}
            nota="Regola del 4%: capitale target = spese ÷ SWR. Il criterio vero è la simulazione."
          />
          <Campo label="Orizzonte proiezione" value={parametri.orizzonteAnni} onChange={v => set('orizzonteAnni', v)} suffix="anni" />
        </div>
      </Sezione>

      <Sezione titolo="Debiti" colore="#c3c9b0" className="border-t border-surface-100 pt-6">
        <DebitiEditor debiti={parametri.debiti} onChange={debiti => set('debiti', debiti)} />
      </Sezione>
    </div>
  )
}

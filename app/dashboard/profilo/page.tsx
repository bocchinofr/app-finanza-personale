'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { RISK_QUESTIONS, type RiskDimension } from '@/lib/riskQuestionnaire'
import KpiCard from '@/components/ui/KpiCard'
import Drawer from '@/components/ui/Drawer'
import InfoBox from '@/components/ui/InfoBox'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { IconUser, IconShield, IconChart, IconCheck } from '@/components/ui/Icons'

function getRiskLabel(score: number): string {
  if (score <= 30) return 'Conservativo'
  if (score <= 50) return 'Prudente'
  if (score <= 70) return 'Bilanciato'
  if (score <= 85) return 'Dinamico'
  return 'Aggressivo'
}

function getBehaviorLabel(score: number): string {
  if (score <= 20) return 'Venditore in preda al panico'
  if (score <= 55) return 'Attendista'
  if (score <= 85) return 'Disciplinato (segue il piano)'
  return 'Contrarian (accumula sui crolli)'
}

function getDiversificationLabel(score: number): string {
  if (score <= 30) return 'Concentrato'
  if (score <= 70) return 'Bilanciato'
  return 'Molto diversificato'
}

function getAllocationLabel(equityPct: number): string {
  if (equityPct <= 20) return 'Obbligazionario'
  if (equityPct <= 45) return 'Prudente'
  if (equityPct <= 65) return 'Bilanciato'
  if (equityPct <= 85) return 'Dinamico'
  return 'Azionario'
}

const AVAILABLE_GOALS = ['Fondo emergenza', 'Acquisto casa', 'Pensione', 'Istruzione figli', 'Viaggi', 'Auto nuova']

const EMPLOYMENT_LABELS: Record<string, string> = {
  dipendente: 'Dipendente',
  autonomo: 'Autonomo / Libero professionista',
  imprenditore: 'Imprenditore',
  pensionato: 'Pensionato',
  in_cerca: 'In cerca di occupazione',
  studente: 'Studente',
}

type Sezione = 'dati' | 'obiettivi' | 'pensione' | 'rischio'

interface Form {
  nome: string
  birthDate: string
  employment: string
  goals: string[]
  goalsNote: string
  hasPension: boolean
  pensionTfr: boolean
  pensionType: 'categoria' | 'privato' | ''
  riskAnswers: Record<string, number>
}

const EMPTY: Form = {
  nome: '', birthDate: '', employment: '', goals: [], goalsNote: '',
  hasPension: false, pensionTfr: false, pensionType: '', riskAnswers: {},
}

function rischioCompleto(answers: Record<string, number>) {
  return Object.keys(answers).length === RISK_QUESTIONS.length
}

function calcolaRischio(answers: Record<string, number>) {
  const byDimension = (dim: RiskDimension) =>
    RISK_QUESTIONS.filter(q => q.dimension === dim).map(q => answers[q.id]).filter(v => v !== undefined)
  const avg = (values: number[]) => values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null

  const risk = avg(byDimension('risk'))
  const behavior = avg(byDimension('behavior'))
  const diversification = avg(byDimension('diversification'))
  const allocation = avg(byDimension('allocation'))

  const score = risk !== null ? Math.round(risk) : 0
  const equityPct = allocation !== null ? Math.round(allocation) : null

  return {
    score,
    label: risk !== null ? getRiskLabel(score) : 'Non definito',
    behaviorScore: behavior !== null ? Math.round(behavior) : null,
    behaviorLabel: behavior !== null ? getBehaviorLabel(Math.round(behavior)) : null,
    diversificationLabel: diversification !== null ? getDiversificationLabel(Math.round(diversification)) : null,
    equityPct,
    allocationLabel: equityPct !== null ? getAllocationLabel(equityPct) : null,
  }
}

function calcolaEta(birthDate: string): number | null {
  if (!birthDate) return null
  const n = new Date(birthDate)
  if (isNaN(n.getTime())) return null
  const oggi = new Date()
  let eta = oggi.getFullYear() - n.getFullYear()
  if (oggi.getMonth() < n.getMonth() || (oggi.getMonth() === n.getMonth() && oggi.getDate() < n.getDate())) eta -= 1
  return eta
}

function Pillola({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-full truncate items-center rounded-full bg-surface-100 text-gray-500 text-[11px] font-medium px-2 py-0.5">
      {children}
    </span>
  )
}

function Riga({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-surface-100 last:border-b-0">
      <span className="text-[12px] text-gray-500 shrink-0">{label}</span>
      <span className="text-[13px] font-medium text-gray-900 text-right break-words min-w-0">{value}</span>
    </div>
  )
}

function SezioneCard({
  titolo, icona, onModifica, labelModifica = 'Modifica', headerExtra, children, className = '',
}: {
  titolo: string
  icona: React.ReactNode
  onModifica: () => void
  labelModifica?: string
  headerExtra?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`card flex flex-col ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 min-w-0">
          <span className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-lg bg-brand-50 text-brand-700">{icona}</span>
          <span className="truncate">{titolo}</span>
          {headerExtra}
        </h2>
        <button type="button" onClick={onModifica} className="btn-secondary !px-3 !py-1 text-xs shrink-0">
          {labelModifica}
        </button>
      </div>
      <div className="flex-1">{children}</div>
    </section>
  )
}

function FooterSalva({
  onSalva, onAnnulla, saving, error,
}: { onSalva: () => void; onAnnulla: () => void; saving: boolean; error: string }) {
  return (
    <div className="mt-5 pt-4 border-t border-surface-100">
      {error && <div className="mb-3 rounded-lg px-3 py-2 text-sm bg-red-50 text-red-600">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onAnnulla} disabled={saving} className="btn-secondary">Annulla</button>
        <button type="button" onClick={onSalva} disabled={saving} className="btn-primary">
          {saving ? 'Salvataggio…' : 'Salva'}
        </button>
      </div>
    </div>
  )
}

export default function ProfiloPage() {
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [saved, setSaved] = useState<Form>(EMPTY)
  const [form, setForm] = useState<Form>(EMPTY)
  const [riskLabelDb, setRiskLabelDb] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<Sezione | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setEmail(user.email ?? '')

      const { data } = await supabase.from('profili').select('*').eq('user_id', user.id).single()
      if (data) {
        const f: Form = {
          nome: data.nome_visualizzato ?? '',
          birthDate: data.birth_date ?? '',
          employment: data.employment_status ?? '',
          goals: data.financial_goals ?? [],
          goalsNote: data.financial_goals_note ?? '',
          hasPension: data.has_pension_fund ?? false,
          pensionTfr: data.pension_fund_tfr ?? false,
          pensionType: data.pension_fund_type ?? '',
          riskAnswers: data.risk_answers ?? {},
        }
        setSaved(f)
        setForm(f)
        setRiskLabelDb(data.risk_profile_label ?? null)
      }
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(''), 4000)
    return () => clearTimeout(t)
  }, [message])

  function upd<K extends keyof Form>(k: K, v: Form[K]) {
    setForm(p => ({ ...p, [k]: v }))
  }

  function apri(s: Sezione) {
    setError('')
    setForm(saved)
    setDrawer(s)
  }

  function chiudi() {
    if (saving) return
    setDrawer(null)
    setForm(saved)
  }

  async function salva() {
    setError('')
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Non autenticato')

      let score: number | null = null
      let label: string | null = null
      let behaviorScore: number | null = null
      let behaviorLabel: string | null = null
      if (rischioCompleto(form.riskAnswers)) {
        const r = calcolaRischio(form.riskAnswers)
        score = r.score
        label = r.label
        behaviorScore = r.behaviorScore
        behaviorLabel = r.behaviorLabel
      }

      const { error: upsertError } = await supabase.from('profili').upsert({
        user_id: user.id,
        nome_visualizzato: form.nome.trim() || null,
        birth_date: form.birthDate || null,
        employment_status: form.employment || null,
        financial_goals: form.goals,
        financial_goals_note: form.goalsNote.trim() || null,
        has_pension_fund: form.hasPension,
        pension_fund_tfr: form.hasPension ? form.pensionTfr : false,
        pension_fund_type: form.hasPension ? form.pensionType : null,
        risk_answers: Object.keys(form.riskAnswers).length > 0 ? form.riskAnswers : null,
        risk_profile_score: score,
        risk_profile_label: label,
        behavior_score: behaviorScore,
        behavior_label: behaviorLabel,
        updated_at: new Date().toISOString(),
      })
      if (upsertError) throw upsertError

      const nuovo: Form = {
        ...form,
        pensionTfr: form.hasPension ? form.pensionTfr : false,
        pensionType: form.hasPension ? form.pensionType : '',
      }
      setSaved(nuovo)
      setForm(nuovo)
      setRiskLabelDb(label)
      setDrawer(null)
      setMessage('Profilo aggiornato con successo')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Errore nel salvataggio')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-sm text-gray-400">Caricamento…</div>

  const rischio = rischioCompleto(saved.riskAnswers) ? calcolaRischio(saved.riskAnswers) : null
  const labelRischio = rischio?.label ?? riskLabelDb
  const eta = calcolaEta(saved.birthDate)
  const lavoro = saved.employment ? (EMPLOYMENT_LABELS[saved.employment] ?? saved.employment) : null
  const tipoFondo = saved.pensionType === 'categoria' ? 'Di categoria' : saved.pensionType === 'privato' ? 'Privato' : null
  const anteprima = rischioCompleto(form.riskAnswers) ? calcolaRischio(form.riskAnswers) : null

  return (
    <div className="max-w-[1680px] mx-auto flex flex-col gap-4">
      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700 inline-flex items-center gap-2">
          <IconCheck size={16} /> {message}
        </div>
      )}

      {/* KPI */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          variant="compact" label="Profilo di rischio" color="#3f6b4f" delta={null}
          value={labelRischio ?? 'Da compilare'}
          badge={<Pillola>{rischio?.behaviorLabel ?? 'Questionario'}</Pillola>}
          onClick={() => apri('rischio')}
        />
        <KpiCard
          variant="compact" label="Mix preferito" color="#2563eb" delta={null}
          value={rischio?.equityPct != null ? `${rischio.equityPct}% azionario` : '—'}
          badge={<Pillola>{rischio?.allocationLabel ?? 'Non definito'}</Pillola>}
          onClick={() => apri('rischio')}
        />
        <KpiCard
          variant="compact" label="Età" color="#d97706" delta={null}
          value={eta != null ? `${eta} anni` : 'Non impostata'}
          badge={<Pillola>{lavoro ?? 'Situazione lavorativa'}</Pillola>}
          onClick={() => apri('dati')}
        />
        <KpiCard
          variant="compact" label="Previdenza" color="#7c3aed" delta={null}
          value={saved.hasPension ? 'Fondo attivo' : 'Nessun fondo'}
          badge={<Pillola>{saved.hasPension ? (saved.pensionTfr ? 'Con TFR' : 'Senza TFR') : 'Non configurato'}</Pillola>}
          onClick={() => apri('pensione')}
        />
      </div>

      {/* Dati, obiettivi, previdenza */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SezioneCard
          titolo="Dati personali" icona={<IconUser size={16} />} onModifica={() => apri('dati')}
          headerExtra={
            <InfoBox title="Dati personali">
              <p>Email, nome e data di nascita. La data di nascita serve alla sezione FIRE per calcolare l&apos;età di partenza.</p>
              <p>Premi Modifica per aggiornare i dati in un popup.</p>
            </InfoBox>
          }
        >
          <Riga label="Email" value={email} />
          <Riga label="Nome" value={saved.nome || '–'} />
          <Riga label="Data di nascita" value={saved.birthDate ? new Date(saved.birthDate).toLocaleDateString('it-IT') : '–'} />
          <Riga label="Situazione lavorativa" value={lavoro ?? '–'} />
        </SezioneCard>

        <SezioneCard
          titolo="Obiettivi finanziari" icona={<IconChart size={16} />} onModifica={() => apri('obiettivi')}
          headerExtra={
            <InfoBox title="Obiettivi finanziari">
              <p>Gli obiettivi principali che vuoi raggiungere, più una nota libera di massimo 120 caratteri.</p>
            </InfoBox>
          }
        >
          {saved.goals.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {saved.goals.map(g => (
                <span key={g} className="text-xs px-3 py-1.5 rounded-full bg-brand-50 text-brand-700 font-medium">{g}</span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 pt-1">Nessun obiettivo selezionato.</p>
          )}
          {saved.goalsNote && <p className="text-xs text-gray-600 italic mt-3">“{saved.goalsNote}”</p>}
        </SezioneCard>

        <SezioneCard
          titolo="Fondo pensione" icona={<IconShield size={16} />} onModifica={() => apri('pensione')}
          headerExtra={
            <InfoBox title="Fondo pensione">
              <p>Indica se hai un fondo pensione, se ricevi il TFR e la tipologia. Questi dati guidano la sezione FIRE.</p>
            </InfoBox>
          }
        >
          <Riga label="Hai un fondo pensione" value={saved.hasPension ? 'Sì' : 'No'} />
          {saved.hasPension && (
            <>
              <Riga label="Accredito TFR" value={saved.pensionTfr ? 'Sì' : 'No'} />
              <Riga label="Tipologia" value={tipoFondo ?? '–'} />
            </>
          )}
        </SezioneCard>
      </div>

      {/* Profilo di rischio */}
      <SezioneCard
        titolo="Profilo di rischio" icona={<IconChart size={16} />} onModifica={() => apri('rischio')}
        labelModifica={rischio ? 'Rifai il questionario' : 'Compila il questionario'}
        headerExtra={
          <InfoBox title="Come si legge">
            <p>Il profilo nasce dalle risposte al questionario: tolleranza al rischio, comportamento nei crolli, diversificazione e mix azionario/obbligazionario preferito.</p>
            <p>Si ricalcola solo quando rispondi a tutte le domande.</p>
          </InfoBox>
        }
      >
        {rischio ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 pt-1">
            <div className="rounded-lg bg-brand-50 border border-brand-200 px-3 py-2.5">
              <p className="text-[11px] text-brand-700">Profilo complessivo</p>
              <p className="text-lg font-bold text-brand-900">{rischio.label}</p>
            </div>
            <div className="rounded-lg border border-surface-200 px-3 py-2.5">
              <p className="text-[11px] text-gray-400 mb-0.5">Comportamento nei crolli</p>
              <p className="text-sm font-semibold text-gray-900">{rischio.behaviorLabel}</p>
            </div>
            <div className="rounded-lg border border-surface-200 px-3 py-2.5">
              <p className="text-[11px] text-gray-400 mb-0.5">Diversificazione preferita</p>
              <p className="text-sm font-semibold text-gray-900">{rischio.diversificationLabel}</p>
            </div>
            <div className="rounded-lg border border-surface-200 px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] text-gray-400">Mix ({rischio.allocationLabel})</p>
                <p className="text-[11px] text-gray-400">{rischio.equityPct}% az. / {100 - (rischio.equityPct ?? 0)}% obbl.</p>
              </div>
              <div className="h-2.5 w-full rounded-full bg-surface-100 overflow-hidden flex">
                <div className="h-full bg-brand-600" style={{ width: `${rischio.equityPct ?? 0}%` }} />
                <div className="h-full bg-blue-200" style={{ width: `${100 - (rischio.equityPct ?? 0)}%` }} />
              </div>
            </div>
          </div>
        ) : labelRischio ? (
          <p className="text-sm text-gray-600 pt-1">Profilo salvato: <strong>{labelRischio}</strong>. Rifai il questionario per vedere il dettaglio.</p>
        ) : (
          <p className="text-sm text-gray-400 pt-1">Questionario non ancora compilato.</p>
        )}
      </SezioneCard>

      {/* Popup di modifica */}
      <Drawer open={drawer === 'dati'} onClose={chiudi} variant="center" closeOnBlankClick={false}
        title="Dati personali" subtitle="Modifica i tuoi dati">
        <div className="space-y-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">Email</p>
            <p className="text-sm text-gray-700 bg-surface-50 px-3 py-2 rounded-lg border border-surface-200">{email}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome visualizzato</label>
            <input value={form.nome} onChange={e => upd('nome', e.target.value)} className="input" placeholder="Francesco" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Data di nascita</label>
            <input type="date" value={form.birthDate} onChange={e => upd('birthDate', e.target.value)} className="input" />
            {calcolaEta(form.birthDate) != null && (
              <p className="text-xs text-gray-400 mt-1">Età: {calcolaEta(form.birthDate)} anni</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Situazione lavorativa</label>
            <select value={form.employment} onChange={e => upd('employment', e.target.value)} className="input">
              <option value="">Seleziona...</option>
              {Object.entries(EMPLOYMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <FooterSalva onSalva={salva} onAnnulla={chiudi} saving={saving} error={error} />
      </Drawer>

      <Drawer open={drawer === 'obiettivi'} onClose={chiudi} variant="center" closeOnBlankClick={false}
        title="Obiettivi finanziari" subtitle="Seleziona uno o più obiettivi principali">
        <div className="flex flex-wrap gap-2">
          {AVAILABLE_GOALS.map(goal => (
            <button
              key={goal}
              type="button"
              onClick={() => upd('goals', form.goals.includes(goal) ? form.goals.filter(g => g !== goal) : [...form.goals, goal])}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                form.goals.includes(goal)
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-gray-600 border-surface-300 hover:border-brand-400'
              }`}
            >
              {goal}
            </button>
          ))}
        </div>
        <div className="mt-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">Altro obiettivo (facoltativo)</label>
          <input
            value={form.goalsNote}
            onChange={e => upd('goalsNote', e.target.value.slice(0, 120))}
            maxLength={120}
            className="input"
            placeholder="Es. aprire un'attività, sabbatico nel 2030…"
          />
          <p className="text-[11px] text-gray-400 mt-1 text-right">{form.goalsNote.length}/120</p>
        </div>
        <FooterSalva onSalva={salva} onAnnulla={chiudi} saving={saving} error={error} />
      </Drawer>

      <Drawer open={drawer === 'pensione'} onClose={chiudi} variant="center" closeOnBlankClick={false}
        title="Fondo pensione" subtitle="Previdenza complementare">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Hai un fondo pensione?</label>
            <SegmentedControl<'si' | 'no'>
              ariaLabel="Hai un fondo pensione"
              options={[{ value: 'si', label: 'Sì' }, { value: 'no', label: 'No' }]}
              value={form.hasPension ? 'si' : 'no'}
              onChange={v => setForm(p => v === 'si'
                ? { ...p, hasPension: true }
                : { ...p, hasPension: false, pensionTfr: false, pensionType: '' })}
            />
          </div>
          {form.hasPension && (
            <div className="space-y-4 border-l-2 border-brand-200 pl-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Con accredito del TFR?</label>
                <SegmentedControl<'si' | 'no'>
                  ariaLabel="Accredito TFR"
                  options={[{ value: 'si', label: 'Sì' }, { value: 'no', label: 'No' }]}
                  value={form.pensionTfr ? 'si' : 'no'}
                  onChange={v => upd('pensionTfr', v === 'si')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Tipologia fondo</label>
                <select
                  value={form.pensionType}
                  onChange={e => upd('pensionType', e.target.value as 'categoria' | 'privato' | '')}
                  className="input"
                >
                  <option value="">Seleziona...</option>
                  <option value="categoria">Di categoria</option>
                  <option value="privato">Privato</option>
                </select>
              </div>
            </div>
          )}
        </div>
        <FooterSalva onSalva={salva} onAnnulla={chiudi} saving={saving} error={error} />
      </Drawer>

      <Drawer open={drawer === 'rischio'} onClose={chiudi} closeOnBlankClick={false}
        title="Questionario di rischio" subtitle="Rispondi a tutte le domande per calcolare il profilo">
        <div className="space-y-3">
          {RISK_QUESTIONS.map(q => (
            <div key={q.id} className="space-y-1">
              <label className="text-xs font-medium text-gray-600">{q.label}</label>
              <select
                className="input text-sm"
                value={form.riskAnswers[q.id] ?? ''}
                onChange={e => setForm(p => ({ ...p, riskAnswers: { ...p.riskAnswers, [q.id]: Number(e.target.value) } }))}
              >
                <option value="">Seleziona...</option>
                {q.options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Risposte: {Object.keys(form.riskAnswers).length}/{RISK_QUESTIONS.length}
        </p>
        {anteprima && (
          <div className="mt-3 p-3 bg-brand-50 border border-brand-200 rounded-lg text-center">
            <p className="text-xs text-brand-700">Il tuo profilo complessivo</p>
            <p className="text-lg font-bold text-brand-900">{anteprima.label}</p>
          </div>
        )}
        <FooterSalva onSalva={salva} onAnnulla={chiudi} saving={saving} error={error} />
      </Drawer>
    </div>
  )
}

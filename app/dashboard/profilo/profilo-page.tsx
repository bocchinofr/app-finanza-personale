'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'

// Domande del questionario, ciascuna assegnata a una dimensione del profilo:
// - 'risk'          -> tolleranza al rischio / oscillazioni (score complessivo)
// - 'behavior'      -> reazione comportamentale ai crolli di mercato
// - 'diversification' -> preferenza di concentrazione vs diversificazione
// - 'allocation'    -> mix preferito azionario / obbligazionario
type RiskDimension = 'risk' | 'behavior' | 'diversification' | 'allocation'

const RISK_QUESTIONS: { id: string; label: string; dimension: RiskDimension; options: { value: number; label: string }[] }[] = [
  {
    id: 'horizon',
    label: 'Qual è il tuo orizzonte temporale per gli investimenti?',
    dimension: 'risk',
    options: [
      { value: 20, label: 'Breve termine (< 3 anni)' },
      { value: 50, label: 'Medio termine (3-10 anni)' },
      { value: 80, label: 'Lungo termine (> 10 anni)' },
    ]
  },
  {
    id: 'lossTolerance',
    label: 'Quanta oscillazione temporanea del portafoglio sei disposto a tollerare per rendimenti più alti?',
    dimension: 'risk',
    options: [
      { value: 10, label: 'Nessuna: preferisco stabilità anche con rendimenti bassi' },
      { value: 40, label: 'Moderata: accetto oscillazioni del 10-15%' },
      { value: 70, label: 'Alta: accetto oscillazioni del 20-30%' },
      { value: 95, label: 'Molto alta: accetto oscillazioni anche superiori al 30%' },
    ]
  },
  {
    id: 'reaction',
    label: 'Come reagiresti a un crollo del 20% del mercato?',
    dimension: 'behavior',
    options: [
      { value: 5, label: 'Venderei subito per fermare le perdite' },
      { value: 40, label: 'Aspetterei senza fare nulla' },
      { value: 70, label: 'Continuerei i versamenti programmati come da piano' },
      { value: 95, label: 'Approfitterei per investire di più (accumulo sui crolli)' },
    ]
  },
  {
    id: 'diversification',
    label: 'Preferisci un portafoglio molto diversificato o concentrato su poche scelte convinte?',
    dimension: 'diversification',
    options: [
      { value: 15, label: 'Concentrato su poche posizioni ad alta convinzione' },
      { value: 55, label: 'Bilanciato: poche posizioni principali + satelliti' },
      { value: 95, label: 'Molto diversificato: tanti asset, settori e aree geografiche' },
    ]
  },
  {
    id: 'allocation',
    label: 'Se potessi scegliere liberamente il mix, quale preferiresti?',
    dimension: 'allocation',
    options: [
      { value: 10, label: 'Prevalentemente obbligazionario / liquidità' },
      { value: 35, label: 'Prudente: più obbligazioni che azioni' },
      { value: 60, label: 'Bilanciato: metà azioni, metà obbligazioni' },
      { value: 80, label: 'Dinamico: più azioni che obbligazioni' },
      { value: 100, label: 'Prevalentemente azionario' },
    ]
  },
  {
    id: 'knowledge',
    label: 'Come valuti la tua conoscenza finanziaria?',
    dimension: 'risk',
    options: [
      { value: 20, label: 'Base (solo conto corrente e risparmio)' },
      { value: 50, label: 'Intermedia (fondi, obbligazioni, azioni)' },
      { value: 90, label: 'Avanzata (asset allocation, derivati, mercati)' },
    ]
  },
]

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

// Lista degli obiettivi disponibili
const AVAILABLE_GOALS = ['Fondo emergenza', 'Acquisto casa', 'Pensione', 'Istruzione figli', 'Viaggi', 'Auto nuova']

export default function ProfiloPage() {
  const supabase = createClient()
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  
  // Dati profilo
  const [email, setEmail] = useState('')
  const [nome, setNome] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [employmentStatus, setEmploymentStatus] = useState('')
  const [financialGoals, setFinancialGoals] = useState<string[]>([])
  
  // Fondo pensione
  const [hasPensionFund, setHasPensionFund] = useState<boolean>(false)
  const [pensionFundTfr, setPensionFundTfr] = useState<boolean>(false)
  const [pensionFundType, setPensionFundType] = useState<'categoria' | 'privato' | ''>('')
  
  // Risk questionnaire
  const [riskAnswers, setRiskAnswers] = useState<Record<string, number>>({})
  const [riskLabel, setRiskLabel] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setEmail(user.email ?? '')

      const { data } = await supabase
        .from('profili')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (data) {
        setNome(data.nome_visualizzato ?? '')
        setBirthDate(data.birth_date ?? '')
        setEmploymentStatus(data.employment_status ?? '')
        setFinancialGoals(data.financial_goals ?? [])
        setHasPensionFund(data.has_pension_fund ?? false)
        setPensionFundTfr(data.pension_fund_tfr ?? false)
        setPensionFundType(data.pension_fund_type ?? '')
        if (data.risk_profile_label) {
          setRiskLabel(data.risk_profile_label)
        }
        if (data.risk_answers) {
          setRiskAnswers(data.risk_answers)
        }
      }
      setLoading(false)
    }
    load()
  }, [])

  function handleRiskChange(questionId: string, value: number) {
    setRiskAnswers(prev => ({ ...prev, [questionId]: value }))
  }

  function calculateRiskProfile() {
    const byDimension = (dim: RiskDimension) =>
      RISK_QUESTIONS.filter(q => q.dimension === dim).map(q => riskAnswers[q.id]).filter(v => v !== undefined)

    const avg = (values: number[]) => values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null

    const riskValues = avg(byDimension('risk'))
    const behaviorValues = avg(byDimension('behavior'))
    const diversificationValues = avg(byDimension('diversification'))
    const allocationValues = avg(byDimension('allocation'))

    const score = riskValues !== null ? Math.round(riskValues) : 0
    const equityPct = allocationValues !== null ? Math.round(allocationValues) : 0

    return {
      score,
      label: riskValues !== null ? getRiskLabel(score) : 'Non definito',
      behaviorScore: behaviorValues !== null ? Math.round(behaviorValues) : null,
      behaviorLabel: behaviorValues !== null ? getBehaviorLabel(Math.round(behaviorValues)) : null,
      diversificationScore: diversificationValues !== null ? Math.round(diversificationValues) : null,
      diversificationLabel: diversificationValues !== null ? getDiversificationLabel(Math.round(diversificationValues)) : null,
      equityPct: allocationValues !== null ? equityPct : null,
      allocationLabel: allocationValues !== null ? getAllocationLabel(equityPct) : null,
    }
  }

  function toggleGoal(goal: string) {
    setFinancialGoals(prev =>
      prev.includes(goal) ? prev.filter(g => g !== goal) : [...prev, goal]
    )
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')

    let riskScore = null
    let riskLabelFinal = null
    if (Object.keys(riskAnswers).length === RISK_QUESTIONS.length) {
      const result = calculateRiskProfile()
      riskScore = result.score
      riskLabelFinal = result.label
    }

    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Non autenticato')

      const { error: upsertError } = await supabase
        .from('profili')
        .upsert({
          user_id: user.id,
          nome_visualizzato: nome.trim() || null,
          birth_date: birthDate || null,
          employment_status: employmentStatus || null,
          financial_goals: financialGoals,
          has_pension_fund: hasPensionFund,
          pension_fund_tfr: hasPensionFund ? pensionFundTfr : false,
          pension_fund_type: hasPensionFund ? pensionFundType : null,
          risk_answers: Object.keys(riskAnswers).length > 0 ? riskAnswers : null,  // aggiunto
          risk_profile_score: riskScore,
          risk_profile_label: riskLabelFinal,
          updated_at: new Date().toISOString(),
        })

      if (upsertError) throw upsertError
      
      setMessage('✓ Profilo aggiornato con successo')
      if (riskLabelFinal) setRiskLabel(riskLabelFinal)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Errore nel salvataggio')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-sm text-gray-400">Caricamento…</div>

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-lg font-semibold text-gray-900 mb-1">Profilo</h1>
      <p className="text-sm text-gray-500 mb-6">Gestisci i tuoi dati personali, il profilo di rischio, gli obiettivi e la previdenza.</p>

      <form onSubmit={handleSave}>
        {/* Griglia a 3 colonne */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
          
          {/* --- COLONNA 1: Dati personali --- */}
          <div className="card space-y-4">
            <h2 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <span className="text-base">👤</span> Dati personali
            </h2>
            <div>
              <p className="text-xs text-gray-400 mb-1">Email</p>
              <p className="text-sm text-gray-700 bg-surface-50 px-3 py-2 rounded-lg border border-surface-200">
                {email}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nome visualizzato</label>
              <input value={nome} onChange={e => setNome(e.target.value)} className="input" placeholder="Francesco" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Data di nascita</label>
              <input type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)} className="input" />
              {birthDate && (
                <p className="text-xs text-gray-400 mt-1">
                  Età: {new Date().getFullYear() - new Date(birthDate).getFullYear()} anni
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Situazione lavorativa</label>
              <select value={employmentStatus} onChange={e => setEmploymentStatus(e.target.value)} className="input">
                <option value="">Seleziona...</option>
                <option value="dipendente">Dipendente</option>
                <option value="autonomo">Autonomo / Libero professionista</option>
                <option value="imprenditore">Imprenditore</option>
                <option value="pensionato">Pensionato</option>
                <option value="in_cerca">In cerca di occupazione</option>
                <option value="studente">Studente</option>
              </select>
            </div>
          </div>

          {/* --- COLONNA 2: Profilo di rischio --- */}
          <div className="card space-y-4">
            <h2 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <span className="text-base">📈</span> Profilo di rischio
            </h2>
            <p className="text-xs text-gray-400">Rispondi alle domande per calcolare il tuo profilo.</p>
            {RISK_QUESTIONS.map((q) => (
              <div key={q.id} className="space-y-1">
                <label className="text-xs font-medium text-gray-600">{q.label}</label>
                <select 
                  className="input text-sm" 
                  value={riskAnswers[q.id] ?? ''} 
                  onChange={(e) => handleRiskChange(q.id, Number(e.target.value))}
                >
                  <option value="">Seleziona...</option>
                  {q.options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            ))}

            {Object.keys(riskAnswers).length === RISK_QUESTIONS.length && (() => {
              const result = calculateRiskProfile()
              const equityPct = result.equityPct ?? 0
              const bondPct = 100 - equityPct
              return (
                <div className="mt-2 space-y-3">
                  <div className="p-3 bg-brand-50 border border-brand-200 rounded-lg text-center">
                    <p className="text-xs text-brand-700">Il tuo profilo complessivo:</p>
                    <p className="text-lg font-bold text-brand-900">{result.label}</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="rounded-lg border border-surface-200 p-2.5">
                      <p className="text-[11px] text-gray-400 mb-0.5">Comportamento nei crolli</p>
                      <p className="text-sm font-semibold text-gray-900">{result.behaviorLabel}</p>
                    </div>
                    <div className="rounded-lg border border-surface-200 p-2.5">
                      <p className="text-[11px] text-gray-400 mb-0.5">Diversificazione preferita</p>
                      <p className="text-sm font-semibold text-gray-900">{result.diversificationLabel}</p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-surface-200 p-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[11px] text-gray-400">Mix preferito ({result.allocationLabel})</p>
                      <p className="text-[11px] text-gray-400">{equityPct}% az. / {bondPct}% obbl.</p>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-surface-100 overflow-hidden flex">
                      <div className="h-full bg-brand-600" style={{ width: `${equityPct}%` }} />
                      <div className="h-full bg-blue-200" style={{ width: `${bondPct}%` }} />
                    </div>
                    <div className="flex justify-between mt-1 text-[10px] text-gray-400">
                      <span>Azionario</span>
                      <span>Obbligazionario</span>
                    </div>
                  </div>
                </div>
              )
            })()}
            {riskLabel && Object.keys(riskAnswers).length === 0 && (
              <div className="mt-2 p-3 bg-surface-50 rounded-lg text-center">
                <p className="text-xs text-gray-500">Profilo salvato: <strong>{riskLabel}</strong></p>
                <p className="text-xs text-gray-400">Modifica le risposte per ricalcolarlo.</p>
              </div>
            )}
          </div>

          {/* --- COLONNA 3: Obiettivi finanziari + Fondo pensione --- */}
          <div className="card space-y-6">
            {/* Obiettivi finanziari */}
            <div>
              <h2 className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-3">
                <span className="text-base">🎯</span> Obiettivi finanziari
              </h2>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_GOALS.map(goal => (
                  <button
                    key={goal}
                    type="button"
                    onClick={() => toggleGoal(goal)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      financialGoals.includes(goal) 
                        ? 'bg-brand-600 text-white border-brand-600' 
                        : 'bg-white text-gray-600 border-surface-300 hover:border-brand-400'
                    }`}
                  >
                    {goal}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1.5">Seleziona uno o più obiettivi principali.</p>
            </div>

            <hr className="border-surface-200" />

            {/* Fondo pensione */}
            <div>
              <h2 className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-3">
                <span className="text-base">🏦</span> Fondo pensione
              </h2>
              
              {/* Ha un fondo pensione? */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-600 mb-2">Hai un fondo pensione?</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="hasPensionFund"
                      checked={hasPensionFund === true}
                      onChange={() => setHasPensionFund(true)}
                      className="text-brand-600 focus:ring-brand-500"
                    />
                    Sì
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="hasPensionFund"
                      checked={hasPensionFund === false}
                      onChange={() => {
                        setHasPensionFund(false)
                        setPensionFundTfr(false)
                        setPensionFundType('')
                      }}
                      className="text-brand-600 focus:ring-brand-500"
                    />
                    No
                  </label>
                </div>
              </div>

              {/* Se sì, mostra le opzioni aggiuntive */}
              {hasPensionFund && (
                <div className="space-y-4 pl-1 border-l-2 border-brand-200 pl-3">
                  {/* Accredito TFR */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2">Con accredito del TFR?</label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name="pensionFundTfr"
                          checked={pensionFundTfr === true}
                          onChange={() => setPensionFundTfr(true)}
                          className="text-brand-600 focus:ring-brand-500"
                        />
                        Sì
                      </label>
                      <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name="pensionFundTfr"
                          checked={pensionFundTfr === false}
                          onChange={() => setPensionFundTfr(false)}
                          className="text-brand-600 focus:ring-brand-500"
                        />
                        No
                      </label>
                    </div>
                  </div>

                  {/* Tipologia fondo */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2">Tipologia fondo</label>
                    <select
                      value={pensionFundType}
                      onChange={(e) => setPensionFundType(e.target.value as 'categoria' | 'privato' | '')}
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
          </div>
        </div>

        {/* Messaggi */}
        {error && <div className="mb-4 rounded-lg px-4 py-3 text-sm bg-red-50 text-red-600">{error}</div>}
        {message && <div className="mb-4 rounded-lg px-4 py-3 text-sm bg-green-50 text-green-700">{message}</div>}

        {/* Bottone Salva */}
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Salvataggio…' : 'Salva profilo'}
          </button>
        </div>
      </form>
    </div>
  )
}
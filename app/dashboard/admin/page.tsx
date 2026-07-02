'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'

interface AdminStat {
  user_id: string
  email: string
  created_at: string
  google_sheet_id: string | null
  nome_visualizzato: string | null
  movimenti_count: number
  anni: string
  birth_date: string | null
  employment_status: string | null
  financial_goals: string[] | null
  risk_profile_label: string | null
  risk_profile_score: number | null
}

const EMPLOYMENT_LABELS: Record<string, string> = {
  dipendente: 'Dipendente',
  autonomo: 'Autonomo / Libero professionista',
  imprenditore: 'Imprenditore',
  pensionato: 'Pensionato',
  in_cerca: 'In cerca di occupazione',
  studente: 'Studente',
}

const RISK_COLORS: Record<string, string> = {
  'Conservativo': 'bg-blue-50 text-blue-700',
  'Prudente': 'bg-teal-50 text-teal-700',
  'Bilanciato': 'bg-yellow-50 text-yellow-700',
  'Dinamico': 'bg-orange-50 text-orange-700',
  'Aggressivo': 'bg-red-50 text-red-700',
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function calcAge(birthDate: string) {
  return new Date().getFullYear() - new Date(birthDate).getFullYear()
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-surface-100 last:border-0">
      <span className="text-xs text-gray-400 shrink-0">{label}</span>
      <span className="text-xs text-gray-700 text-right">{value}</span>
    </div>
  )
}

export default function AdminPage() {
  const supabase = createClient()
  const [stats, setStats] = useState<AdminStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [selectedUser, setSelectedUser] = useState<AdminStat | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Non autenticato')

      const { data: profilo } = await supabase
        .from('profili')
        .select('is_admin')
        .eq('user_id', user.id)
        .single()

      if (!profilo?.is_admin) throw new Error('Accesso non autorizzato')

      const { data, error: fnError } = await supabase.rpc('get_admin_stats')
      if (fnError) throw fnError

      setStats(data ?? [])
      setLastRefresh(new Date())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Errore')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const totUtenti = stats.length
  const totFogli = stats.filter(s => s.google_sheet_id).length
  const totMovimenti = stats.reduce((s, r) => s + Number(r.movimenti_count), 0)

  if (loading) return <div className="text-sm text-gray-400 mt-8 text-center">Caricamento…</div>

  if (error) return (
    <div className="max-w-lg mt-8">
      <div className="card bg-red-50 border-red-200">
        <p className="text-sm text-red-700 font-medium">{error}</p>
        {error === 'Accesso non autorizzato' && (
          <p className="text-xs text-red-500 mt-1">
            Assicurati di aver eseguito lo script SQL e impostato is_admin = true per il tuo utente.
          </p>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex gap-6 h-full">

      {/* ===== LISTA UTENTI ===== */}
      <div className={`transition-all duration-300 ${selectedUser ? 'flex-1 min-w-0' : 'w-full'}`}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Admin</h1>
            {lastRefresh && (
              <p className="text-xs text-gray-400 mt-0.5">
                Aggiornato alle {lastRefresh.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <button onClick={load} className="btn-secondary text-xs">↻ Aggiorna</button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Utenti registrati', val: totUtenti, color: 'text-gray-900' },
            { label: 'Fogli collegati', val: totFogli, color: 'text-brand-700' },
            { label: 'Movimenti totali', val: totMovimenti.toLocaleString('it-IT'), color: 'text-gray-900' },
          ].map(c => (
            <div key={c.label} className="card py-3">
              <p className="text-xs text-gray-400 mb-1">{c.label}</p>
              <p className={`text-2xl font-semibold ${c.color}`}>{c.val}</p>
            </div>
          ))}
        </div>

        {/* Users table */}
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-th">Utente</th>
                  <th className="table-th">Registrato</th>
                  <th className="table-th">Nome</th>
                  <th className="table-th">Foglio Google</th>
                  <th className="table-th text-right">Movimenti</th>
                  <th className="table-th">Anni</th>
                  <th className="table-th">Profilo rischio</th>
                </tr>
              </thead>
              <tbody>
                {stats.map(s => (
                  <tr
                    key={s.user_id}
                    onClick={() => setSelectedUser(prev => prev?.user_id === s.user_id ? null : s)}
                    className={`cursor-pointer transition-colors
                      ${selectedUser?.user_id === s.user_id
                        ? 'bg-brand-50'
                        : 'hover:bg-surface-50'}`}
                  >
                    <td className="table-td text-xs font-medium">{s.email}</td>
                    <td className="table-td text-xs text-gray-400">{fmt(s.created_at)}</td>
                    <td className="table-td text-xs text-gray-500">{s.nome_visualizzato ?? '–'}</td>
                    <td className="table-td text-xs">
                      {s.google_sheet_id ? (
                        <a
                          href={`https://docs.google.com/spreadsheets/d/${s.google_sheet_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-600 hover:underline"
                          onClick={e => e.stopPropagation()}
                        >
                          ↗ Apri foglio
                        </a>
                      ) : (
                        <span className="text-gray-300">non collegato</span>
                      )}
                    </td>
                    <td className="table-td text-xs text-right font-medium tabular-nums">
                      {Number(s.movimenti_count).toLocaleString('it-IT')}
                    </td>
                    <td className="table-td text-xs text-gray-400">{s.anni}</td>
                    <td className="table-td text-xs">
                      {s.risk_profile_label ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RISK_COLORS[s.risk_profile_label] ?? 'bg-surface-100 text-gray-600'}`}>
                          {s.risk_profile_label}
                        </span>
                      ) : (
                        <span className="text-gray-300">–</span>
                      )}
                    </td>
                  </tr>
                ))}
                {stats.length === 0 && (
                  <tr>
                    <td colSpan={7} className="table-td text-center text-gray-400 py-8">Nessun utente</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ===== PANNELLO LATERALE PROFILO ===== */}
      {selectedUser && (
        <div className="w-80 shrink-0">
          <div className="card sticky top-6">
            {/* Header pannello */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {selectedUser.nome_visualizzato ?? 'Utente'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{selectedUser.email}</p>
              </div>
              <button
                onClick={() => setSelectedUser(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ×
              </button>
            </div>

            {/* Sezione: Dati personali */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Dati personali</p>
              <DetailRow label="Registrato" value={fmt(selectedUser.created_at)} />
              <DetailRow
                label="Età"
                value={selectedUser.birth_date
                  ? `${calcAge(selectedUser.birth_date)} anni`
                  : '–'}
              />
              <DetailRow
                label="Lavoro"
                value={selectedUser.employment_status
                  ? EMPLOYMENT_LABELS[selectedUser.employment_status] ?? selectedUser.employment_status
                  : '–'}
              />
            </div>

            {/* Sezione: Obiettivi */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Obiettivi finanziari</p>
              {selectedUser.financial_goals && selectedUser.financial_goals.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {selectedUser.financial_goals.map(g => (
                    <span key={g} className="text-xs bg-surface-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {g}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">Non specificati</p>
              )}
            </div>

            {/* Sezione: Profilo rischio */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Profilo di rischio</p>
              {selectedUser.risk_profile_label ? (
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${RISK_COLORS[selectedUser.risk_profile_label] ?? 'bg-surface-100 text-gray-600'}`}>
                    {selectedUser.risk_profile_label}
                  </span>
                  {selectedUser.risk_profile_score && (
                    <span className="text-xs text-gray-400">score: {selectedUser.risk_profile_score}</span>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-400">Non compilato</p>
              )}
            </div>

            {/* Sezione: Dati */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Dati importati</p>
              <DetailRow label="Movimenti" value={Number(selectedUser.movimenti_count).toLocaleString('it-IT')} />
              <DetailRow label="Anni" value={selectedUser.anni} />
              <DetailRow
                label="Foglio Google"
                value={selectedUser.google_sheet_id ? (
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${selectedUser.google_sheet_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 hover:underline"
                  >
                    ↗ Apri foglio
                  </a>
                ) : '–'}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

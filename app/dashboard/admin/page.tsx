'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { RISK_QUESTIONS } from '@/lib/riskQuestionnaire'
import KpiCard from '@/components/ui/KpiCard'
import Drawer from '@/components/ui/Drawer'
import InfoBox from '@/components/ui/InfoBox'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { IconSync } from '@/components/ui/Icons'

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
  has_pension_fund: boolean | null
  pension_fund_tfr: boolean | null
  pension_fund_type: string | null
}

interface AdminDetail {
  risk_answers: Record<string, number> | null
  behavior_label: string | null
  financial_goals_note: string | null
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

function Sezione({ titolo, children }: { titolo: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{titolo}</p>
      {children}
    </div>
  )
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
  const [detail, setDetail] = useState<AdminDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [ricerca, setRicerca] = useState('')
  const [filtroFoglio, setFiltroFoglio] = useState<'tutti' | 'con' | 'senza'>('tutti')

  useEffect(() => {
    if (!selectedUser) { setDetail(null); return }
    let cancelled = false
    setDetailLoading(true)
    supabase.rpc('get_admin_user_detail', { p_user_id: selectedUser.user_id })
      .then(({ data }) => {
        if (cancelled) return
        const row = Array.isArray(data) ? data[0] : data
        setDetail(row ?? null)
        setDetailLoading(false)
      })
    return () => { cancelled = true }
  }, [selectedUser?.user_id])

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

  if (loading) return <div className="flex items-center justify-center h-64 text-sm text-gray-400">Caricamento…</div>

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

  const totRischio = stats.filter(s => s.risk_profile_label).length
  const q = ricerca.trim().toLowerCase()
  const filtrati = stats.filter(s => {
    if (filtroFoglio === 'con' && !s.google_sheet_id) return false
    if (filtroFoglio === 'senza' && s.google_sheet_id) return false
    if (q && !(`${s.email} ${s.nome_visualizzato ?? ''}`.toLowerCase().includes(q))) return false
    return true
  })
  const filtriAttivi = q !== '' || filtroFoglio !== 'tutti'
  const pct = (n: number) => totUtenti > 0 ? `${Math.round((n / totUtenti) * 100)}%` : '0%'
  const Pill = ({ children }: { children: React.ReactNode }) => (
    <span className="inline-flex items-center rounded-full bg-surface-100 text-gray-500 text-[11px] font-medium px-2 py-0.5">{children}</span>
  )

  return (
    <div className="max-w-[1680px] mx-auto flex flex-col gap-4">
      {/* Azioni */}
      <div className="flex items-center justify-end gap-3">
        {lastRefresh && (
          <span className="text-xs text-gray-400">
            Aggiornato alle {lastRefresh.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <button onClick={load} className="btn-secondary inline-flex items-center gap-1.5">
          <IconSync size={16} /> Aggiorna
        </button>
      </div>

      {/* KPI */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard variant="compact" label="Utenti registrati" color="#3f6b4f" delta={null}
          value={String(totUtenti)} badge={<Pill>Totale</Pill>} />
        <KpiCard variant="compact" label="Fogli collegati" color="#2563eb" delta={null}
          value={String(totFogli)} badge={<Pill>{pct(totFogli)} degli utenti</Pill>} />
        <KpiCard variant="compact" label="Movimenti totali" color="#d97706" delta={null}
          value={totMovimenti.toLocaleString('it-IT')} badge={<Pill>Tutti gli utenti</Pill>} />
        <KpiCard variant="compact" label="Profilo di rischio compilato" color="#7c3aed" delta={null}
          value={String(totRischio)} badge={<Pill>{pct(totRischio)} degli utenti</Pill>} />
      </div>

      {/* Tabella utenti */}
      <section className="card p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-surface-100">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Utenti</h2>
            <span className="text-xs text-gray-400">{filtrati.length} di {totUtenti}</span>
            <InfoBox title="Come si usa">
              <p>Cerca per email o nome e filtra per foglio Google collegato.</p>
              <p>Clicca una riga per aprire il dettaglio dell&apos;utente in un pannello laterale.</p>
            </InfoBox>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={ricerca}
              onChange={e => setRicerca(e.target.value)}
              placeholder="Cerca email o nome"
              className="input !w-56"
            />
            <SegmentedControl<'tutti' | 'con' | 'senza'>
              ariaLabel="Filtro foglio"
              options={[{ value: 'tutti', label: 'Tutti' }, { value: 'con', label: 'Con foglio' }, { value: 'senza', label: 'Senza foglio' }]}
              value={filtroFoglio}
              onChange={setFiltroFoglio}
            />
            {filtriAttivi && (
              <button type="button" onClick={() => { setRicerca(''); setFiltroFoglio('tutti') }} className="text-xs text-brand-700 hover:underline">
                Azzera filtri
              </button>
            )}
          </div>
        </div>
        <table className="w-full table-fixed">
          <thead>
            <tr>
              <th className="table-th w-[34%]">Utente</th>
              <th className="table-th">Registrato</th>
              <th className="table-th">Foglio Google</th>
              <th className="table-th text-right">Movimenti</th>
              <th className="table-th">Profilo rischio</th>
            </tr>
          </thead>
          <tbody>
            {filtrati.map(s => (
              <tr
                key={s.user_id}
                onClick={() => setSelectedUser(s)}
                className="cursor-pointer transition-colors hover:bg-surface-50"
              >
                <td className="table-td">
                  <p className="text-xs font-medium text-gray-900 truncate">{s.email}</p>
                  <p className="text-[11px] text-gray-400 truncate">{s.nome_visualizzato ?? '–'}</p>
                </td>
                <td className="table-td text-xs text-gray-500">{fmt(s.created_at)}</td>
                <td className="table-td text-xs">
                  {s.google_sheet_id ? (
                    <span className="rounded-full bg-green-50 text-green-700 text-[11px] font-semibold px-2 py-0.5">Collegato</span>
                  ) : (
                    <span className="text-gray-300">non collegato</span>
                  )}
                </td>
                <td className="table-td text-xs text-right font-medium tabular-nums">
                  {Number(s.movimenti_count).toLocaleString('it-IT')}
                </td>
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
            {filtrati.length === 0 && (
              <tr>
                <td colSpan={5} className="table-td text-center text-gray-400 py-8">Nessun utente</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Dettaglio utente */}
      <Drawer
        open={!!selectedUser}
        onClose={() => setSelectedUser(null)}
        title={selectedUser?.nome_visualizzato ?? 'Utente'}
        subtitle={selectedUser?.email}
      >
        {selectedUser && (
          <>
            <div className="grid grid-cols-3 gap-2 mb-5">
              <div className="rounded-lg bg-surface-50 border border-surface-100 px-3 py-2">
                <p className="text-[11px] text-gray-500">Movimenti</p>
                <p className="text-[13px] font-semibold font-mono tabular-nums">{Number(selectedUser.movimenti_count).toLocaleString('it-IT')}</p>
              </div>
              <div className="rounded-lg bg-surface-50 border border-surface-100 px-3 py-2">
                <p className="text-[11px] text-gray-500">Anni</p>
                <p className="text-[13px] font-semibold">{selectedUser.anni || '–'}</p>
              </div>
              <div className="rounded-lg bg-surface-50 border border-surface-100 px-3 py-2">
                <p className="text-[11px] text-gray-500">Rischio</p>
                <p className="text-[13px] font-semibold truncate">{selectedUser.risk_profile_label ?? '–'}</p>
              </div>
            </div>

            <Sezione titolo="Dati personali">
              <DetailRow label="Registrato" value={fmt(selectedUser.created_at)} />
              <DetailRow label="Età" value={selectedUser.birth_date ? `${calcAge(selectedUser.birth_date)} anni` : '–'} />
              <DetailRow
                label="Lavoro"
                value={selectedUser.employment_status
                  ? EMPLOYMENT_LABELS[selectedUser.employment_status] ?? selectedUser.employment_status
                  : '–'}
              />
            </Sezione>

            <Sezione titolo="Obiettivi finanziari">
              {selectedUser.financial_goals && selectedUser.financial_goals.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {selectedUser.financial_goals.map(g => (
                    <span key={g} className="text-xs bg-surface-100 text-gray-600 px-2 py-0.5 rounded-full">{g}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">Non specificati</p>
              )}
              {detail?.financial_goals_note && (
                <p className="text-xs text-gray-600 mt-2 italic">“{detail.financial_goals_note}”</p>
              )}
            </Sezione>

            <Sezione titolo="Profilo di rischio">
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
              {detailLoading && <p className="text-xs text-gray-300 mt-2">Caricamento risposte…</p>}
              {detail?.risk_answers && (
                <div className="mt-3 space-y-2.5">
                  {detail.behavior_label && <DetailRow label="Comportamento nei crolli" value={detail.behavior_label} />}
                  {RISK_QUESTIONS.map(qu => {
                    const v = detail.risk_answers?.[qu.id]
                    const opt = qu.options.find(o => o.value === v)
                    return (
                      <div key={qu.id} className="rounded-lg bg-surface-50 px-2.5 py-2">
                        <p className="text-[11px] text-gray-400 leading-snug">{qu.label}</p>
                        <p className="text-xs text-gray-800 font-medium mt-0.5">{opt?.label ?? '–'}</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </Sezione>

            <Sezione titolo="Dati importati">
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
            </Sezione>

            <Sezione titolo="Fondo pensione">
              {selectedUser.has_pension_fund === true ? (
                <>
                  <DetailRow label="Ha fondo pensione" value="Sì" />
                  <DetailRow label="Accredito TFR" value={selectedUser.pension_fund_tfr ? 'Sì' : 'No'} />
                  <DetailRow
                    label="Tipologia"
                    value={
                      selectedUser.pension_fund_type === 'categoria' ? 'Di categoria' :
                      selectedUser.pension_fund_type === 'privato' ? 'Privato' : '–'
                    }
                  />
                </>
              ) : selectedUser.has_pension_fund === false ? (
                <DetailRow label="Ha fondo pensione" value="No" />
              ) : (
                <p className="text-xs text-gray-400">Non specificato</p>
              )}
            </Sezione>
          </>
        )}
      </Drawer>
    </div>
  )
}

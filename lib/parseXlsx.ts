import * as XLSX from 'xlsx'
import { Movimento, MESI, CATEGORIE_ENTRATE } from '@/types'

const MESI_SET = new Set(MESI as unknown as string[])
const CAT_ENTRATE = new Set(CATEGORIE_ENTRATE)

function parseAmt(val: unknown): number {
  if (val === null || val === undefined || val === '') return 0
  const n = parseFloat(String(val).replace(',', '.'))
  return isNaN(n) ? 0 : Math.abs(n)
}

function parseDate(val: unknown): string {
  if (!val) return ''
  if (typeof val === 'number' && val > 40000) {
    const d = new Date((val - 25569) * 86400 * 1000)
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }
  return String(val)
}

export function parseMovimentiSheet(file: ArrayBuffer, anno: number): Movimento[] {
  const wb = XLSX.read(file, { type: 'array', cellDates: false })
  const ws = wb.Sheets['movimenti conto']
  if (!ws) throw new Error('Foglio "movimenti conto" non trovato')

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: '',
    raw: true,
  })

  const movimenti: Movimento[] = []
  let secondTableStart = -1

  for (let i = 0; i < raw.length; i++) {
    if (String(raw[i]['MESE'] ?? '').toUpperCase() === 'MESE' && i > 0) {
      secondTableStart = i + 1
      break
    }
  }

  function parseRows(rows: Record<string, unknown>[], defaultComponente: string) {
    for (const row of rows) {
      const mese = String(row['MESE'] ?? '').toLowerCase().trim()
      if (!mese || !MESI_SET.has(mese)) continue

      const cat = String(row['CATEGORIA'] ?? '').trim().toUpperCase()
      const entrate = parseAmt(row['Entrate'] ?? row['ENTRATE'])
      const uscite  = parseAmt(row['Uscite']  ?? row['USCITE'])
      if (entrate === 0 && uscite === 0) continue

      const isEntrata = CAT_ENTRATE.has(cat)
      const componente = String(row['COMPONENTE'] ?? row['Componente'] ?? '').trim() || defaultComponente

      movimenti.push({
        mese,
        data_operazione: parseDate(row['Data operazione'] ?? row['DATA OPERAZIONE']),
        descrizione: String(row['Descrizione'] ?? row['DESCRIZIONE'] ?? '').trim().slice(0, 200),
        entrate: isEntrata ? entrate : 0,
        uscite: !isEntrata ? uscite : 0,
        categoria: cat,
        sottocategoria: String(row['SOTTOCATEGORIA'] ?? '').trim(),
        nome_etf: String(row['nome ETF'] ?? row['NOME ETF'] ?? '').trim(),
        componente,
        anno,
      })
    }
  }

  const table1 = secondTableStart > 0 ? raw.slice(0, secondTableStart - 1) : raw
  const table2 = secondTableStart > 0 ? raw.slice(secondTableStart) : []
  parseRows(table1, '')
  parseRows(table2, '')

  return movimenti
}

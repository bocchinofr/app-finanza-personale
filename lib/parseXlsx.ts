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
  if (val instanceof Date) {
    return val.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }
  return String(val)
}

export function parseMovimentiSheet(file: ArrayBuffer, anno: number): Movimento[] {
  const wb = XLSX.read(file, { type: 'array', cellDates: false })
  const ws = wb.Sheets['movimenti conto']
  if (!ws) throw new Error('Foglio "movimenti conto" non trovato')

  // Legge il foglio come matrice grezza: NON assume che l'intestazione sia in riga 1
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: '',
    raw: true,
  })

  // Trova ogni riga di intestazione cercando "MESE" in colonna A, a qualunque riga si trovi
  const headerRows: number[] = []
  for (let i = 0; i < matrix.length; i++) {
    if (String(matrix[i]?.[0] ?? '').trim().toUpperCase() === 'MESE') {
      headerRows.push(i)
    }
  }
  if (headerRows.length === 0) {
    throw new Error('Intestazione "MESE" non trovata nel foglio "movimenti conto"')
  }

  const movimenti: Movimento[] = []

  function processBlock(headerRowIdx: number, endRow: number) {
    const header = (matrix[headerRowIdx] as unknown[]).map(h =>
      String(h ?? '').trim().toUpperCase()
    )
    const col = (name: string) => header.indexOf(name)

    const iMese = col('MESE')
    const iData = col('DATA OPERAZIONE')
    const iDesc = col('DESCRIZIONE')
    const iEnt  = col('ENTRATE')
    const iUsc  = col('USCITE')
    const iCat  = col('CATEGORIA')
    const iSub  = col('SOTTOCATEGORIA')
    const iEtf  = col('NOME ETF')
    const iComp = col('COMPONENTE')

    for (let r = headerRowIdx + 1; r < endRow; r++) {
      const row = matrix[r] as unknown[]
      if (!row || row.length === 0) continue

      const mese = String(row[iMese] ?? '').toLowerCase().trim()
      if (!mese || !MESI_SET.has(mese)) continue

      const cat = String(row[iCat] ?? '').trim().toUpperCase()
      const entrate = parseAmt(row[iEnt])
      const uscite  = parseAmt(row[iUsc])
      if (entrate === 0 && uscite === 0) continue

      const isEntrata = CAT_ENTRATE.has(cat)
      const componente = iComp >= 0 ? String(row[iComp] ?? '').trim() : ''

      movimenti.push({
        mese,
        data_operazione: parseDate(row[iData]),
        descrizione: String(row[iDesc] ?? '').trim().slice(0, 200),
        entrate: isEntrata ? entrate : 0,
        uscite: !isEntrata ? uscite : 0,
        categoria: cat,
        sottocategoria: String(row[iSub] ?? '').trim(),
        nome_etf: String(row[iEtf] ?? '').trim(),
        componente,
        anno,
      })
    }
  }

  // Gestisce automaticamente una o più tabelle (intestazioni ripetute)
  for (let t = 0; t < headerRows.length; t++) {
    const start = headerRows[t]
    const end = t + 1 < headerRows.length ? headerRows[t + 1] : matrix.length
    processBlock(start, end)
  }

  return movimenti
}
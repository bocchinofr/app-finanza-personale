import { Movimento, MESI, CATEGORIE_ENTRATE, CATEGORIE_INVESTIMENTI } from '@/types'

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++ }
      else if (ch === '"') { inQuotes = false }
      else { field += ch }
    } else {
      if (ch === '"') { inQuotes = true }
      else if (ch === ',') { row.push(field); field = '' }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else if (ch !== '\r') { field += ch }
    }
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

const MESI_SET = new Set(MESI as unknown as string[])
const CAT_ENTRATE = new Set(CATEGORIE_ENTRATE)
const CAT_INV = new Set(CATEGORIE_INVESTIMENTI)

function parseAmt(v: string): number {
  if (!v) return 0
  const n = parseFloat(v.replace(',', '.').replace(/[^\d.-]/g, ''))
  return isNaN(n) ? 0 : Math.abs(n)
}

function parseDate(v: string): string {
  if (!v) return ''
  const n = Number(v)
  if (!isNaN(n) && n > 40000) {
    const d = new Date((n - 25569) * 86400 * 1000)
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }
  return v
}

export function parseMovimentiCsv(csvText: string, anno: number): Movimento[] {
  const rows = parseCsv(csvText)
  if (rows.length < 2) return []

  const headerIndexes: number[] = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0]?.toUpperCase().trim() === 'MESE') headerIndexes.push(i)
  }
  if (headerIndexes.length === 0) return []

  const movimenti: Movimento[] = []

  function processBlock(startRow: number, endRow: number, defaultPersona: Persona) {
    const header = rows[startRow].map(h => h.trim().toUpperCase())
    const col = (name: string) => header.indexOf(name)

    const iMese = col('MESE')
    const iData = col('DATA OPERAZIONE')
    const iDesc = col('DESCRIZIONE')
    const iEnt  = col('ENTRATE')
    const iUsc  = col('USCITE')
    const iCat  = col('CATEGORIA')
    const iSub  = col('SOTTOCATEGORIA')
    const iEtf  = col('NOME ETF')

    for (let r = startRow + 1; r < endRow; r++) {
      const row = rows[r]
      if (!row || row.length < 3) continue
      const mese = (row[iMese] ?? '').toLowerCase().trim()
      if (!mese || !MESI_SET.has(mese)) continue

      const cat = (row[iCat] ?? '').trim().toUpperCase()
      const entrate = parseAmt(row[iEnt] ?? '')
      const uscite  = parseAmt(row[iUsc] ?? '')
      if (entrate === 0 && uscite === 0) continue

      const isEntrata = CAT_ENTRATE.has(cat)

      let persona: Persona = defaultPersona
      if (cat === 'STIPENDIO G') persona = 'G'
      else if (cat === 'STIPENDIO F') persona = 'F'

      movimenti.push({
        mese,
        data_operazione: parseDate(row[iData] ?? ''),
        descrizione: (row[iDesc] ?? '').trim().slice(0, 200),
        entrate: isEntrata ? entrate : 0,
        uscite: !isEntrata ? uscite : 0,
        categoria: cat,
        sottocategoria: (row[iSub] ?? '').trim(),
        nome_etf: (row[iEtf] ?? '').trim(),
        persona,
        anno,
      })
    }
  }

  type Persona = 'G' | 'F'

  const end1 = headerIndexes.length > 1 ? headerIndexes[1] : rows.length
  processBlock(headerIndexes[0], end1, 'G')
  if (headerIndexes.length > 1) {
    processBlock(headerIndexes[1], rows.length, 'F')
  }

  return movimenti
}

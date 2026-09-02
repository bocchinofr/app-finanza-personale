import { Movimento, MESI, CATEGORIE_ENTRATE } from '@/types'


// Cerca la riga di intestazione: la prima riga che contiene almeno 2 delle colonne attese.
// Necessario perché i template hanno righe di avviso/istruzioni sopra l'intestazione reale,
// e la posizione può variare da foglio a foglio (es. riga 2 per Liquidità, riga 3 per gli altri).
function findHeaderRow(rows: string[][], expectedCols: string[]): number {
  for (let i = 0; i < rows.length; i++) {
    const header = (rows[i] ?? []).map(h => (h ?? '').trim().toUpperCase())
    const matches = expectedCols.filter(c => header.includes(c)).length
    if (matches >= Math.min(2, expectedCols.length)) return i
  }
  return -1
}

const MESI_SET = new Set(MESI as unknown as string[])
const CAT_ENTRATE = new Set(CATEGORIE_ENTRATE)

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

/**
 * Parsa il foglio "Movimenti conto". Supporta:
 * - una singola tabella continua con colonna opzionale COMPONENTE
 * - oppure due tabelle separate da un'intestazione ripetuta (formato legacy G/F),
 *   in tal caso usa "Gruppo 1" / "Gruppo 2" come componente di default se la
 *   colonna COMPONENTE non è presente.
 */
export function parseMovimentiCsv(rows: string[][], anno: number): Movimento[] {
  if (rows.length < 2) return []

  const headerIndexes: number[] = []

  for (let i = 0; i < rows.length; i++) {
    if ((rows[i][0] ?? '').toUpperCase().trim() === 'MESE') {
      headerIndexes.push(i)
    }
  }

  if (headerIndexes.length === 0) return []

  const movimenti: Movimento[] = []

  function processBlock(startRow: number, endRow: number, defaultComponente: string) {
    const header = rows[startRow].map(h => (h ?? '').trim().toUpperCase())
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
      const componente = iComp >= 0 ? (row[iComp] ?? '').trim() : defaultComponente

      movimenti.push({
        mese,
        data_operazione: parseDate(row[iData] ?? ''),
        descrizione: (row[iDesc] ?? '').trim().slice(0, 200),
        entrate: isEntrata ? entrate : 0,
        uscite: !isEntrata ? uscite : 0,
        categoria: cat,
        sottocategoria: (row[iSub] ?? '').trim(),
        nome_etf: (row[iEtf] ?? '').trim(),
        componente,
        anno,
      })
    }
  }

  const end1 = headerIndexes.length > 1 ? headerIndexes[1] : rows.length
  processBlock(headerIndexes[0], end1, '')

  if (headerIndexes.length > 1) {
    processBlock(headerIndexes[1], rows.length, '')
  }

  return movimenti
}


// ============================================================
// Parser foglio Liquidità
// ============================================================
import { Liquidita, AssetPortafoglio, FondoPensione } from '@/types'


export function parseLiquiditaCsv(rows: string[][]): Liquidita[] {
  if (rows.length < 2) return []

  const headerIdx = findHeaderRow(rows, ['ANNO', 'MESE', 'CONTO', 'SALDO'])
  if (headerIdx === -1) return []

  const header = rows[headerIdx].map(h => (h ?? '').trim().toUpperCase())
  const col = (name: string) => header.indexOf(name)

  const iAnno  = col('ANNO')
  const iMese  = col('MESE')
  const iConto = col('CONTO')
  const iSaldo = col('SALDO')

  const result: Liquidita[] = []

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row) continue

    const anno = parseInt(row[iAnno] ?? '')
    const mese = (row[iMese] ?? '').toLowerCase().trim()
    const conto = (row[iConto] ?? '').trim()
    const saldo = parseAmt(row[iSaldo] ?? '')

    if (!anno || !mese || !conto) continue

    result.push({ anno, mese, conto, saldo })
  }

  return result
}

export function parseFondoPensioneCsv(rows: string[][]): FondoPensione[] {
  if (rows.length < 2) return []

  const headerIdx = findHeaderRow(rows, ['ANNO', 'MESE', 'FONDO', 'SALDO'])
  if (headerIdx === -1) return []

  const header = rows[headerIdx].map(h => (h ?? '').trim().toUpperCase())
  const col = (name: string) => header.indexOf(name)

  const iAnno      = col('ANNO')
  const iMese      = col('MESE')
  const iFondo     = col('FONDO')
  const iSaldo     = col('SALDO')
  const iInteressi = col('INTERESSI')

  const result: FondoPensione[] = []

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row) continue

    const anno = parseInt(row[iAnno] ?? '')
    const mese = (row[iMese] ?? '').toLowerCase().trim()
    const fondo = (row[iFondo] ?? '').trim()
    const saldo = parseAmt(row[iSaldo] ?? '')
    const interessiRaw = (row[iInteressi] ?? '').trim()
    const interessi = interessiRaw
      ? (parseFloat(interessiRaw.replace(',', '.').replace(/[^\d.-]/g, '')) || 0)
      : 0

    if (!anno || !mese || !fondo) continue

    result.push({ anno, mese, fondo, saldo, interessi })
  }

  return result
}

// ============================================================
// Parser foglio Anagrafica Portafoglio
// ============================================================
export function parsePortafoglioCsv(rows: string[][]): AssetPortafoglio[] {
  if (rows.length < 2) return []

  const headerIdx = findHeaderRow(rows, ['ASSET', 'TICKER', 'ISIN', 'DESCRIZIONE'])
  if (headerIdx === -1) return []

  const header = rows[headerIdx].map(h => (h ?? '').trim().toUpperCase())
  const col = (name: string) => header.indexOf(name)

  const iAsset   = col('ASSET')
  const iDesc    = col('DESCRIZIONE')
  const iTicker  = col('TICKER')
  const iIsin    = col('ISIN')
  const iNome    = col('NOME')
  const iData    = col('DATA ACQUISTO')
  const iPrezzo  = col('PREZZO ACQUISTO')
  const iQta     = col('QUANTITÀ') !== -1 ? col('QUANTITÀ') : col('QUANTITA')
  const iPac     = col('PAC (S/N)') !== -1 ? col('PAC (S/N)') : col('PAC')
  const iPacVers = col('PAC VERSAMENTO')

  const result: AssetPortafoglio[] = []

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row) continue

    const asset = (row[iAsset] ?? '').trim()
    if (!asset) continue

    result.push({
      asset,
      descrizione: (row[iDesc] ?? '').trim(),
      ticker: (row[iTicker] ?? '').trim(),
      isin: (row[iIsin] ?? '').trim(),
      nome: (row[iNome] ?? '').trim(),
      data_acquisto: parseDate(row[iData] ?? ''),
      prezzo_acquisto: parseAmt(row[iPrezzo] ?? ''),
      quantita: parseAmt(row[iQta] ?? ''),
      pac: (row[iPac] ?? '').trim().toUpperCase() === 'S',
      pac_versamento: parseAmt(row[iPacVers] ?? ''),
    })
  }

  return result
}
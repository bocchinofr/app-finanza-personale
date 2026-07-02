import { NextRequest, NextResponse } from 'next/server'

const SHEET_ID_PATTERN = /^[a-zA-Z0-9_-]{20,80}$/
const ALLOWED_SHEETS = ['Movimenti conto', 'Liquidità', 'Anagrafica Portafoglio']

function buildCsvUrl(sheetId: string, sheetName: string) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
}

export async function GET(req: NextRequest) {
  const sheetId   = req.nextUrl.searchParams.get('sheetId')
  const sheetName = req.nextUrl.searchParams.get('sheet') ?? 'Movimenti conto'

  if (!sheetId) return NextResponse.json({ error: 'Parametro sheetId mancante' }, { status: 400 })
  if (!SHEET_ID_PATTERN.test(sheetId)) return NextResponse.json({ error: 'sheetId non valido' }, { status: 400 })
  if (!ALLOWED_SHEETS.includes(sheetName)) return NextResponse.json({ error: 'Foglio non consentito' }, { status: 400 })

  try {
    const res = await fetch(buildCsvUrl(sheetId, sheetName), { cache: 'no-store' })
    if (!res.ok) {
      return NextResponse.json({ error: `Google Sheets ha risposto con ${res.status}` }, { status: 502 })
    }
    const csv = await res.text()
    if (csv.trim().startsWith('<')) {
      return NextResponse.json({ error: 'Foglio non accessibile o nome foglio errato.' }, { status: 404 })
    }
    return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } })
  } catch (err) {
    console.error('sync-sheets error:', err)
    return NextResponse.json({ error: 'Errore nel recupero del foglio' }, { status: 500 })
  }
}

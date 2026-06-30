import { NextRequest, NextResponse } from 'next/server'

const SPREADSHEET_ID = '1IBO4KSWopaS7TG0cLdPC83rmEHGxOiSda4AtP6AsQJg'

const SHEETS = [
  'movimenti conto',
  'ChashFlow',
]

function buildCsvUrl(sheet: string) {
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`
}

export async function GET(req: NextRequest) {
  const sheet = req.nextUrl.searchParams.get('sheet') ?? 'movimenti conto'

  if (!SHEETS.includes(sheet)) {
    return NextResponse.json({ error: 'Foglio non consentito' }, { status: 400 })
  }

  try {
    const res = await fetch(buildCsvUrl(sheet), {
      next: { revalidate: 300 }, // cache 5 min server-side
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: `Google Sheets ha risposto con ${res.status}` },
        { status: 502 }
      )
    }

    const csv = await res.text()
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      },
    })
  } catch (err) {
    console.error('sync-sheets error:', err)
    return NextResponse.json({ error: 'Errore nel recupero del foglio' }, { status: 500 })
  }
}

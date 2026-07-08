import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
})

const sheets = google.sheets({ version: 'v4', auth })

const SHEET_ID_PATTERN = /^[a-zA-Z0-9_-]{20,80}$/
const ALLOWED_SHEETS = ['Movimenti conto', 'Liquidità', 'Anagrafica Portafoglio']

function buildCsvUrl(sheetId: string, sheetName: string) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=tsv&sheet=${encodeURIComponent(sheetName)}`
}

export async function GET(req: NextRequest) {
  try {
    const sheetId = req.nextUrl.searchParams.get('sheetId')
    const sheetName = req.nextUrl.searchParams.get('sheet') ?? 'Movimenti conto'

    if (!sheetId) {
      return NextResponse.json({ error: 'Parametro sheetId mancante' }, { status: 400 })
    }

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: sheetName, // <-- QUI NON serve nemmeno l'apice
    })

    return NextResponse.json(res.data.values ?? [])
  } catch (err: unknown) {
    console.error('google sheets error full:', err);
    const message =
      err instanceof Error ? err.message : 'Errore lettura Google Sheets';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
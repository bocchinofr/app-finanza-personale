'use client'
import { createContext, useContext, useState, ReactNode } from 'react'

const ANNI_DISPONIBILI = [2024, 2025, 2026]

type AnnoContextType = {
  anno: number
  setAnno: (anno: number) => void
  anniDisponibili: number[]
}

const AnnoContext = createContext<AnnoContextType | undefined>(undefined)

export function AnnoProvider({ children }: { children: ReactNode }) {
  const [anno, setAnno] = useState(2026)

  return (
    <AnnoContext.Provider value={{ anno, setAnno, anniDisponibili: ANNI_DISPONIBILI }}>
      {children}
    </AnnoContext.Provider>
  )
}

export function useAnno() {
  const ctx = useContext(AnnoContext)
  if (!ctx) throw new Error('useAnno deve essere usato dentro AnnoProvider')
  return ctx
}

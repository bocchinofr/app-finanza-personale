// components/fire/DebitiEditor.tsx
"use client";

import { useState } from "react";
import type { Debito } from "@/lib/fireCalculations";

interface DebitiEditorProps {
  debiti: Debito[];
  onChange: (debiti: Debito[]) => void;
}

function nuovoDebitoVuoto(): Debito {
  return {
    id: crypto.randomUUID(),
    nome: "",
    rataAnnua: 0,
    annoEstinzione: new Date().getFullYear() + 1,
  };
}

export default function DebitiEditor({ debiti, onChange }: DebitiEditorProps) {
  const [nuovo, setNuovo] = useState<Debito>(nuovoDebitoVuoto());

  function aggiungiDebito() {
    if (!nuovo.nome.trim() || nuovo.rataAnnua <= 0) return;
    onChange([...debiti, nuovo]);
    setNuovo(nuovoDebitoVuoto());
  }

  function rimuoviDebito(id: string) {
    onChange(debiti.filter((d) => d.id !== id));
  }

  function aggiornaDebito(id: string, campo: keyof Debito, valore: string | number) {
    onChange(
      debiti.map((d) => (d.id === id ? { ...d, [campo]: valore } : d))
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-500">
        Rate incluse nelle spese attuali che verranno rimosse dall&apos;anno di estinzione
        (es. mutuo). L&apos;importo liberato riduce solo le spese, non aumenta
        automaticamente l&apos;investimento.
      </p>

      {debiti.length > 0 && (
        <div className="space-y-2">
          {debiti.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white/60 p-3"
            >
              <input
                type="text"
                value={d.nome}
                onChange={(e) => aggiornaDebito(d.id, "nome", e.target.value)}
                placeholder="Nome (es. Mutuo casa)"
                className="min-w-[140px] flex-1 rounded-md border border-stone-200 px-2 py-1 text-sm"
              />
              <div className="flex items-center gap-1 text-sm text-stone-500">
                <span>Rata annua €</span>
                <input
                  type="number"
                  value={d.rataAnnua}
                  onChange={(e) =>
                    aggiornaDebito(d.id, "rataAnnua", Number(e.target.value))
                  }
                  className="w-28 rounded-md border border-stone-200 px-2 py-1 text-sm"
                />
              </div>
              <div className="flex items-center gap-1 text-sm text-stone-500">
                <span>Estinto entro</span>
                <input
                  type="number"
                  value={d.annoEstinzione}
                  onChange={(e) =>
                    aggiornaDebito(d.id, "annoEstinzione", Number(e.target.value))
                  }
                  className="w-24 rounded-md border border-stone-200 px-2 py-1 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => rimuoviDebito(d.id)}
                className="ml-auto text-sm text-red-500 hover:text-red-700"
                aria-label={`Rimuovi ${d.nome}`}
              >
                Rimuovi
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-stone-300 p-3">
        <input
          type="text"
          value={nuovo.nome}
          onChange={(e) => setNuovo({ ...nuovo, nome: e.target.value })}
          placeholder="Nome debito"
          className="min-w-[140px] flex-1 rounded-md border border-stone-200 px-2 py-1 text-sm"
        />
        <input
          type="number"
          value={nuovo.rataAnnua || ""}
          onChange={(e) => setNuovo({ ...nuovo, rataAnnua: Number(e.target.value) })}
          placeholder="Rata annua €"
          className="w-28 rounded-md border border-stone-200 px-2 py-1 text-sm"
        />
        <input
          type="number"
          value={nuovo.annoEstinzione}
          onChange={(e) =>
            setNuovo({ ...nuovo, annoEstinzione: Number(e.target.value) })
          }
          className="w-24 rounded-md border border-stone-200 px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={aggiungiDebito}
          className="rounded-md bg-emerald-700 px-3 py-1 text-sm text-white hover:bg-emerald-800"
        >
          + Aggiungi
        </button>
      </div>
    </div>
  );
}

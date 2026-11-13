'use client'

import { useState } from 'react'
import CitaAcciones from '@/components/crm/CitaAcciones'
import type { CitaFilaVista } from '@/components/crm/CitasLista'

export type DiaAgenda = {
  fecha: string
  etiqueta: string
  feriado: boolean
  franjas: string[]
  bloqueos: string[]
  citas: CitaFilaVista[]
}

/** Semana de un abogado: franjas, bloqueos y citas por día. Al elegir una cita se habilitan sus acciones. */
export default function AgendaSemana({ dias }: { dias: DiaAgenda[] }) {
  const [sel, setSel] = useState<string | null>(null)
  const todas = dias.flatMap((d) => d.citas)
  const seleccionada = todas.find((c) => c.id === sel) ?? null

  return (
    <div className="space-y-4">
      <p aria-live="polite" className="font-montserrat text-xs text-text-muted">
        {seleccionada ? `Seleccionada: ${seleccionada.fecha} ${seleccionada.hora}${seleccionada.codigo ? ` · ${seleccionada.codigo}` : ''}` : 'Ninguna cita seleccionada'}
      </p>
      <CitaAcciones cita={seleccionada} onCambio={() => setSel(null)} />

      <div className="grid gap-3 md:grid-cols-7">
        {dias.map((d) => (
          <section key={d.fecha} aria-label={d.etiqueta} className="min-w-0 border border-border bg-card-bg">
            <h2 className="border-b border-border px-3 py-2 font-montserrat text-[10px] uppercase tracking-widest text-gold/80">{d.etiqueta}</h2>
            <div className="space-y-2 px-3 py-3 font-montserrat text-xs">
              {d.feriado && <p className="text-text-muted">Feriado</p>}
              {!d.feriado && d.franjas.length === 0 && <p className="text-text-muted/70">Sin horario</p>}
              {!d.feriado && d.franjas.length > 0 && <p className="text-text-muted">Atiende: {d.franjas.join(', ')}</p>}
              {d.bloqueos.map((b) => <p key={b} className="text-text-muted">Bloqueo: {b}</p>)}
              {d.citas.length === 0 && <p className="text-text-muted/70">Sin citas</p>}
              <ul className="space-y-1.5">
                {d.citas.map((c) => {
                  const activa = c.id === sel
                  const terminada = c.estado !== 'pendiente' && c.estado !== 'confirmada'
                  return (
                    <li
                      key={c.id}
                      tabIndex={0}
                      aria-current={activa ? 'true' : undefined}
                      title={`${c.hora} · ${c.nombre} · ${c.estado_etiqueta}`}
                      onClick={() => setSel(activa ? null : c.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(activa ? null : c.id) } }}
                      className={`focus-gold cursor-pointer truncate border px-2 py-1.5 outline-none ${activa ? 'border-gold bg-gold/10' : 'border-border hover:border-gold/40'} ${terminada ? 'text-text-muted/70' : 'text-text-light'}`}
                    >
                      <span className="text-gold">{c.hora}</span> {c.codigo ?? c.nombre}
                      <span className="block truncate text-[10px] text-text-muted">{c.estado_etiqueta}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

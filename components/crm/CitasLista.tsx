'use client'

import { useState } from 'react'
import CitaAcciones, { type CitaAccionable } from '@/components/crm/CitaAcciones'

export type CitaFilaVista = CitaAccionable & {
  nombre: string
  estado_etiqueta: string
  motivo_cancelacion: string | null
}

const fechaLarga = new Intl.DateTimeFormat('es-EC', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
export const formatoDia = (f: string) => fechaLarga.format(new Date(`${f}T12:00:00Z`))

/**
 * Lista de citas con selección (clic o Enter/Espacio) y la barra de acciones debajo. Volver a hacer clic
 * deselecciona. Se usa en la pestaña «Citas» del caso y en «Citas sin abogado» de la Agenda.
 */
export default function CitasLista({ citas, vacio, mostrarCaso = false }: { citas: CitaFilaVista[]; vacio: React.ReactNode; mostrarCaso?: boolean }) {
  const [sel, setSel] = useState<string | null>(null)
  const seleccionada = citas.find((c) => c.id === sel) ?? null

  if (citas.length === 0) return <p className="font-montserrat text-xs text-text-muted">{vacio}</p>

  return (
    <div className="space-y-4">
      <p aria-live="polite" className="font-montserrat text-xs text-text-muted">
        {seleccionada ? `Seleccionada: ${formatoDia(seleccionada.fecha)} ${seleccionada.hora}` : 'Ninguna cita seleccionada'}
      </p>
      <CitaAcciones cita={seleccionada} onCambio={() => setSel(null)} />
      <ul className="divide-y divide-border border border-border bg-card-bg">
        {citas.map((c) => {
          const activa = c.id === sel
          return (
            <li
              key={c.id}
              tabIndex={0}
              aria-current={activa ? 'true' : undefined}
              onClick={() => setSel(activa ? null : c.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(activa ? null : c.id) } }}
              className={`focus-gold cursor-pointer px-5 py-3 font-montserrat text-xs outline-none ${activa ? 'bg-gold/10' : 'hover:bg-white/5'}`}
            >
              <p className="text-text-light">
                <span className="text-gold">{formatoDia(c.fecha)} · {c.hora}</span>
                {' · '}{c.abogado ?? 'Sin abogado'}
                {mostrarCaso && c.codigo ? ` · ${c.codigo}` : ''}
              </p>
              <p className="mt-1 text-text-muted">
                {c.estado_etiqueta}{c.nombre ? ` · ${c.nombre}` : ''}
                {c.motivo_cancelacion ? ` · Motivo: ${c.motivo_cancelacion}` : ''}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

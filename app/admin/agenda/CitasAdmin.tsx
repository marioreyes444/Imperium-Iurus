'use client'

import { useState } from 'react'

/** Estados de una cita. `atendida` y `no_asistio` existen desde la migración M5 (CRM). */
export type CitaEstadoAdmin = 'pendiente' | 'confirmada' | 'cancelada' | 'atendida' | 'no_asistio'

export type Cita = {
  id: string
  nombre: string
  correo: string
  telefono: string
  tipo_consulta: string
  fecha: string
  hora: string
  mensaje: string | null
  estado: CitaEstadoAdmin
  created_at: string
  motivo_cancelacion?: string | null
}

const ESTADO_STYLES: Record<CitaEstadoAdmin, string> = {
  pendiente:  'border-yellow-500/50 bg-yellow-500/10 text-yellow-400',
  confirmada: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400',
  cancelada:  'border-red-500/50 bg-red-500/10 text-red-400',
  atendida:   'border-sky-500/50 bg-sky-500/10 text-sky-400',
  no_asistio: 'border-gold/30 bg-gold/5 text-gold/70',
}

const ESTADO_LABEL: Record<CitaEstadoAdmin, string> = {
  pendiente:  'pendiente',
  confirmada: 'confirmada',
  cancelada:  'cancelada',
  atendida:   'atendida',
  no_asistio: 'no asistió',
}

const TIPO_STYLES: Record<string, string> = {
  personal:    'border-sky-500/50 bg-sky-500/10 text-sky-400',
  empresarial: 'border-purple-500/50 bg-purple-500/10 text-purple-400',
  urgencia:    'border-red-500/50 bg-red-500/10 text-red-400',
}

const TIPO_LABEL: Record<string, string> = {
  personal:    'Personal',
  empresarial: 'Empresarial',
  urgencia:    'Urgencia',
}

const ESTADOS: CitaEstadoAdmin[] = ['pendiente', 'confirmada', 'cancelada', 'atendida', 'no_asistio']
/** Solo una cita activa cambia de estado; una cancelada o concluida no se reactiva (R-38). */
const ACTIVOS: CitaEstadoAdmin[] = ['pendiente', 'confirmada']

const ORIGENES = [
  { valor: 'cliente', etiqueta: 'El cliente' },
  { valor: 'estudio', etiqueta: 'El estudio' },
  { valor: 'abogado', etiqueta: 'El abogado' },
]

function formatFecha(fecha: string, hora: string) {
  const [y, mo, d] = fecha.split('-')
  return `${d}/${mo}/${y} · ${hora.slice(0, 5)}`
}

export default function CitasAdmin({ citas: initial }: { citas: Cita[] }) {
  const [prevInitial, setPrevInitial] = useState(initial)
  const [citas, setCitas] = useState<Cita[]>(initial)
  const [updating, setUpdating] = useState<string | null>(null)
  const [filter, setFilter] = useState<CitaEstadoAdmin | 'todas'>('todas')
  // Cancelación: panel dentro de la tarjeta (motivo y origen), sin modales.
  const [cancelando, setCancelando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [origen, setOrigen] = useState('')
  const [error, setError] = useState<{ id: string; texto: string } | null>(null)

  // Si Next.js vuelve a renderizar esta página con datos frescos del servidor
  // (ej. tras navegar y volver), esto refresca la lista sin perder el filtro activo.
  if (initial !== prevInitial) {
    setPrevInitial(initial)
    setCitas(initial)
  }

  async function changeEstado(id: string, estado: 'pendiente' | 'confirmada') {
    setUpdating(id)
    setError(null)
    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado }),
      })
      if (res.ok) {
        setCitas((prev) => prev.map((c) => c.id === id ? { ...c, estado } : c))
      } else {
        const cuerpo = await res.json().catch(() => ({}))
        setError({ id, texto: typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo actualizar la cita.' })
      }
    } finally {
      setUpdating(null)
    }
  }

  function abrirCancelar(id: string) {
    setCancelando(id)
    setMotivo('')
    setOrigen('')
    setError(null)
  }

  async function cancelar(id: string) {
    if (motivo.trim().length < 5 || !origen) {
      setError({ id, texto: 'Indica quién cancela y el motivo (mínimo 5 caracteres).' })
      return
    }
    setUpdating(id)
    setError(null)
    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: motivo.trim(), origen }),
      })
      if (res.ok) {
        setCitas((prev) => prev.map((c) => c.id === id ? { ...c, estado: 'cancelada', motivo_cancelacion: motivo.trim() } : c))
        setCancelando(null)
      } else {
        const cuerpo = await res.json().catch(() => ({}))
        setError({ id, texto: typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo cancelar la cita.' })
      }
    } finally {
      setUpdating(null)
    }
  }

  const visible = filter === 'todas' ? citas : citas.filter((c) => c.estado === filter)

  const counts: Record<CitaEstadoAdmin | 'todas', number> = {
    todas: citas.length,
    pendiente:  citas.filter((c) => c.estado === 'pendiente').length,
    confirmada: citas.filter((c) => c.estado === 'confirmada').length,
    cancelada:  citas.filter((c) => c.estado === 'cancelada').length,
    atendida:   citas.filter((c) => c.estado === 'atendida').length,
    no_asistio: citas.filter((c) => c.estado === 'no_asistio').length,
  }

  return (
    <div>
      {/* Filtros */}
      <div className="mb-6 flex flex-wrap gap-2">
        {(['todas', ...ESTADOS] as const).map((f) => (
          <button
            type="button"
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-4 py-1.5 font-montserrat text-xs uppercase tracking-widest transition-colors ${
              filter === f
                ? 'border-gold bg-gold text-primary'
                : 'border-gold/30 text-gold/70 hover:border-gold hover:text-gold'
            }`}
          >
            {f === 'todas' ? 'Todas' : ESTADO_LABEL[f]} ({counts[f]})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="py-16 text-center font-light text-text-muted">
          No hay citas {filter !== 'todas' ? `con estado "${ESTADO_LABEL[filter]}"` : ''}.
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((cita) => {
            const activa = ACTIVOS.includes(cita.estado)
            return (
              <div
                key={cita.id}
                className="border border-border bg-card-bg p-5 transition-colors hover:border-gold/30"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  {/* Info principal */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${TIPO_STYLES[cita.tipo_consulta] ?? 'border-gold/30 text-gold'}`}>
                        {TIPO_LABEL[cita.tipo_consulta] ?? cita.tipo_consulta}
                      </span>
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${ESTADO_STYLES[cita.estado] ?? ESTADO_STYLES.pendiente}`}>
                        {ESTADO_LABEL[cita.estado] ?? cita.estado}
                      </span>
                    </div>
                    <p className="mt-2 font-cinzel text-base font-semibold text-text-light">{cita.nombre}</p>
                    <p className="mt-0.5 text-sm font-light text-text-muted">
                      <a href={`mailto:${cita.correo}`} className="hover:text-gold">{cita.correo}</a>
                      {' · '}
                      <a href={`tel:${cita.telefono}`} className="hover:text-gold">{cita.telefono}</a>
                    </p>
                    {cita.mensaje && (
                      <p className="mt-2 max-w-lg text-xs font-light italic text-text-muted/70">
                        &ldquo;{cita.mensaje}&rdquo;
                      </p>
                    )}
                    {cita.estado === 'cancelada' && cita.motivo_cancelacion && (
                      <p className="mt-2 max-w-lg text-xs font-light text-text-muted">Motivo de cancelación: {cita.motivo_cancelacion}</p>
                    )}
                  </div>

                  {/* Fecha y acciones: solo una cita activa ofrece cambios (no se reactiva una cancelada) */}
                  <div className="flex flex-col items-end gap-3">
                    <p className="font-montserrat text-sm font-semibold text-gold">
                      {formatFecha(cita.fecha, cita.hora)}
                    </p>
                    {activa && (
                      <div className="flex gap-1.5">
                        {(['pendiente', 'confirmada'] as const).filter((e) => e !== cita.estado).map((e) => (
                          <button
                            type="button"
                            key={e}
                            onClick={() => changeEstado(cita.id, e)}
                            disabled={updating === cita.id}
                            className={`rounded border px-3 py-1 font-montserrat text-[10px] uppercase tracking-widest transition-colors disabled:opacity-40 ${ESTADO_STYLES[e]} hover:opacity-80`}
                          >
                            {updating === cita.id ? '...' : e}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => abrirCancelar(cita.id)}
                          disabled={updating === cita.id || cancelando === cita.id}
                          className={`rounded border px-3 py-1 font-montserrat text-[10px] uppercase tracking-widest transition-colors disabled:opacity-40 ${ESTADO_STYLES.cancelada} hover:opacity-80`}
                        >
                          cancelar
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {activa && cancelando === cita.id && (
                  <form
                    onSubmit={(e) => { e.preventDefault(); void cancelar(cita.id) }}
                    onKeyDown={(e) => { if (e.key === 'Escape') setCancelando(null) }}
                    className="mt-4 space-y-3 border-t border-border pt-4"
                    aria-label="Cancelar cita"
                  >
                    <p className="font-montserrat text-xs text-text-muted">
                      La hora quedará libre y se creará la tarea de reagendar. Una cita cancelada no se puede reactivar.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
                      <div>
                        <label htmlFor={`origen-${cita.id}`} className="mb-1 block font-montserrat text-[10px] uppercase tracking-widest text-text-muted">Quién cancela</label>
                        <select
                          id={`origen-${cita.id}`}
                          value={origen}
                          onChange={(e) => setOrigen(e.target.value)}
                          className="w-full border border-border bg-primary px-3 py-2 font-montserrat text-sm text-text-light focus:border-gold focus:outline-none"
                        >
                          <option value="">Elige…</option>
                          {ORIGENES.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`motivo-${cita.id}`} className="mb-1 block font-montserrat text-[10px] uppercase tracking-widest text-text-muted">Motivo (mínimo 5 caracteres)</label>
                        <input
                          id={`motivo-${cita.id}`}
                          value={motivo}
                          onChange={(e) => setMotivo(e.target.value)}
                          maxLength={500}
                          autoFocus
                          className="w-full border border-border bg-primary px-3 py-2 font-montserrat text-sm text-text-light focus:border-gold focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={updating === cita.id}
                        className={`rounded border px-3 py-1 font-montserrat text-[10px] uppercase tracking-widest transition-colors disabled:opacity-40 ${ESTADO_STYLES.cancelada} hover:opacity-80`}
                      >
                        {updating === cita.id ? '...' : 'confirmar cancelación'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCancelando(null)}
                        disabled={updating === cita.id}
                        className="rounded border border-border px-3 py-1 font-montserrat text-[10px] uppercase tracking-widest text-text-muted transition-colors hover:text-gold disabled:opacity-40"
                      >
                        volver
                      </button>
                    </div>
                  </form>
                )}

                {error?.id === cita.id && (
                  <p role="alert" className="mt-3 font-montserrat text-xs text-red-400">{error.texto}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

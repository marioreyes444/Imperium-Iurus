'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Franja from '@/components/crm/Franja'
import { BOTON_BARRA, BOTON_PRIMARIO, BOTON_SECUNDARIO, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

type Dia = { fecha: string; horas: string[]; motivo?: 'feriado' | 'sin_horario' | 'sin_cupo' }
type Disponibilidad = { configurado: boolean; dias: Dia[]; horario_url?: string | null }

type Props = {
  modo: 'nueva' | 'reagendar'
  solicitudId?: string
  citaId?: string
  /** Cita cancelada que se reemplaza (R-35: la nueva lleva `reagendada_de`). */
  reagendadaDe?: string
  abogados: { id: string; nombre: string }[]
  abogadoInicial?: string | null
  /** Fecha y hora actuales de la cita que se reagenda o a la que se asigna abogado. */
  actual?: { fecha: string; hora: string } | null
  hoy: string
  duracionMin: number
  volverHref: string
}

const VENTANA_DIAS = 14
const sumar = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const fmtDia = new Intl.DateTimeFormat('es-EC', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short' })
const etiquetaDia = (f: string) => fmtDia.format(new Date(`${f}T12:00:00Z`))
const MOTIVO: Record<string, string> = { feriado: 'Feriado', sin_horario: 'Sin disponibilidad', sin_cupo: 'Sin disponibilidad' }

/**
 * Agendar o reagendar: abogado → día → hora. Los días sin cupo aparecen deshabilitados; del día elegido
 * solo se muestran las horas libres. Ante un 409 («Esa hora acaba de ocuparse») se refrescan las horas y
 * no se pierde lo escrito. La duración es fija (no se puede cambiar desde aquí).
 */
export default function AgendarCitaForm({
  modo, solicitudId, citaId, reagendadaDe, abogados, abogadoInicial, actual, hoy, duracionMin, volverHref,
}: Props) {
  const router = useRouter()
  const [abogado, setAbogado] = useState(abogadoInicial ?? abogados[0]?.id ?? '')
  const [desde, setDesde] = useState(hoy)
  const [disp, setDisp] = useState<Disponibilidad | null>(null)
  const [cargando, setCargando] = useState(false)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [dia, setDia] = useState<string | null>(null)
  const [hora, setHora] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<{ texto: string; enlace?: string } | null>(null)

  const hasta = sumar(desde, VENTANA_DIAS - 1)

  const cargar = useCallback(async () => {
    if (!abogado) return
    setCargando(true)
    setErrorCarga(null)
    try {
      const p = new URLSearchParams({ abogado_id: abogado, desde, hasta })
      if (citaId) p.set('excluir', citaId)
      const res = await fetch(`/api/admin/crm/disponibilidad?${p}`, { cache: 'no-store' })
      const cuerpo = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrorCarga(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo cargar la disponibilidad.')
        setDisp(null)
        return
      }
      setDisp(cuerpo as Disponibilidad)
    } catch {
      setErrorCarga('No se pudo conectar. Inténtalo de nuevo.')
    } finally {
      setCargando(false)
    }
  }, [abogado, desde, hasta, citaId])

  useEffect(() => { void cargar() }, [cargar])

  const diaElegido = disp?.dias.find((d) => d.fecha === dia) ?? null

  async function guardar(fechaFinal: string, horaFinal: string) {
    setGuardando(true)
    setError(null)
    try {
      const res = modo === 'nueva'
        ? await fetch('/api/admin/crm/citas', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ solicitud_id: solicitudId, abogado_id: abogado, fecha: fechaFinal, hora: horaFinal, mensaje, reagendada_de: reagendadaDe }),
        })
        : await fetch(`/api/admin/crm/citas/${citaId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accion: 'reprogramar', abogado_id: abogado, fecha: fechaFinal, hora: horaFinal }),
        })
      const cuerpo = await res.json().catch(() => ({}))
      if (!res.ok) {
        const texto = typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo guardar la cita.'
        if (res.status === 409 && cuerpo.datos?.dias) {
          // Horas actualizadas de ese día, sin perder abogado, día ni mensaje.
          const nuevo = (cuerpo.datos as Disponibilidad).dias[0]
          if (nuevo) setDisp((prev) => prev ? { ...prev, dias: prev.dias.map((d) => d.fecha === nuevo.fecha ? nuevo : d) } : prev)
          setHora(null)
        }
        setError({ texto, enlace: cuerpo.codigo === 'CONTACTO_INCOMPLETO' ? cuerpo.datos?.editar : undefined })
        return
      }
      router.push(`${volverHref}${volverHref.includes('?') ? '&' : '?'}aviso=${modo === 'nueva' ? 'cita_agendada' : 'cita_reagendada'}`)
      router.refresh()
    } catch {
      setError({ texto: 'No se pudo conectar. Inténtalo de nuevo.' })
    } finally {
      setGuardando(false)
    }
  }

  if (abogados.length === 0) {
    return <Franja tipo="info">No hay abogados activos para agendar. Marca a una persona como abogado en su ficha del personal.</Franja>
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (dia && hora) void guardar(dia, hora) }} className="max-w-4xl space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ac-abogado" className={CLASE_ETIQUETA}>1 · Abogado</label>
          <select id="ac-abogado" value={abogado} onChange={(e) => { setAbogado(e.target.value); setDia(null); setHora(null) }} className={CLASE_INPUT}>
            {abogados.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </div>
        <div>
          <p className={CLASE_ETIQUETA}>Duración</p>
          <p className="py-3 font-montserrat text-sm text-text-light">{duracionMin} minutos</p>
        </div>
      </div>

      {actual && (
        <p className="font-montserrat text-xs text-text-muted">
          Fecha y hora actuales: <span className="text-text-light">{etiquetaDia(actual.fecha)} · {actual.hora}</span>
        </p>
      )}

      <div aria-live="polite">
        {errorCarga && <Franja tipo="error">{errorCarga}</Franja>}
        {cargando && !disp && <p className="font-montserrat text-xs text-text-muted">Cargando disponibilidad…</p>}
        {disp && !disp.configurado && (
          <Franja tipo="info">
            Este abogado aún no tiene horario configurado.
            {disp.horario_url && <> <Link href={disp.horario_url} className="focus-gold text-gold underline underline-offset-2">Configurar su horario</Link></>}
          </Franja>
        )}
      </div>

      {disp?.configurado && (
        <>
          <fieldset>
            <legend className={CLASE_ETIQUETA}>2 · Día</legend>
            <div className="mb-3 flex gap-2">
              <button type="button" className={BOTON_BARRA} disabled={desde <= hoy || cargando} onClick={() => { setDesde(sumar(desde, -VENTANA_DIAS) < hoy ? hoy : sumar(desde, -VENTANA_DIAS)); setDia(null); setHora(null) }}>← Anteriores</button>
              <button type="button" className={BOTON_BARRA} disabled={cargando} onClick={() => { setDesde(sumar(desde, VENTANA_DIAS)); setDia(null); setHora(null) }}>Siguientes →</button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {disp.dias.map((d) => {
                const sinCupo = d.horas.length === 0
                const activo = d.fecha === dia
                return (
                  <button
                    key={d.fecha}
                    type="button"
                    disabled={sinCupo}
                    aria-pressed={activo}
                    onClick={() => { setDia(d.fecha); setHora(null) }}
                    className={`focus-gold border px-3 py-2 text-left font-montserrat text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${activo ? 'border-gold bg-gold/10 text-gold' : 'border-border text-text-light enabled:hover:border-gold/50'}`}
                  >
                    <span className="block capitalize">{etiquetaDia(d.fecha)}</span>
                    <span className="block text-[10px] text-text-muted">{sinCupo ? MOTIVO[d.motivo ?? 'sin_cupo'] : `${d.horas.length} horas libres`}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          {diaElegido && (
            <fieldset>
              <legend className={CLASE_ETIQUETA}>3 · Hora</legend>
              {diaElegido.horas.length === 0 ? (
                <p className="font-montserrat text-xs text-text-muted">Ese día ya no tiene horas libres. Elige otro.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {diaElegido.horas.map((h) => (
                    <button key={h} type="button" aria-pressed={h === hora} onClick={() => setHora(h)}
                      className={`focus-gold border px-4 py-2 font-montserrat text-xs transition-colors ${h === hora ? 'border-gold bg-gold text-primary' : 'border-border text-text-light hover:border-gold/50'}`}>
                      {h}
                    </button>
                  ))}
                </div>
              )}
            </fieldset>
          )}
        </>
      )}

      {modo === 'nueva' && (
        <div>
          <label htmlFor="ac-mensaje" className={CLASE_ETIQUETA}>Nota para la cita (opcional)</label>
          <textarea id="ac-mensaje" value={mensaje} onChange={(e) => setMensaje(e.target.value)} rows={3} maxLength={1000} className={CLASE_INPUT} />
        </div>
      )}

      {error && (
        <Franja tipo="error">
          {error.texto}
          {error.enlace && <> <Link href={error.enlace} className="focus-gold underline underline-offset-2">Editar la ficha del contacto</Link></>}
        </Franja>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={!dia || !hora || guardando} className={BOTON_PRIMARIO}>
          {guardando ? 'Guardando…' : modo === 'nueva' ? 'Agendar cita' : 'Guardar nueva fecha'}
        </button>
        {modo === 'reagendar' && actual && (
          <button type="button" disabled={guardando || !abogado} onClick={() => void guardar(actual.fecha, actual.hora)} className={BOTON_SECUNDARIO}>
            Mantener fecha y hora con este abogado
          </button>
        )}
        <Link href={volverHref} className={BOTON_SECUNDARIO}>Volver</Link>
      </div>
    </form>
  )
}

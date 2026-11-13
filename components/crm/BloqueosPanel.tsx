'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Franja from '@/components/crm/Franja'
import PanelAccion from '@/components/crm/PanelAccion'
import { BOTON_BARRA, BOTON_PRIMARIO, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

export type BloqueoVista = { id: string; desde: string; hasta: string; tipo: string; tipo_etiqueta: string; motivo: string | null; rango: string }
type Afectada = { id: string; fecha: string; hora: string; codigo: string | null; reservada: boolean }

const TIPOS = [
  { valor: 'vacaciones', etiqueta: 'Vacaciones' },
  { valor: 'audiencia', etiqueta: 'Audiencia' },
  { valor: 'permiso', etiqueta: 'Permiso' },
  { valor: 'otro', etiqueta: 'Otro' },
]

/**
 * Ausencias (bloqueos) de una persona. R-45: si hay citas activas en el período no se cancelan solas;
 * se guarda y se muestra la lista para reagendarlas.
 */
export default function BloqueosPanel({ personalId, bloqueos, editable }: { personalId: string; bloqueos: BloqueoVista[]; editable: boolean }) {
  const router = useRouter()
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [tipo, setTipo] = useState('otro')
  const [motivo, setMotivo] = useState('')
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [afectadas, setAfectadas] = useState<Afectada[] | null>(null)
  const [quitar, setQuitar] = useState<BloqueoVista | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  async function crear() {
    setGuardando(true)
    setError(null)
    setCampos({})
    setMensaje(null)
    try {
      const res = await fetch(`/api/admin/crm/personal/${personalId}/bloqueos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ desde, hasta, tipo, motivo }),
      })
      const cuerpo = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCampos(cuerpo.campos ?? {})
        setError(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo guardar el bloqueo.')
        return
      }
      setAfectadas((cuerpo.citas_afectadas ?? []) as Afectada[])
      setDesde('')
      setHasta('')
      setMotivo('')
      router.refresh()
    } catch {
      setError('No se pudo conectar. Inténtalo de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  async function borrar(b: BloqueoVista) {
    setGuardando(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/crm/personal/${personalId}/bloqueos`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bloqueo_id: b.id }),
      })
      const cuerpo = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo quitar el bloqueo.')
        return
      }
      setQuitar(null)
      setMensaje('Bloqueo quitado.')
      router.refresh()
    } catch {
      setError('No se pudo conectar. Inténtalo de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const err = (c: string) => campos[c] && <p id={`bl-${c}-error`} className="mt-1 font-montserrat text-xs text-red-400">{campos[c]}</p>

  return (
    <div className="space-y-4">
      {bloqueos.length === 0 ? (
        <p className="font-montserrat text-xs text-text-muted">No hay ausencias vigentes ni próximas.</p>
      ) : (
        <ul className="divide-y divide-border border border-border bg-card-bg">
          {bloqueos.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 font-montserrat text-xs">
              <span className="text-text-light">{b.tipo_etiqueta} · {b.rango}{b.motivo ? <span className="text-text-muted"> · {b.motivo}</span> : null}</span>
              {editable && <button type="button" onClick={() => { setQuitar(b); setMensaje(null) }} className={BOTON_BARRA}>Quitar</button>}
            </li>
          ))}
        </ul>
      )}

      {quitar && (
        <PanelAccion
          titulo="Quitar ausencia"
          resumen={<>Se quitará «{quitar.tipo_etiqueta} · {quitar.rango}». Esas horas volverán a estar disponibles.</>}
          etiquetaGuardar="Quitar"
          guardando={guardando}
          error={error}
          onCancelar={() => setQuitar(null)}
          onGuardar={() => borrar(quitar)}
        />
      )}
      {mensaje && <Franja tipo="exito">{mensaje}</Franja>}

      {editable && (
        <form onSubmit={(e) => { e.preventDefault(); void crear() }} className="space-y-4 border border-border bg-card-bg px-5 py-4">
          <p className="font-cinzel text-xs uppercase tracking-[0.2em] text-gold">Nueva ausencia</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="bl-desde" className={CLASE_ETIQUETA}>Desde</label>
              <input id="bl-desde" type="datetime-local" value={desde} onChange={(e) => setDesde(e.target.value)} required className={CLASE_INPUT}
                aria-invalid={campos.desde ? true : undefined} aria-describedby={campos.desde ? 'bl-desde-error' : undefined} />
              {err('desde')}
            </div>
            <div>
              <label htmlFor="bl-hasta" className={CLASE_ETIQUETA}>Hasta</label>
              <input id="bl-hasta" type="datetime-local" value={hasta} onChange={(e) => setHasta(e.target.value)} required className={CLASE_INPUT}
                aria-invalid={campos.hasta ? true : undefined} aria-describedby={campos.hasta ? 'bl-hasta-error' : undefined} />
              {err('hasta')}
            </div>
            <div>
              <label htmlFor="bl-tipo" className={CLASE_ETIQUETA}>Tipo</label>
              <select id="bl-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={CLASE_INPUT}>
                {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="bl-motivo" className={CLASE_ETIQUETA}>Detalle (opcional)</label>
              <input id="bl-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} className={CLASE_INPUT} />
            </div>
          </div>
          <p className="font-montserrat text-[11px] text-text-muted">Horas de Guayaquil. Las citas que caigan en el período no se cancelan: se listan para reagendarlas.</p>
          {error && !quitar && <Franja tipo="error">{error}</Franja>}
          <button type="submit" disabled={guardando} className={BOTON_PRIMARIO}>{guardando ? 'Guardando…' : 'Guardar ausencia'}</button>
        </form>
      )}

      {afectadas && (
        <Franja tipo={afectadas.length > 0 ? 'info' : 'exito'}>
          Ausencia guardada.
          {afectadas.length > 0 && (
            <>
              {' '}Hay {afectadas.length === 1 ? '1 cita activa' : `${afectadas.length} citas activas`} en ese período; reagéndalas o reasígnalas:
              <ul className="mt-2 list-inside list-disc">
                {afectadas.map((c) => (
                  <li key={c.id}>
                    {c.fecha} {c.hora}{c.codigo ? ` · ${c.codigo}` : c.reservada ? ' · Caso reservado' : ''}
                    {!c.reservada && <>{' — '}<Link href={`/admin/crm/citas/${c.id}/reagendar`} className="focus-gold underline underline-offset-2">Reagendar</Link></>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Franja>
      )}
    </div>
  )
}

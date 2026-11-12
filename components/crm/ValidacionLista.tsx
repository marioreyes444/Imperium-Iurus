'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ListaSeleccionable, { type Columna } from '@/components/crm/ListaSeleccionable'
import PanelAccion from '@/components/crm/PanelAccion'
import Franja from '@/components/crm/Franja'
import { IndicadorUrgencia } from '@/components/crm/IndicadoresSolicitud'
import { formatoFechaHora } from '@/components/crm/formato'
import { BOTON_BARRA, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'
import type { FilaSolicitud } from '@/components/crm/SolicitudesLista'

type Accion = 'validar' | 'descartar'

const FIJOS = { validacion: 'true' }

/** Bandeja de validación: envíos marcados como sospechosos. Se validan (se quita la marca) o se descartan con motivo. */
export default function ValidacionLista() {
  const router = useRouter()
  const [accion, setAccion] = useState<Accion | null>(null)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  function cerrar() { setAccion(null); setMotivo(''); setError(null); setErrorMotivo(null) }

  async function ejecutar(fila: FilaSolicitud, recargar: () => void) {
    if (!accion) return
    setGuardando(true); setError(null); setErrorMotivo(null)
    try {
      const res = await fetch(`/api/admin/crm/solicitudes/${fila.id}/validar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion, motivo: motivo.trim() || undefined }),
      })
      const cuerpo = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (cuerpo.campos?.motivo) setErrorMotivo(cuerpo.campos.motivo)
        else setError(typeof cuerpo.error === 'string' ? cuerpo.error : 'No se pudo completar la acción.')
        if (res.status === 409) recargar()
        return
      }
      setMensaje(`${fila.codigo}: ${accion === 'validar' ? 'validada, sale de la bandeja y sigue su curso.' : 'descartada.'}`)
      cerrar()
      recargar()
      router.refresh()
    } catch {
      setError('No se pudo conectar con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  const columnas: Columna<FilaSolicitud>[] = [
    { clave: 'codigo', titulo: 'Código', ancho: '12%', render: (f) => f.codigo },
    { clave: 'contacto', titulo: 'Contacto', ancho: '28%', render: (f) => f.contacto ?? '—', texto: (f) => f.contacto ?? '' },
    { clave: 'urgencia', titulo: 'Urgencia', ancho: '14%', render: (f) => <IndicadorUrgencia urgencia={f.urgencia} /> },
    { clave: 'canal', titulo: 'Canal', ancho: '16%', render: (f) => f.canal_origen ?? '—' },
    { clave: 'recibida', titulo: 'Recibida', ancho: '30%', render: (f) => formatoFechaHora(f.fecha_recepcion) },
  ]

  return (
    <ListaSeleccionable<FilaSolicitud>
      titulo="Validación"
      endpoint="/api/admin/crm/solicitudes"
      parametrosFijos={FIJOS}
      columnas={columnas}
      idDe={(f) => f.id}
      etiquetaSeleccion={(f) => `${f.codigo} · ${f.contacto ?? 'sin contacto'}`}
      singular="envío"
      plural="envíos"
      buscador={{ placeholder: 'Buscar por código o por datos del contacto' }}
      onCambioSeleccion={cerrar}
      vacio={<>No hay envíos por validar. Aquí llegan los envíos del sitio que el sistema marca como sospechosos (varios enlaces o un teléfono que no se puede normalizar): se atienden normalmente, solo piden una revisión.</>}
      mensaje={mensaje ? <Franja tipo="exito">{mensaje}</Franja> : undefined}
      barraAcciones={(fila) => (
        <>
          <button type="button" disabled={!fila} onClick={() => fila && router.push(`/admin/crm/solicitudes/${fila.id}`)} className={BOTON_BARRA}>Ver</button>
          <button type="button" disabled={!fila} onClick={() => { setMensaje(null); setAccion('validar') }} className={BOTON_BARRA}>Validar</button>
          <button type="button" disabled={!fila} onClick={() => { setMensaje(null); setAccion('descartar') }} className={BOTON_BARRA}>Descartar</button>
        </>
      )}
      panel={(fila, ctx) => {
        if (!fila || !accion) return null
        const descartando = accion === 'descartar'
        return (
          <PanelAccion
            titulo={descartando ? `Descartar ${fila.codigo}` : `Validar ${fila.codigo}`}
            delicada={descartando}
            etiquetaGuardar={descartando ? 'Descartar' : 'Validar'}
            guardando={guardando}
            error={error}
            onGuardar={() => ejecutar(fila, ctx.recargar)}
            onCancelar={cerrar}
            resumen={descartando
              ? 'El envío se descarta con el motivo indicado y sus tareas pendientes se cancelan. Solo Dirección puede reabrirlo.'
              : 'Se quita la marca de sospechoso y la solicitud sigue su curso normal.'}
          >
            <div>
              <label htmlFor="val-motivo" className={CLASE_ETIQUETA}>Motivo{descartando ? ' (obligatorio)' : ' (opcional)'}</label>
              <textarea id="val-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} className={CLASE_INPUT}
                aria-invalid={errorMotivo ? true : undefined} aria-describedby={errorMotivo ? 'val-motivo-error' : undefined} />
              {errorMotivo && <p id="val-motivo-error" className="mt-1 font-montserrat text-xs text-red-400">{errorMotivo}</p>}
            </div>
          </PanelAccion>
        )
      }}
    />
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ListaSeleccionable, { type Columna } from '@/components/crm/ListaSeleccionable'
import PanelAccion from '@/components/crm/PanelAccion'
import Franja from '@/components/crm/Franja'
import { IndicadorUrgencia } from '@/components/crm/IndicadoresSolicitud'
import { formatoFecha } from '@/components/crm/formato'
import { BOTON_BARRA, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'

export type FilaAsignacion = {
  equipo_id: string
  solicitud_id: string
  rol: string
  funciones: string | null
  codigo: string
  area: string | null
  servicio: string | null
  urgencia: string
  descripcion: string
  aprobada_at: string | null
}

const ROL: Record<string, string> = { titular: 'Titular', suplente: 'Suplente', coordinador: 'Coordinador', apoyo: 'Apoyo', perito: 'Perito' }

type Accion = 'confirmar' | 'rechazar' | null

/** «Mis asignaciones»: las asignaciones por confirmar de quien entra. Solo el resumen del caso, sin datos del contacto. */
export default function AsignacionesLista() {
  const router = useRouter()
  const [accion, setAccion] = useState<Accion>(null)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [mensaje, setMensaje] = useState<string | null>(null)

  const columnas: Columna<FilaAsignacion>[] = [
    { clave: 'codigo', titulo: 'Código', ancho: '12%', render: (f) => f.codigo },
    { clave: 'rol', titulo: 'Rol', ancho: '12%', render: (f) => ROL[f.rol] ?? f.rol },
    { clave: 'area', titulo: 'Área y servicio', ancho: '26%', render: (f) => [f.area, f.servicio].filter(Boolean).join(' · ') || '—', texto: (f) => [f.area, f.servicio].filter(Boolean).join(' · ') },
    { clave: 'urgencia', titulo: 'Urgencia', ancho: '12%', render: (f) => <IndicadorUrgencia urgencia={f.urgencia} /> },
    { clave: 'descripcion', titulo: 'Descripción', ancho: '28%', render: (f) => f.descripcion, texto: (f) => f.descripcion },
    { clave: 'aprobada', titulo: 'Aprobada', ancho: '10%', render: (f) => (f.aprobada_at ? formatoFecha(f.aprobada_at) : '—') },
  ]

  function cerrar() { setAccion(null); setMotivo(''); setError(null); setCampos({}) }

  async function responder(fila: FilaAsignacion, acepta: boolean, recargar: () => void) {
    setGuardando(true); setError(null); setCampos({})
    try {
      const res = await fetch(`/api/admin/crm/equipo/${fila.equipo_id}/responder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(acepta ? { acepta: true } : { acepta: false, motivo }),
      })
      const datos = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (datos.campos && typeof datos.campos === 'object') setCampos(datos.campos as Record<string, string>)
        setError(typeof datos.error === 'string' ? datos.error : 'No se pudo completar la acción.')
        if (res.status === 404 || res.status === 422) recargar()
        return
      }
      setMensaje(acepta ? `${fila.codigo}: asignación confirmada. El caso ya está en tus manos.` : `${fila.codigo}: asignación rechazada.`)
      cerrar(); recargar(); router.refresh()
    } catch {
      setError('No se pudo conectar con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <ListaSeleccionable<FilaAsignacion>
      titulo="Mis asignaciones"
      endpoint="/api/admin/crm/asignaciones"
      columnas={columnas}
      idDe={(f) => f.equipo_id}
      etiquetaSeleccion={(f) => `${f.codigo} · ${ROL[f.rol] ?? f.rol}`}
      singular="asignación"
      plural="asignaciones"
      onCambioSeleccion={cerrar}
      vacio={<>No tienes asignaciones por confirmar. Cuando Dirección te asigne un caso, aparecerá aquí.</>}
      mensaje={mensaje ? <Franja tipo="exito">{mensaje}</Franja> : undefined}
      barraAcciones={(fila) => (
        <>
          <button type="button" disabled={!fila} onClick={() => fila && router.push(`/admin/crm/solicitudes/${fila.solicitud_id}`)} className={BOTON_BARRA}>Ver resumen</button>
          <button type="button" disabled={!fila} onClick={() => { setMensaje(null); setAccion('confirmar') }} className={BOTON_BARRA}>Confirmar</button>
          <button type="button" disabled={!fila} onClick={() => { setMensaje(null); setAccion('rechazar') }} className={BOTON_BARRA}>Rechazar</button>
        </>
      )}
      panel={(fila, ctx) => {
        if (!fila || !accion) return null
        if (accion === 'confirmar') {
          return (
            <PanelAccion
              key={`c-${fila.equipo_id}`} titulo={`Confirmar ${fila.codigo}`} etiquetaGuardar="Confirmar" guardando={guardando} error={error}
              resumen={fila.rol === 'titular'
                ? 'Al confirmar, el caso pasa a «En curso» y verás todos sus datos, incluido el contacto del cliente.'
                : 'Al confirmar pasas a formar parte del equipo y verás los datos del caso.'}
              onGuardar={() => responder(fila, true, ctx.recargar)} onCancelar={cerrar}
            />
          )
        }
        return (
          <PanelAccion
            key={`r-${fila.equipo_id}`} titulo={`Rechazar ${fila.codigo}`} delicada etiquetaGuardar="Rechazar" guardando={guardando} error={error}
            resumen={fila.rol === 'titular'
              ? 'El caso vuelve a «Aceptada, pendiente de asignación» y Dirección recibe el aviso con tu motivo.'
              : 'Dirección recibe el aviso con tu motivo.'}
            onGuardar={() => responder(fila, false, ctx.recargar)} onCancelar={cerrar}
          >
            <div>
              <label htmlFor="asig-motivo" className={CLASE_ETIQUETA}>Motivo del rechazo</label>
              <textarea id="asig-motivo" rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={CLASE_INPUT}
                aria-invalid={campos.motivo ? true : undefined} />
              {campos.motivo && <p className="mt-1 font-montserrat text-xs text-red-400">{campos.motivo}</p>}
            </div>
          </PanelAccion>
        )
      }}
    />
  )
}

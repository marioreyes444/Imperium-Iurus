'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PanelAccion from '@/components/crm/PanelAccion'
import Franja from '@/components/crm/Franja'
import CambiarEstadoPanel from '@/components/crm/CambiarEstadoPanel'
import { BOTON_BARRA } from '@/components/crm/estilos'

type Props = {
  solicitudId: string
  codigo: string
  updatedAt: string
  reservada: boolean
  estados: { valor: string; etiqueta: string; exige_motivo: boolean; pide_cierre: boolean }[]
  permisos: { editar: boolean; marcar_reserva: boolean; quitar_reserva: boolean; validar: boolean }
  soloLectura: boolean
  aviso?: 'creada' | 'editada'
}

type Panel = 'estado' | 'validar' | 'reserva' | null

const AVISOS = { creada: 'Solicitud registrada.', editada: 'Cambios guardados.' } as const

export default function SolicitudAcciones({ solicitudId, codigo, updatedAt, reservada, estados, permisos, soloLectura, aviso }: Props) {
  const router = useRouter()
  const [panel, setPanel] = useState<Panel>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(aviso ? AVISOS[aviso] : null)

  const puedeReserva = reservada ? permisos.quitar_reserva : permisos.marcar_reserva
  const hayAcciones = permisos.editar || estados.length > 0 || permisos.validar || puedeReserva

  function abrir(p: Panel) { setMensaje(null); setError(null); setPanel(p) }
  function cerrar() { setPanel(null); setError(null) }

  async function llamar(url: string, metodo: string, cuerpo: unknown, texto: string) {
    setGuardando(true); setError(null)
    try {
      const res = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
      const datos = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof datos.error === 'string' ? datos.error : 'No se pudo completar la acción.')
        if (res.status === 409) router.refresh()
        return
      }
      setMensaje(texto); cerrar(); router.refresh()
    } catch {
      setError('No se pudo conectar con el servidor.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-4">
      {soloLectura && <Franja tipo="info">Caso cerrado — solo lectura.</Franja>}
      {mensaje && <Franja tipo="exito">{mensaje}</Franja>}

      {hayAcciones && (
        <div className="flex flex-wrap items-center gap-3 border border-border bg-card-bg px-4 py-2.5">
          {permisos.editar && <Link href={`/admin/crm/solicitudes/${solicitudId}/editar`} className={BOTON_BARRA}>Editar</Link>}
          {estados.length > 0 && <button type="button" onClick={() => abrir('estado')} className={BOTON_BARRA}>Cambiar estado</button>}
          {permisos.validar && <button type="button" onClick={() => abrir('validar')} className={BOTON_BARRA}>Validar envío</button>}
          {puedeReserva && (
            <button type="button" onClick={() => abrir('reserva')} className={BOTON_BARRA}>
              {reservada ? 'Quitar reserva reforzada' : 'Marcar reserva reforzada'}
            </button>
          )}
        </div>
      )}

      {panel === 'estado' && (
        <CambiarEstadoPanel
          solicitudId={solicitudId} estados={estados} onCancelar={cerrar}
          onHecho={(texto) => { setMensaje(`${codigo}: ${texto}`); cerrar(); router.refresh() }}
        />
      )}

      {panel === 'validar' && (
        <PanelAccion
          titulo={`Validar ${codigo}`} etiquetaGuardar="Validar" guardando={guardando} error={error}
          resumen="Se quita la marca de sospechoso y la solicitud sigue su curso normal."
          onGuardar={() => llamar(`/api/admin/crm/solicitudes/${solicitudId}/validar`, 'POST', { accion: 'validar' }, 'Envío validado.')}
          onCancelar={cerrar}
        />
      )}

      {panel === 'reserva' && (
        <PanelAccion
          titulo={reservada ? 'Quitar reserva reforzada' : 'Marcar reserva reforzada'}
          delicada etiquetaGuardar={reservada ? 'Quitar reserva' : 'Marcar reserva'} guardando={guardando} error={error}
          resumen={reservada
            ? 'El caso dejará de estar restringido.'
            : 'Solo lo verán Dirección y quienes estén activos en el equipo del caso. Dejará de aparecer en búsquedas, listados, conteos y avisos de los demás.'}
          onGuardar={() => llamar(`/api/admin/crm/solicitudes/${solicitudId}`, 'PATCH', { updated_at: updatedAt, reserva_reforzada: !reservada }, reservada ? 'Reserva reforzada retirada.' : 'Reserva reforzada marcada.')}
          onCancelar={cerrar}
        />
      )}
    </div>
  )
}

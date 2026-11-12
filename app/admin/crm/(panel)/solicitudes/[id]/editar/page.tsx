import { notFound, redirect } from 'next/navigation'
import SolicitudForm from '@/components/crm/SolicitudForm'
import { personalDePagina } from '@/lib/crm/permisos'
import { obtenerCatalogo } from '@/lib/crm/catalogo'
import { uuidSchema } from '@/lib/crm/schemas'
import { detalleSolicitud, type DetalleSolicitud } from '@/lib/crm/detalles'
import { ETIQUETA_URGENCIA } from '@/components/crm/IndicadoresSolicitud'

export const dynamic = 'force-dynamic'

export default async function EditarSolicitudPage({ params }: { params: Promise<{ id: string }> }) {
  const personal = await personalDePagina(['direccion', 'coordinacion', 'asistencia', 'asociado'])
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) notFound()

  // La visibilidad y los permisos de edición salen del mismo detalle que la ficha.
  let detalle: DetalleSolicitud | null | undefined
  try {
    detalle = await detalleSolicitud(personal, id)
  } catch {
    detalle = undefined
  }
  if (detalle === undefined) redirect('/admin/crm')
  if (detalle === null) notFound()
  if (!detalle.permisos.editar) redirect(`/admin/crm/solicitudes/${id}`)

  const s = detalle.solicitud
  const catalogo = await obtenerCatalogo()

  return (
    <SolicitudForm
      modo="editar"
      catalogo={{ areas: catalogo.areas.map((a) => ({ id: a.id, nombre: a.nombre })), servicios: catalogo.servicios.map((x) => ({ id: x.id, area_id: x.area_id, nombre: x.nombre })) }}
      urgencias={Object.entries(ETIQUETA_URGENCIA).map(([valor, etiqueta]) => ({ valor, etiqueta }))}
      canales={[]}
      puedeMarcarReserva={detalle.permisos.marcar_reserva}
      puedeQuitarReserva={detalle.permisos.quitar_reserva}
      inicial={{
        id: s.id, codigo: s.codigo, descripcion: s.descripcion, objetivo_cliente: s.objetivo_cliente, modalidad: s.modalidad,
        urgencia: s.urgencia, area_principal_id: s.area_principal_id, servicio_id: s.servicio_id,
        reserva_reforzada: s.reserva_reforzada, updated_at: s.updated_at,
      }}
    />
  )
}

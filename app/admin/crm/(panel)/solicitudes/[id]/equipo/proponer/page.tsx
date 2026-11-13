import { notFound, redirect } from 'next/navigation'
import ProponerEquipoForm from '@/components/crm/ProponerEquipoForm'
import { personalDePagina } from '@/lib/crm/permisos'
import { uuidSchema } from '@/lib/crm/schemas'
import { detalleSolicitud, type DetalleSolicitud } from '@/lib/crm/detalles'

export const dynamic = 'force-dynamic'

export default async function ProponerEquipoPage({ params }: { params: Promise<{ id: string }> }) {
  const personal = await personalDePagina(['direccion', 'coordinacion'])
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) notFound()

  let detalle: DetalleSolicitud | null | undefined
  try {
    detalle = await detalleSolicitud(personal, id)
  } catch {
    detalle = undefined
  }
  if (detalle === undefined) redirect('/admin/crm')
  if (detalle === null) notFound() // no existe o no le corresponde verla
  if (detalle.nivel !== 'completo') redirect(`/admin/crm/solicitudes/${id}`)

  const s = detalle.solicitud
  const abierta = !['cerrada', 'descartada'].includes(s.estado)
  if (!abierta) redirect(`/admin/crm/solicitudes/${id}?tab=equipo`)

  return (
    <ProponerEquipoForm
      solicitudId={s.id}
      codigo={s.codigo}
      admiteEquipo={['aceptada_pendiente_asignacion', 'asignada', 'en_curso', 'en_espera'].includes(s.estado)}
      conflictoOk={s.conflicto_revision === 'sin_conflicto'}
    />
  )
}

import { notFound, redirect } from 'next/navigation'
import DuplicadoComparar from '@/components/crm/DuplicadoComparar'
import { personalDePagina } from '@/lib/crm/permisos'
import { uuidSchema } from '@/lib/crm/schemas'
import { detalleDuplicado, type DetalleDuplicado } from '@/lib/crm/detalles'
import { ETIQUETA_ETAPA } from '@/lib/crm/contactos'

export const dynamic = 'force-dynamic'

export default async function DuplicadoPage({ params }: { params: Promise<{ id: string }> }) {
  const personal = await personalDePagina(['direccion', 'coordinacion', 'asistencia'])
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) notFound()

  let detalle: DetalleDuplicado | null | undefined
  try {
    detalle = await detalleDuplicado(personal, id)
  } catch {
    detalle = undefined
  }
  if (detalle === undefined) redirect('/admin/crm')
  if (detalle === null) notFound()

  const ficha = (f: DetalleDuplicado['a']) => ({
    id: f.id, nombre: f.nombre, tipo: f.tipo, tipo_identificacion: f.tipo_identificacion, identificacion: f.identificacion,
    telefono: f.telefono, correo: f.correo, ciudad: f.ciudad, etapa_relacion: f.etapa_relacion, created_at: f.created_at,
    solicitudes: f.solicitudes, fusionado_en: f.fusionado_en,
  })

  return (
    <DuplicadoComparar
      parId={detalle.par.id}
      estado={detalle.par.estado}
      coincidencia={detalle.par.coincidencia}
      puedeResolver={detalle.puede_resolver}
      a={ficha(detalle.a)}
      b={ficha(detalle.b)}
      etapas={ETIQUETA_ETAPA}
    />
  )
}

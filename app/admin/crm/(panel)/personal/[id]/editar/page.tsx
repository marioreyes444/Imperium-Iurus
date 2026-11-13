import { notFound, redirect } from 'next/navigation'
import PersonalForm from '@/components/crm/PersonalForm'
import { personalDePagina } from '@/lib/crm/permisos'
import { uuidSchema } from '@/lib/crm/schemas'
import { areasDe, obtenerFicha } from '@/lib/crm/personal'
import { obtenerCatalogo } from '@/lib/crm/catalogo'

export const dynamic = 'force-dynamic'

export default async function EditarFichaPage({ params }: { params: Promise<{ id: string }> }) {
  await personalDePagina(['direccion', 'coordinacion'])
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) notFound()

  let ficha
  try {
    ficha = await obtenerFicha(id)
  } catch {
    redirect('/admin/crm')
  }
  if (!ficha) notFound()

  const [areas, catalogo] = await Promise.all([areasDe(id), obtenerCatalogo()])
  return (
    <PersonalForm
      ficha={{
        id: ficha.id, rol: ficha.rol, nombres: ficha.nombres, apellidos: ficha.apellidos, es_abogado: ficha.es_abogado,
        matricula: ficha.matricula, habilitacion_verificada: ficha.habilitacion_verificada, especialidad: ficha.especialidad,
        capacidad_maxima: ficha.capacidad_maxima, fecha_vinculacion: ficha.fecha_vinculacion,
        acuerdo_confidencialidad: ficha.acuerdo_confidencialidad, ciudad: ficha.ciudad, updated_at: ficha.updated_at,
      }}
      areas={catalogo.areas.map((a) => ({ id: a.id, nombre: a.nombre }))}
      areasIniciales={areas}
      catalogoDisponible={catalogo.disponible}
    />
  )
}

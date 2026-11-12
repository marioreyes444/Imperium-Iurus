import { notFound, redirect } from 'next/navigation'
import ContactoForm from '@/components/crm/ContactoForm'
import { personalDePagina } from '@/lib/crm/permisos'
import { uuidSchema } from '@/lib/crm/schemas'
import { detalleContacto, type DetalleContacto } from '@/lib/crm/detalles'
import { supabase } from '@/lib/supabase'
import { COLUMNAS_CONTACTO, type ContactoFila } from '@/lib/crm/contactos'

export const dynamic = 'force-dynamic'

export default async function EditarContactoPage({ params }: { params: Promise<{ id: string }> }) {
  const personal = await personalDePagina(['direccion', 'coordinacion', 'asistencia', 'asociado'])
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) notFound()

  // La visibilidad se comprueba con el mismo detalle que la ficha (alcance aplicado en la consulta).
  let detalle: DetalleContacto | null | undefined
  try {
    detalle = await detalleContacto(personal, id)
  } catch {
    detalle = undefined
  }
  if (detalle === undefined) redirect('/admin/crm')
  if (detalle === null) notFound()
  if (!detalle.permisos.editar) redirect(`/admin/crm/contactos/${id}`)

  const { data } = await supabase.from('crm_contactos').select(COLUMNAS_CONTACTO).eq('id', id).maybeSingle()
  const c = data as unknown as ContactoFila | null
  if (!c) notFound()

  return (
    <ContactoForm
      modo="editar"
      resaltarApellidos={detalle.contacto.completar_apellidos}
      inicial={{
        id: c.id, tipo: c.tipo, nombres: c.nombres, apellidos: c.apellidos, ocupacion: c.ocupacion,
        razon_social: c.razon_social, nombre_comercial: c.nombre_comercial, sector: c.sector,
        tipo_identificacion: c.tipo_identificacion, identificacion: c.identificacion,
        telefono: c.telefono, correo: c.correo, ciudad: c.ciudad, direccion: c.direccion,
        preferencia_comunicacion: c.preferencia_comunicacion, como_nos_conocio: c.como_nos_conocio,
        notas_internas: c.notas_internas, updated_at: c.updated_at,
      }}
    />
  )
}

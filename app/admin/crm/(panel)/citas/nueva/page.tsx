import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import AgendarCitaForm from '@/components/crm/AgendarCitaForm'
import Franja from '@/components/crm/Franja'
import { personalDePagina, puedeGestionarCitasDe, puedeVerSolicitud } from '@/lib/crm/permisos'
import { uuidSchema } from '@/lib/crm/schemas'
import { datosParaAgendar } from '@/lib/crm/citas'
import { abogadosActivos } from '@/lib/crm/horarios'
import { hoyGuayaquil } from '@/lib/crm/fechas'
import { DURACION_CITA_MIN } from '@/lib/crm/config'

export const dynamic = 'force-dynamic'

/** Agendar una cita para un caso: abogado → día → hora. */
export default async function NuevaCitaPage({ searchParams }: { searchParams: Promise<{ solicitud?: string; reagendada_de?: string }> }) {
  const personal = await personalDePagina(['direccion', 'coordinacion', 'asistencia', 'asociado'])
  const { solicitud, reagendada_de } = await searchParams
  if (!solicitud || !uuidSchema.safeParse(solicitud).success) notFound()
  const reemplaza = reagendada_de && uuidSchema.safeParse(reagendada_de).success ? reagendada_de : undefined

  let datos
  try {
    const nivel = await puedeVerSolicitud(personal, solicitud)
    if (!nivel || !puedeGestionarCitasDe(personal, nivel)) datos = null
    else datos = { caso: await datosParaAgendar(solicitud), abogados: await abogadosActivos() }
  } catch {
    redirect('/admin/crm')
  }
  if (!datos || !datos.caso) notFound()
  const { caso, abogados } = datos
  const volver = `/admin/crm/solicitudes/${caso.id}?tab=citas`
  const cerrado = caso.estado === 'cerrada' || caso.estado === 'descartada'

  return (
    <div className="space-y-8 px-6 pb-16 pt-8">
      <div className="border-b border-border pb-6">
        <Link href={volver} className="focus-gold font-montserrat text-[10px] uppercase tracking-widest text-text-muted hover:text-gold">← {caso.codigo}</Link>
        <h1 className="mt-2 font-cinzel text-3xl font-bold uppercase tracking-wider text-gold">Agendar cita</h1>
        <p className="mt-2 font-montserrat text-xs text-text-muted">Caso {caso.codigo}</p>
      </div>
      {cerrado ? (
        <Franja tipo="info">No se agendan citas en un caso cerrado o descartado.</Franja>
      ) : !caso.contacto_completo ? (
        <Franja tipo="error">
          Completa el correo y el teléfono del contacto para agendar.{' '}
          <Link href={`/admin/crm/contactos/${caso.contacto_id}/editar`} className="focus-gold underline underline-offset-2">Editar la ficha del contacto</Link>
        </Franja>
      ) : (
        <AgendarCitaForm
          modo="nueva"
          solicitudId={caso.id}
          reagendadaDe={reemplaza}
          abogados={abogados}
          hoy={hoyGuayaquil()}
          duracionMin={DURACION_CITA_MIN}
          volverHref={volver}
        />
      )}
    </div>
  )
}

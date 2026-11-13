import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import TareaForm from '@/components/crm/TareaForm'
import ElegirSolicitud from '@/components/crm/ElegirSolicitud'
import Franja from '@/components/crm/Franja'
import { personalDePagina, puedeCrearActividad, puedeVerSolicitud, recibeJuridicas } from '@/lib/crm/permisos'
import { uuidSchema } from '@/lib/crm/schemas'
import { responsablesPosibles } from '@/lib/crm/actividades'
import { datosParaAgendar } from '@/lib/crm/citas'

export const dynamic = 'force-dynamic'

/** Nueva tarea: primero se elige el caso; luego responsable y vencimiento. */
export default async function NuevaTareaPage({ searchParams }: { searchParams: Promise<{ solicitud?: string }> }) {
  const personal = await personalDePagina(['direccion', 'coordinacion', 'asistencia', 'asociado'])
  const { solicitud } = await searchParams

  const cabecera = (
    <div className="border-b border-border pb-6">
      <Link href="/admin/crm/tareas" className="focus-gold font-montserrat text-[10px] uppercase tracking-widest text-text-muted hover:text-gold">← Tareas</Link>
      <h1 className="mt-2 font-cinzel text-3xl font-bold uppercase tracking-wider text-gold">Nueva tarea</h1>
    </div>
  )

  if (!solicitud) {
    return (
      <div className="space-y-8 px-6 pb-16 pt-8">
        {cabecera}
        <ElegirSolicitud prefijo="/admin/crm/tareas/nueva?solicitud=" />
      </div>
    )
  }
  if (!uuidSchema.safeParse(solicitud).success) notFound()

  let datos
  try {
    const nivel = await puedeVerSolicitud(personal, solicitud)
    if (!nivel || !puedeCrearActividad(personal, nivel, { tipo: 'tarea', es_juridica: false, es_plazo_juridico: false })) datos = null
    else {
      const caso = await datosParaAgendar(solicitud)
      const juridico = recibeJuridicas(personal.rol)
      datos = caso && {
        caso,
        juridico,
        responsables: await responsablesPosibles(solicitud, false),
        responsablesJuridicos: juridico ? await responsablesPosibles(solicitud, true) : [],
      }
    }
  } catch {
    redirect('/admin/crm')
  }
  if (!datos) notFound()
  const volver = `/admin/crm/solicitudes/${datos.caso.id}?tab=cronologia`

  return (
    <div className="space-y-8 px-6 pb-16 pt-8">
      {cabecera}
      {datos.caso.estado === 'cerrada' ? (
        <Franja tipo="info">Caso cerrado — solo lectura.</Franja>
      ) : (
        <TareaForm
          solicitudId={datos.caso.id}
          codigo={datos.caso.codigo}
          responsables={datos.responsables.map(({ id, nombre }) => ({ id, nombre }))}
          responsablesJuridicos={datos.responsablesJuridicos.map(({ id, nombre }) => ({ id, nombre }))}
          permiteJuridico={datos.juridico}
          yo={personal.id}
          volverHref={volver}
        />
      )}
    </div>
  )
}

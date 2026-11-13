import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import AgendarCitaForm from '@/components/crm/AgendarCitaForm'
import Franja from '@/components/crm/Franja'
import { personalDePagina, puedeGestionarCita, puedeVerCita } from '@/lib/crm/permisos'
import { uuidSchema } from '@/lib/crm/schemas'
import { enriquecer, esActiva, obtenerCita } from '@/lib/crm/citas'
import { abogadosActivos } from '@/lib/crm/horarios'
import { hoyGuayaquil } from '@/lib/crm/fechas'
import { DURACION_CITA_MIN } from '@/lib/crm/config'

export const dynamic = 'force-dynamic'

/** Reagendar una cita (misma cita, otra fecha u hora) o asignarle abogado. */
export default async function ReagendarCitaPage({ params }: { params: Promise<{ id: string }> }) {
  const personal = await personalDePagina(['direccion', 'coordinacion', 'asistencia', 'asociado'])
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) notFound()

  let datos
  try {
    const cita = await obtenerCita(id)
    if (!cita || !(await puedeVerCita(personal, cita)) || !(await puedeGestionarCita(personal, cita))) datos = null
    else datos = { cita: (await enriquecer([cita]))[0], abogados: await abogadosActivos() }
  } catch {
    redirect('/admin/crm')
  }
  if (!datos) notFound()
  const { cita, abogados } = datos
  const volver = cita.solicitud_id ? `/admin/crm/solicitudes/${cita.solicitud_id}?tab=citas` : '/admin/crm/agenda'

  return (
    <div className="space-y-8 px-6 pb-16 pt-8">
      <div className="border-b border-border pb-6">
        <Link href={volver} className="focus-gold font-montserrat text-[10px] uppercase tracking-widest text-text-muted hover:text-gold">← {cita.codigo ?? 'Agenda'}</Link>
        <h1 className="mt-2 font-cinzel text-3xl font-bold uppercase tracking-wider text-gold">{cita.abogado_id ? 'Reagendar cita' : 'Asignar abogado'}</h1>
        <p className="mt-2 font-montserrat text-xs text-text-muted">
          {cita.codigo ? `Caso ${cita.codigo} · ` : ''}{cita.abogado ?? 'Sin abogado'} · {cita.estado_etiqueta}
        </p>
      </div>
      {!esActiva(cita.estado) ? (
        <Franja tipo="info">Esta cita ya no está activa. Una cita cancelada o concluida no se reactiva: agenda una nueva desde el caso.</Franja>
      ) : (
        <AgendarCitaForm
          modo="reagendar"
          citaId={cita.id}
          abogados={abogados}
          abogadoInicial={cita.abogado_id}
          actual={{ fecha: cita.fecha, hora: cita.hora }}
          hoy={hoyGuayaquil()}
          duracionMin={cita.duracion_min ?? DURACION_CITA_MIN}
          volverHref={volver}
        />
      )}
    </div>
  )
}

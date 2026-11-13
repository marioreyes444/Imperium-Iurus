import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import HorarioEditor from '@/components/crm/HorarioEditor'
import BloqueosPanel, { type BloqueoVista } from '@/components/crm/BloqueosPanel'
import { formatoFechaHora } from '@/components/crm/formato'
import { personalDePagina, puedeEditarHorario, puedeGestionarBloqueos, puedeVerHorario } from '@/lib/crm/permisos'
import { uuidSchema } from '@/lib/crm/schemas'
import { obtenerFicha } from '@/lib/crm/personal'
import { bloqueosDe, ETIQUETA_BLOQUEO, franjasDe } from '@/lib/crm/horarios'

export const dynamic = 'force-dynamic'

/** Horario semanal y ausencias. Dirección edita el horario; C, A y el propio abogado lo ven. */
export default async function HorarioPage({ params }: { params: Promise<{ id: string }> }) {
  const personal = await personalDePagina()
  const { id } = await params
  if (!uuidSchema.safeParse(id).success || !puedeVerHorario(personal, id)) notFound()

  let datos
  try {
    const ficha = await obtenerFicha(id)
    if (!ficha) datos = null
    else datos = { ficha, franjas: ficha.es_abogado ? await franjasDe(id) : [], bloqueos: await bloqueosDe(id) }
  } catch {
    redirect('/admin/crm')
  }
  if (!datos) notFound()
  const { ficha, franjas, bloqueos } = datos

  const vista: BloqueoVista[] = bloqueos.map((b) => ({
    id: b.id, desde: b.desde, hasta: b.hasta, tipo: b.tipo, motivo: b.motivo,
    tipo_etiqueta: ETIQUETA_BLOQUEO[b.tipo] ?? b.tipo,
    rango: `${formatoFechaHora(b.desde)} – ${formatoFechaHora(b.hasta)}`,
  }))

  return (
    <div className="space-y-10 px-6 pb-16 pt-8">
      <div className="border-b border-border pb-6">
        <Link href={`/admin/crm/personal/${id}`} className="focus-gold font-montserrat text-[10px] uppercase tracking-widest text-text-muted hover:text-gold">← Ficha</Link>
        <h1 className="mt-2 font-cinzel text-3xl font-bold uppercase tracking-wider text-gold">Horario</h1>
        <p className="mt-2 font-montserrat text-xs text-text-muted">{ficha.nombres} {ficha.apellidos}</p>
      </div>

      <section aria-labelledby="h-semana" className="space-y-4">
        <h2 id="h-semana" className="font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80">Horario semanal de citas</h2>
        {!ficha.es_abogado ? (
          <p className="font-montserrat text-xs text-text-muted">Esta persona no está marcada como abogado: no tiene horario de citas.</p>
        ) : (
          <>
            {franjas.length === 0 && (
              <p className="font-montserrat text-xs text-text-muted">Este abogado aún no tiene horario configurado: no se le pueden agendar citas.</p>
            )}
            <HorarioEditor personalId={id} inicial={franjas} editable={puedeEditarHorario(personal)} />
          </>
        )}
      </section>

      <section aria-labelledby="h-bloqueos" className="space-y-4">
        <h2 id="h-bloqueos" className="font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80">Ausencias</h2>
        <BloqueosPanel personalId={id} bloqueos={vista} editable={puedeGestionarBloqueos(personal, id)} />
      </section>
    </div>
  )
}

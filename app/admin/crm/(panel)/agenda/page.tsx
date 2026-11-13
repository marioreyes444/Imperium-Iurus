import Link from 'next/link'
import { redirect } from 'next/navigation'
import AgendaSemana, { type DiaAgenda } from '@/components/crm/AgendaSemana'
import CitasLista from '@/components/crm/CitasLista'
import { BOTON_BARRA, CLASE_ETIQUETA, CLASE_INPUT } from '@/components/crm/estilos'
import { abogadosVisiblesEnAgenda, personalDePagina, puedeGestionarCitaSinCaso, puedeVerHorario } from '@/lib/crm/permisos'
import { abogadosActivos, bloqueosEnRango, ETIQUETA_BLOQUEO, ETIQUETA_DIA, franjasDe } from '@/lib/crm/horarios'
import { citasParaPantalla, listarCitas } from '@/lib/crm/citas'
import { feriados } from '@/lib/crm/disponibilidad'
import {
  diaSemanaIso, esFechaValida, fechaYMinutosGuayaquil, hoyGuayaquil, instanteGuayaquil, lunesDe, sumarDias,
} from '@/lib/crm/fechas'

export const dynamic = 'force-dynamic'

const corto = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`

/** Agenda: semana por abogado (D, C, A ven a todos; el asociado, la suya). */
export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ abogado?: string; semana?: string }> }) {
  const personal = await personalDePagina(['direccion', 'coordinacion', 'asistencia', 'asociado'])
  const sp = await searchParams
  const alcance = abogadosVisiblesEnAgenda(personal)

  let contenido
  try {
    const todos = await abogadosActivos()
    const abogados = alcance === 'todos' ? todos : todos.filter((a) => a.id === personal.id)
    const elegido = abogados.find((a) => a.id === sp.abogado) ?? abogados[0] ?? null
    const lunes = lunesDe(sp.semana && esFechaValida(sp.semana) ? sp.semana : hoyGuayaquil())
    const domingo = sumarDias(lunes, 6)

    let dias: DiaAgenda[] = []
    let sinHorario = false
    if (elegido) {
      const [franjas, bloqueos, citas, fer] = await Promise.all([
        franjasDe(elegido.id),
        bloqueosEnRango(elegido.id, instanteGuayaquil(lunes, '00:00').toISOString(), instanteGuayaquil(sumarDias(lunes, 7), '00:00').toISOString()),
        listarCitas(personal, { desde: lunes, hasta: domingo, abogadoId: elegido.id }),
        feriados(),
      ])
      sinHorario = franjas.length === 0
      const vista = await citasParaPantalla(personal, citas)
      dias = Array.from({ length: 7 }, (_, i) => {
        const fecha = sumarDias(lunes, i)
        const ini = instanteGuayaquil(fecha, '00:00').getTime()
        const fin = instanteGuayaquil(sumarDias(fecha, 1), '00:00').getTime()
        return {
          fecha,
          etiqueta: `${ETIQUETA_DIA[diaSemanaIso(fecha)]} ${corto(fecha)}`,
          feriado: fer.has(fecha),
          franjas: franjas.filter((f) => f.dia_semana === diaSemanaIso(fecha)).map((f) => `${f.hora_inicio}–${f.hora_fin}`),
          bloqueos: bloqueos
            .filter((b) => Date.parse(b.desde) < fin && Date.parse(b.hasta) > ini)
            .map((b) => {
              const d = Date.parse(b.desde) <= ini ? '00:00' : horaLocal(b.desde)
              const h = Date.parse(b.hasta) >= fin ? '24:00' : horaLocal(b.hasta)
              return `${ETIQUETA_BLOQUEO[b.tipo] ?? b.tipo} ${d === '00:00' && h === '24:00' ? '(todo el día)' : `${d}–${h}`}`
            }),
          citas: vista.filter((c) => c.fecha === fecha),
        }
      })
    }

    const verSinAbogado = puedeGestionarCitaSinCaso(personal)
    const sinAbogado = verSinAbogado
      ? await citasParaPantalla(personal, await listarCitas(personal, { desde: hoyGuayaquil(), sinAbogado: true, soloActivas: true }))
      : []

    contenido = { abogados, elegido, lunes, domingo, dias, sinHorario, sinAbogado, verSinAbogado }
  } catch {
    redirect('/admin/crm')
  }
  const { abogados, elegido, lunes, domingo, dias, sinHorario, sinAbogado, verSinAbogado } = contenido
  const href = (semana: string) => `/admin/crm/agenda?${new URLSearchParams({ ...(elegido ? { abogado: elegido.id } : {}), semana })}`

  return (
    <div className="space-y-8 px-6 pb-16 pt-8">
      <div className="border-b border-border pb-6">
        <h1 className="font-cinzel text-3xl font-bold uppercase tracking-wider text-gold">Agenda</h1>
        <p className="mt-2 font-montserrat text-xs text-text-muted">
          Las citas se agendan desde el detalle de cada solicitud (pestaña «Citas»).
        </p>
      </div>

      {abogados.length === 0 ? (
        <p className="font-montserrat text-xs text-text-muted">
          {alcance === 'propio'
            ? 'Tu ficha no está marcada como abogado, así que no tienes agenda propia.'
            : 'Aún no hay abogados activos. Marca a una persona como abogado en su ficha del personal.'}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            {abogados.length > 1 && (
              <form method="get" className="flex items-end gap-3">
                <input type="hidden" name="semana" value={lunes} />
                <div>
                  <label htmlFor="ag-abogado" className={CLASE_ETIQUETA}>Abogado</label>
                  <select id="ag-abogado" name="abogado" defaultValue={elegido?.id} className={CLASE_INPUT}>
                    {abogados.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                </div>
                <button type="submit" className={BOTON_BARRA}>Ver</button>
              </form>
            )}
            <nav aria-label="Semanas" className="flex items-center gap-2">
              <Link href={href(sumarDias(lunes, -7))} className={BOTON_BARRA}>← Semana anterior</Link>
              <Link href={href(lunesDe(hoyGuayaquil()))} className={BOTON_BARRA}>Hoy</Link>
              <Link href={href(sumarDias(lunes, 7))} className={BOTON_BARRA}>Semana siguiente →</Link>
            </nav>
            {elegido && puedeVerHorario(personal, elegido.id) && (
              <Link href={`/admin/crm/personal/${elegido.id}/horario`} className={BOTON_BARRA}>Horario y ausencias</Link>
            )}
          </div>

          <h2 className="font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80">
            {elegido?.nombre} · {corto(lunes)} al {corto(domingo)}
          </h2>
          {sinHorario && (
            <p className="border border-border bg-card-bg px-4 py-3 font-montserrat text-xs text-text-muted">
              Este abogado aún no tiene horario configurado.{' '}
              {personal.rol === 'direccion' && elegido && (
                <Link href={`/admin/crm/personal/${elegido.id}/horario`} className="focus-gold text-gold underline underline-offset-2">Configurar su horario</Link>
              )}
            </p>
          )}
          <AgendaSemana dias={dias} />
        </>
      )}

      {verSinAbogado && (
        <section aria-labelledby="ag-sin-abogado" className="space-y-3">
          <h2 id="ag-sin-abogado" className="font-cinzel text-sm uppercase tracking-[0.25em] text-gold/80">Citas sin abogado</h2>
          <p className="font-montserrat text-xs text-text-muted">Reservas del sitio web que aún no tienen abogado. Asígnale uno desde «Asignar abogado».</p>
          <CitasLista citas={sinAbogado} mostrarCaso vacio="No hay citas próximas sin abogado." />
        </section>
      )}
    </div>
  )
}

function horaLocal(iso: string): string {
  const { minutos } = fechaYMinutosGuayaquil(new Date(iso))
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`
}

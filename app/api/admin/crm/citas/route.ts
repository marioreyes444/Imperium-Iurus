import { type NextRequest, NextResponse } from 'next/server'
import { autorizarApi, puedeGestionarCitasDe, puedeVerSolicitud } from '@/lib/crm/permisos'
import { jsonError, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { citaCrearSchema, citasQuerySchema, queryComoObjeto } from '@/lib/crm/schemas'
import { agendarCita, listarCitas } from '@/lib/crm/citas'
import { diasEntre, esFechaValida } from '@/lib/crm/fechas'

const ROLES = ['direccion', 'coordinacion', 'asistencia', 'asociado'] as const
const MAX_DIAS_LISTADO = 42

/** Citas visibles en un rango (agenda) o de un caso. Visibilidad aplicada EN la consulta. */
export async function GET(request: NextRequest) {
  const a = await autorizarApi(ROLES)
  if ('status' in a) return a

  const parsed = citasQuerySchema.safeParse(queryComoObjeto(request.nextUrl.searchParams))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data
  if (d.desde && d.hasta) {
    if (!esFechaValida(d.desde) || !esFechaValida(d.hasta)) return jsonError(400, 'Revisa los datos enviados.', { campos: { desde: 'Fecha inválida' } })
    if (diasEntre(d.desde, d.hasta) + 1 > MAX_DIAS_LISTADO) {
      return jsonError(400, 'Revisa los datos enviados.', { campos: { hasta: `Máximo ${MAX_DIAS_LISTADO} días` } })
    }
  }

  try {
    if (d.solicitud_id) {
      const nivel = await puedeVerSolicitud(a.personal, d.solicitud_id)
      if (nivel !== 'completo' && nivel !== 'sin_juridico') return jsonError(404, 'No encontrado')
    }
    if (a.personal.rol === 'asociado' && d.abogado_id && d.abogado_id !== a.personal.id && !d.solicitud_id) {
      return jsonError(403, 'Solo puedes ver tu propia agenda')
    }
    const items = await listarCitas(a.personal, { desde: d.desde, hasta: d.hasta, abogadoId: d.abogado_id, solicitudId: d.solicitud_id })
    return NextResponse.json({ items, siguienteCursor: null, total: items.length })
  } catch (e) {
    return respuestaExcepcion('admin/crm/citas GET', e)
  }
}

/**
 * Agenda una cita para un caso. Revalida la disponibilidad al guardar (11.1); un cruce de la base
 * responde 409 «Esa hora acaba de ocuparse» con las horas libres actualizadas.
 */
export async function POST(request: NextRequest) {
  const a = await autorizarApi(ROLES)
  if ('status' in a) return a

  const parsed = citaCrearSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data
  if (!esFechaValida(d.fecha)) return jsonError(400, 'Revisa los datos enviados.', { campos: { fecha: 'Fecha inválida' } })

  try {
    const nivel = await puedeVerSolicitud(a.personal, d.solicitud_id)
    if (!nivel) return jsonError(404, 'No encontrado')
    if (!puedeGestionarCitasDe(a.personal, nivel)) return jsonError(403, 'No tienes permiso para agendar en este caso')

    const r = await agendarCita(a.personal, d)
    if (!r.ok) return r.respuesta
    return NextResponse.json({ id: r.datos.id }, { status: 201 })
  } catch (e) {
    return respuestaExcepcion('admin/crm/citas POST', e)
  }
}

import { type NextRequest, NextResponse } from 'next/server'
import { autorizarApi, puedeVerSolicitud } from '@/lib/crm/permisos'
import { jsonError, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { actividadCrearSchema, actividadesQuerySchema, queryComoObjeto } from '@/lib/crm/schemas'
import { bandejaTareas, crearActividad, cronologiaDeCaso } from '@/lib/crm/actividades'

/**
 * GET con `solicitud_id`: cronología del caso. Sin él: bandeja de tareas (`tareas=mias|todas`).
 * Asistencia nunca recibe actividades jurídicas: se filtra en la consulta, no en pantalla.
 */
export async function GET(request: NextRequest) {
  const a = await autorizarApi()
  if ('status' in a) return a

  const parsed = actividadesQuerySchema.safeParse(queryComoObjeto(request.nextUrl.searchParams))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data

  try {
    if (d.solicitud_id) {
      const nivel = await puedeVerSolicitud(a.personal, d.solicitud_id)
      const r = nivel ? await cronologiaDeCaso(a.personal, d.solicitud_id, nivel, { cursor: d.cursor, limite: d.limite }) : null
      if (r === 'cursor_invalido') return jsonError(400, 'Cursor inválido')
      if (!r) return jsonError(404, 'No encontrado')
      return NextResponse.json(r)
    }
    const r = await bandejaTareas(a.personal, { modo: d.tareas ?? 'mias', estado: d.estado, cursor: d.cursor, limite: d.limite })
    if (r === 'cursor_invalido') return jsonError(400, 'Cursor inválido')
    return NextResponse.json(r)
  } catch (e) {
    return respuestaExcepcion('admin/crm/actividades GET', e)
  }
}

/** Registra una actividad (nota, llamada, mensaje, reunión, actuación o tarea) en un caso. */
export async function POST(request: NextRequest) {
  const a = await autorizarApi()
  if ('status' in a) return a

  const parsed = actividadCrearSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)

  try {
    const r = await crearActividad(a.personal, parsed.data)
    if (!r.ok) return r.respuesta
    return NextResponse.json({ id: r.datos.id }, { status: 201 })
  } catch (e) {
    return respuestaExcepcion('admin/crm/actividades POST', e)
  }
}

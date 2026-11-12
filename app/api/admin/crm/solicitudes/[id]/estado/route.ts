import { type NextRequest, NextResponse } from 'next/server'
import { autorizarApi, puedeVerSolicitud } from '@/lib/crm/permisos'
import { jsonError, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { estadoCambiarSchema, uuidSchema } from '@/lib/crm/schemas'
import { cambiarEstado } from '@/lib/crm/estados'

type Ctx = { params: Promise<{ id: string }> }

/**
 * ÚNICA vía manual para cambiar el estado de una solicitud. Quién puede cada cambio lo decide
 * `lib/crm/estados.ts` (sección 8.1); `asignada`, `en curso` desde asignada y la vuelta a pendiente de
 * asignación se hacen solo con las funciones de asignación (Entrega 3).
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion', 'coordinacion', 'asistencia', 'asociado'])
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = estadoCambiarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data

  try {
    const nivel = await puedeVerSolicitud(a.personal, id)
    if (!nivel) return jsonError(404, 'No encontrado')
    if (nivel === 'resumen' || nivel === 'reducido') return jsonError(403, 'No tienes permiso para este cambio de estado')

    const r = await cambiarEstado({
      personal: a.personal,
      solicitudId: id,
      hacia: d.hacia,
      motivo: d.motivo,
      resultado_cierre: d.resultado_cierre,
      pendientes_cierre: d.pendientes_cierre,
    })
    if (!r.ok) return r.respuesta
    return NextResponse.json({ ok: true, desde: r.desde, hacia: r.hacia })
  } catch (e) {
    return respuestaExcepcion('admin/crm/solicitudes/[id]/estado POST', e)
  }
}

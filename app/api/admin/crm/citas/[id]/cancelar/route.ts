import { type NextRequest, NextResponse } from 'next/server'
import { autorizarApi, puedeGestionarCita, puedeVerCita } from '@/lib/crm/permisos'
import { jsonError, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { citaCancelarSchema, uuidSchema } from '@/lib/crm/schemas'
import { cancelarCita, obtenerCita } from '@/lib/crm/citas'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Cancela con crm_cancelar_cita (R-37): motivo ≥ 5 caracteres y origen. Libera la hora, devuelve el caso a
 * calificación y crea la tarea de reagendar (responsable según la sección 8). No se reactiva (R-38).
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion', 'coordinacion', 'asistencia', 'asociado'])
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = citaCancelarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)

  try {
    const cita = await obtenerCita(id)
    if (!cita || !(await puedeVerCita(a.personal, cita))) return jsonError(404, 'No encontrado')
    if (!(await puedeGestionarCita(a.personal, cita))) return jsonError(403, 'No tienes permiso para esta acción')

    const r = await cancelarCita({ personal: a.personal, userId: a.user.id }, cita, parsed.data)
    if (!r.ok) return r.respuesta
    return NextResponse.json({ id })
  } catch (e) {
    return respuestaExcepcion('admin/crm/citas/[id]/cancelar POST', e)
  }
}

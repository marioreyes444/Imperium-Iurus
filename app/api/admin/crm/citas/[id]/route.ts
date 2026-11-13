import { type NextRequest, NextResponse } from 'next/server'
import { autorizarApi, puedeGestionarCita, puedeVerCita } from '@/lib/crm/permisos'
import { jsonError, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { citaEditarSchema, uuidSchema } from '@/lib/crm/schemas'
import { confirmarCita, marcarCita, obtenerCita, reprogramarCita } from '@/lib/crm/citas'
import { esFechaValida } from '@/lib/crm/fechas'

type Ctx = { params: Promise<{ id: string }> }

/** Reagendar / asignar abogado, confirmar, o marcar atendida / no asistió (R-39). */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion', 'coordinacion', 'asistencia', 'asociado'])
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = citaEditarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data

  try {
    const cita = await obtenerCita(id)
    if (!cita || !(await puedeVerCita(a.personal, cita))) return jsonError(404, 'No encontrado')
    if (!(await puedeGestionarCita(a.personal, cita))) return jsonError(403, 'No tienes permiso para esta acción')

    let r
    switch (d.accion) {
      case 'reprogramar':
        if (!esFechaValida(d.fecha)) return jsonError(400, 'Revisa los datos enviados.', { campos: { fecha: 'Fecha inválida' } })
        r = await reprogramarCita(a.personal, cita, d)
        break
      case 'confirmar':
        r = await confirmarCita(a.personal, cita)
        break
      case 'marcar':
        r = await marcarCita(a.personal, cita, d.resultado)
        break
    }
    if (!r.ok) return r.respuesta
    return NextResponse.json({ id })
  } catch (e) {
    return respuestaExcepcion('admin/crm/citas/[id] PATCH', e)
  }
}

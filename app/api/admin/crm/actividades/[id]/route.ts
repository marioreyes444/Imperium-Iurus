import { type NextRequest, NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { actividadEditarSchema, uuidSchema } from '@/lib/crm/schemas'
import { actualizarTarea } from '@/lib/crm/actividades'

type Ctx = { params: Promise<{ id: string }> }

/** Completar, cancelar, verificar un plazo jurídico (R-41) o reprogramar una tarea. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi()
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = actividadEditarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)

  try {
    const r = await actualizarTarea(a.personal, id, parsed.data)
    if (!r.ok) return r.respuesta
    return NextResponse.json({ id })
  } catch (e) {
    return respuestaExcepcion('admin/crm/actividades/[id] PATCH', e)
  }
}

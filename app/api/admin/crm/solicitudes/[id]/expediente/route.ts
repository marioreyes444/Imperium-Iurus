import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi, esTitularActivo, puedeEditarExpediente, puedeVerExpediente, puedeVerSolicitud } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { expedienteSchema, uuidSchema } from '@/lib/crm/schemas'
import { guardarExpediente } from '@/lib/crm/expediente'

type Ctx = { params: Promise<{ id: string }> }

/** Datos procesales del caso. D, C y el titular activo. Control de edición simultánea con `updated_at`. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion', 'coordinacion', 'asociado'])
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = expedienteSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const { updated_at, ...valores } = parsed.data

  try {
    const nivel = await puedeVerSolicitud(a.personal, id)
    if (!nivel) return jsonError(404, 'No encontrado')
    if (!puedeVerExpediente(nivel)) return jsonError(403, 'No tienes permiso para esta acción')
    if (!puedeEditarExpediente(a.personal, await esTitularActivo(a.personal.id, id))) {
      return jsonError(403, 'Solo Dirección, Coordinación y el titular del caso editan el expediente')
    }

    const { data: sol, error } = await supabase.from('crm_solicitudes').select('estado').eq('id', id).maybeSingle()
    if (error) return respuestaErrorBD('admin/crm/solicitudes/[id]/expediente PATCH', error)
    if (!sol) return jsonError(404, 'No encontrado')
    if (sol.estado === 'cerrada') return jsonError(409, 'Caso cerrado — solo lectura')

    const r = await guardarExpediente(a.user.id, id, updated_at, valores)
    if (!r.ok) return r.respuesta
    return NextResponse.json({ expediente: r.expediente })
  } catch (e) {
    return respuestaExcepcion('admin/crm/solicitudes/[id]/expediente PATCH', e)
  }
}

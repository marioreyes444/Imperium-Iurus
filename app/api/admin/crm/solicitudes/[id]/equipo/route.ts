import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi, puedeVerSolicitud } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { equipoProponerSchema, uuidSchema } from '@/lib/crm/schemas'
import { registrar } from '@/lib/crm/bitacora'

type Ctx = { params: Promise<{ id: string }> }

/** Estados en los que se arma equipo (R-22). */
const ESTADOS_CON_EQUIPO = ['aceptada_pendiente_asignacion', 'asignada', 'en_curso', 'en_espera']

/**
 * Paso 1 de la asignación (R-22): PROPONER. INSERT en `crm_solicitud_equipo` con estado `propuesto`
 * (no existe función de la base para este paso; la aprobación y la respuesta sí la tienen).
 * La base impone R-20, R-22, R-23 y R-24; aquí se validan antes para dar un mensaje claro.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion', 'coordinacion'])
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = equipoProponerSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data

  try {
    const nivel = await puedeVerSolicitud(a.personal, id)
    if (!nivel) return jsonError(404, 'No encontrado')
    if (nivel !== 'completo') return jsonError(403, 'No tienes permiso para esta acción')

    const { data: sol, error } = await supabase
      .from('crm_solicitudes').select('id,estado,conflicto_revision').eq('id', id).maybeSingle()
    if (error) return respuestaErrorBD('admin/crm/solicitudes/[id]/equipo POST (lectura)', error)
    if (!sol) return jsonError(404, 'No encontrado')

    if (!ESTADOS_CON_EQUIPO.includes(sol.estado)) {
      return jsonError(422, 'Solo se asigna equipo a un caso cuyo encargo ya fue aceptado.', { codigo: 'R-22' })
    }
    if (sol.conflicto_revision !== 'sin_conflicto') {
      return jsonError(422, 'Falta la revisión de conflictos de interés con resultado «sin conflicto».', { codigo: 'R-20' })
    }

    const { data: fila, error: errIns } = await supabase
      .from('crm_solicitud_equipo')
      .insert({
        solicitud_id: id,
        personal_id: d.personal_id,
        rol: d.rol,
        funciones: d.funciones ?? null,
        estado: 'propuesto',
        propuesto_por: a.user.id,
      })
      .select('id')
      .single()
    if (errIns) return respuestaErrorBD('admin/crm/solicitudes/[id]/equipo POST', errIns)

    await registrar({
      userId: a.user.id, accion: 'proponer_asignacion', entidad: 'crm_solicitudes', entidadId: id,
      detalle: { equipo: (fila as { id: string }).id, personal: d.personal_id, rol: d.rol },
    })
    return NextResponse.json({ ok: true, id: (fila as { id: string }).id }, { status: 201 })
  } catch (e) {
    return respuestaExcepcion('admin/crm/solicitudes/[id]/equipo POST', e)
  }
}

import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi, puedeVerSolicitud } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { conflictoSchema, uuidSchema } from '@/lib/crm/schemas'
import { registrar } from '@/lib/crm/bitacora'

type Ctx = { params: Promise<{ id: string }> }

/** Estados en los que se registra (o corrige) la revisión de conflictos: antes de aceptar el encargo. */
const ESTADOS_REVISABLES = [
  'nueva', 'en_calificacion', 'pendiente_informacion', 'consulta_agendada', 'propuesta_enviada', 'pendiente_aceptacion',
]

/**
 * Registra la revisión de conflictos de interés (R-20, R-21). No hay función de la base para esto:
 * es un UPDATE acotado a las columnas `conflicto_*` y protegido por el estado que se vio.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion', 'coordinacion'])
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = conflictoSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data

  try {
    const nivel = await puedeVerSolicitud(a.personal, id)
    if (!nivel) return jsonError(404, 'No encontrado')
    if (nivel !== 'completo') return jsonError(403, 'No tienes permiso para esta acción')

    const { data: sol, error } = await supabase
      .from('crm_solicitudes').select('id,estado,conflicto_revision').eq('id', id).maybeSingle()
    if (error) return respuestaErrorBD('admin/crm/solicitudes/[id]/conflicto (lectura)', error)
    if (!sol) return jsonError(404, 'No encontrado')

    if (!ESTADOS_REVISABLES.includes(sol.estado)) {
      if (sol.estado === 'cerrada' || sol.estado === 'descartada') {
        return jsonError(422, 'El caso está cerrado o descartado: la revisión de conflictos ya no se modifica.')
      }
      // R-29: con el encargo ya aceptado, la base no admite cambiar la revisión.
      return jsonError(
        422,
        'El encargo ya fue aceptado. Un conflicto descubierto ahora se resuelve reasignando con motivo «conflicto de interés» o cerrando el caso.',
        { codigo: 'R-29' },
      )
    }

    const { data: actualizada, error: errUpd } = await supabase
      .from('crm_solicitudes')
      .update({
        conflicto_revision: d.resultado,
        conflicto_detalle: d.detalle,
        conflicto_revisado_por: a.user.id,
        conflicto_revisado_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('estado', sol.estado)
      .select('id')
    if (errUpd) return respuestaErrorBD('admin/crm/solicitudes/[id]/conflicto', errUpd)
    if (!actualizada || actualizada.length === 0) return jsonError(409, 'Alguien más cambió el estado de esta solicitud; recarga.')

    // R-51: se registra el resultado, no el texto del detalle.
    await registrar({
      userId: a.user.id, accion: 'revisar_conflicto', entidad: 'crm_solicitudes', entidadId: id,
      antes: { conflicto_revision: sol.conflicto_revision }, despues: { conflicto_revision: d.resultado },
    })
    return NextResponse.json({ ok: true, conflicto_revision: d.resultado })
  } catch (e) {
    return respuestaExcepcion('admin/crm/solicitudes/[id]/conflicto POST', e)
  }
}

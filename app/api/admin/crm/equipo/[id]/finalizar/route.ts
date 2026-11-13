import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi, puedeVerSolicitud } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { equipoFinalizarSchema, uuidSchema } from '@/lib/crm/schemas'
import { registrar } from '@/lib/crm/bitacora'
import { ESTADOS_VIGENTES_EQUIPO, filaEquipo } from '@/lib/crm/asignacion'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Retira a un miembro del equipo. No hay función de la base para esto: UPDATE acotado a `estado`
 * (→ `finalizado`), protegido por el estado que se vio. Reglas:
 *   · Un titular solo se retira mientras está `propuesto` (propuesta equivocada). Un titular pendiente
 *     de confirmar o activo se cambia solo con «reasignar».
 *   · El motivo (mínimo 5 caracteres) es obligatorio y queda en la bitácora del caso.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion', 'coordinacion'])
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = equipoFinalizarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data

  try {
    const fila = await filaEquipo(id)
    if (!fila) return jsonError(404, 'No encontrado')
    const nivel = await puedeVerSolicitud(a.personal, fila.solicitud_id)
    if (!nivel) return jsonError(404, 'No encontrado')
    if (nivel !== 'completo') return jsonError(403, 'No tienes permiso para esta acción')

    if (!(ESTADOS_VIGENTES_EQUIPO as readonly string[]).includes(fila.estado)) {
      return jsonError(409, 'Esta persona ya no figura en el equipo; recarga.')
    }
    if (fila.rol === 'titular' && fila.estado !== 'propuesto') {
      return jsonError(422, 'Un titular pendiente de confirmar o activo se cambia con «Reasignar titular».')
    }

    const { data: actualizada, error } = await supabase
      .from('crm_solicitud_equipo')
      .update({ estado: 'finalizado' })
      .eq('id', id)
      .eq('estado', fila.estado)
      .select('id')
    if (error) return respuestaErrorBD('admin/crm/equipo/[id]/finalizar POST', error)
    if (!actualizada || actualizada.length === 0) return jsonError(409, 'El estado de esta persona cambió; recarga.')

    await registrar({
      userId: a.user.id, accion: 'actualizar', entidad: 'crm_solicitudes', entidadId: fila.solicitud_id,
      antes: { equipo_estado: fila.estado }, despues: { equipo_estado: 'finalizado' }, motivo: d.motivo,
      detalle: { equipo: id, personal: fila.personal_id, rol: fila.rol },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return respuestaExcepcion('admin/crm/equipo/[id]/finalizar POST', e)
  }
}

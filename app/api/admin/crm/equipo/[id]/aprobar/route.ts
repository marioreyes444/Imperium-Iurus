import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi, puedeVerSolicitud } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { equipoAprobarSchema, uuidSchema } from '@/lib/crm/schemas'
import { filaEquipo, recalcularEtapasDe } from '@/lib/crm/asignacion'
import { avisarAsignacionPorConfirmar } from '@/lib/crm/avisos'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Paso 2 de la asignación (R-22): APROBAR. Solo Dirección y solo con `crm_aprobar_asignacion` (la función
 * ya escribe la bitácora). Si la base responde R-26 (la persona está en su límite), la pantalla pide el
 * motivo y reintenta con `supera_capacidad = true`.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion'])
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = equipoAprobarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data

  try {
    const fila = await filaEquipo(id)
    if (!fila) return jsonError(404, 'No encontrado')
    if (!(await puedeVerSolicitud(a.personal, fila.solicitud_id))) return jsonError(404, 'No encontrado')

    const { error } = await supabase.rpc('crm_aprobar_asignacion', {
      p_equipo: id,
      p_usuario: a.user.id,
      p_supera_capacidad: d.supera_capacidad ?? false,
      p_motivo_capacidad: d.supera_capacidad ? d.motivo_capacidad : null,
    })
    if (error) return respuestaErrorBD('admin/crm/equipo/[id]/aprobar POST', error)

    // Después de la acción principal (best-effort, nunca la deshace).
    await recalcularEtapasDe(fila.solicitud_id)
    // El suplente queda «en reserva» (sin acceso): no tiene nada que confirmar todavía.
    if (fila.rol !== 'suplente') {
      await avisarAsignacionPorConfirmar({ solicitudId: fila.solicitud_id, codigo: fila.solicitud.codigo, userId: fila.persona_user_id })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return respuestaExcepcion('admin/crm/equipo/[id]/aprobar POST', e)
  }
}

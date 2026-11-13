import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { equipoResponderSchema, uuidSchema } from '@/lib/crm/schemas'
import { filaEquipo, recalcularEtapasDe } from '@/lib/crm/asignacion'
import { avisarAsignacionRechazada } from '@/lib/crm/avisos'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Paso 3 de la asignación (R-22): CONFIRMAR o RECHAZAR la propia asignación. Cualquier persona del
 * personal con ficha activa puede llamarla, pero SOLO sobre una fila suya (la cuenta de la fila debe ser
 * la que llama; si no, 404). El rol no importa: un abogado de Coordinación o Dirección también puede ser
 * titular. La base lo vuelve a comprobar dentro de `crm_responder_asignacion`, que ya escribe la bitácora.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi()
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = equipoResponderSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data

  try {
    const fila = await filaEquipo(id)
    // Una fila ajena responde 404: no se revela que existe.
    if (!fila || fila.personal_id !== a.personal.id || fila.persona_user_id !== a.user.id) return jsonError(404, 'No encontrado')

    const { error } = await supabase.rpc('crm_responder_asignacion', {
      p_equipo: id,
      p_usuario: a.user.id,
      p_acepta: d.acepta,
      p_motivo: d.acepta ? null : d.motivo,
    })
    if (error) return respuestaErrorBD('admin/crm/equipo/[id]/responder POST', error)

    await recalcularEtapasDe(fila.solicitud_id)
    if (!d.acepta) {
      await avisarAsignacionRechazada({
        solicitudId: fila.solicitud_id,
        codigo: fila.solicitud.codigo,
        reservada: fila.solicitud.reserva_reforzada,
        propuestoPor: fila.propuesto_por,
      })
    }
    return NextResponse.json({ ok: true, acepta: d.acepta })
  } catch (e) {
    return respuestaExcepcion('admin/crm/equipo/[id]/responder POST', e)
  }
}

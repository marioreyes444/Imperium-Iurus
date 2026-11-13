import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi, puedeVerSolicitud } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { reasignarSchema, uuidSchema } from '@/lib/crm/schemas'
import { recalcularEtapasDe } from '@/lib/crm/asignacion'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Cambia el titular de un caso o activa al suplente (R-27). Solo Dirección y solo con
 * `crm_reasignar_titular` (todo o nada; la función ya escribe la bitácora y el historial de reasignaciones).
 * Para activar al suplente, `nuevo_titular_id` es la ficha del suplente. R-29: un conflicto descubierto con
 * el caso en curso se resuelve con motivo `conflicto_interes`. Si la base responde R-26, la pantalla pide el
 * motivo y reintenta con `supera_capacidad = true`.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion'])
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = reasignarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data

  try {
    if (!(await puedeVerSolicitud(a.personal, id))) return jsonError(404, 'No encontrado')

    const { error } = await supabase.rpc('crm_reasignar_titular', {
      p_solicitud: id,
      p_nuevo_titular: d.nuevo_titular_id,
      p_motivo: d.motivo,
      p_autorizado_por: a.user.id,
      p_detalle: d.detalle ?? null,
      p_entrega_documentada: d.entrega_documentada ?? false,
      p_supera_capacidad: d.supera_capacidad ?? false,
      p_motivo_capacidad: d.supera_capacidad ? d.motivo_capacidad : null,
    })
    if (error) return respuestaErrorBD('admin/crm/solicitudes/[id]/reasignar POST', error)

    await recalcularEtapasDe(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return respuestaExcepcion('admin/crm/solicitudes/[id]/reasignar POST', e)
  }
}

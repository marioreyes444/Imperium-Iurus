import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi, puedeVerSolicitud } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { uuidSchema, validarSolicitudSchema } from '@/lib/crm/schemas'
import { registrar } from '@/lib/crm/bitacora'
import { cambiarEstado } from '@/lib/crm/estados'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Bandeja de validación: un envío marcado como sospechoso se VALIDA (se le quita la marca) o se
 * DESCARTA con motivo. Dirección, coordinación y asistencia.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion', 'coordinacion', 'asistencia'])
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = validarSolicitudSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const { accion, motivo } = parsed.data

  try {
    const nivel = await puedeVerSolicitud(a.personal, id)
    if (!nivel) return jsonError(404, 'No encontrado')

    const { data: sol, error } = await supabase
      .from('crm_solicitudes').select('id,estado,requiere_validacion').eq('id', id).maybeSingle()
    if (error) return respuestaErrorBD('admin/crm/solicitudes/[id]/validar (lectura)', error)
    if (!sol) return jsonError(404, 'No encontrado')
    if (sol.estado !== 'nueva' || !sol.requiere_validacion) {
      return jsonError(409, 'Esta solicitud ya no está pendiente de validación; recarga.')
    }

    if (accion === 'descartar') {
      if (!motivo) {
        return jsonError(400, 'Revisa los datos enviados.', { campos: { motivo: 'Indica el motivo (mínimo 5 caracteres)' } })
      }
      // Pasa por cambiarEstado: coordinación y asistencia pueden descartar un envío por validar.
      const r = await cambiarEstado({ personal: a.personal, solicitudId: id, hacia: 'descartada', motivo })
      if (!r.ok) return r.respuesta
      return NextResponse.json({ ok: true, accion })
    }

    // Validar: solo se quita la marca (si otra persona ya lo hizo, no afecta filas).
    const { data: actualizada, error: errUpd } = await supabase
      .from('crm_solicitudes')
      .update({ requiere_validacion: false })
      .eq('id', id)
      .eq('requiere_validacion', true)
      .select('id')
    if (errUpd) return respuestaErrorBD('admin/crm/solicitudes/[id]/validar', errUpd)
    if (!actualizada || actualizada.length === 0) return jsonError(409, 'Esta solicitud ya fue validada; recarga.')

    await registrar({
      userId: a.user.id, accion: 'actualizar', entidad: 'crm_solicitudes', entidadId: id,
      antes: { requiere_validacion: true }, despues: { requiere_validacion: false }, motivo: motivo ?? null,
    })
    return NextResponse.json({ ok: true, accion })
  } catch (e) {
    return respuestaExcepcion('admin/crm/solicitudes/[id]/validar POST', e)
  }
}

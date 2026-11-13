import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi, puedeMarcarReservaEnCaso, puedeQuitarReserva, puedeVerSolicitud } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { solicitudEditarSchema, uuidSchema } from '@/lib/crm/schemas'
import { registrar } from '@/lib/crm/bitacora'
import { avisarSolicitudCritica } from '@/lib/crm/avisos'
import { detalleSolicitud } from '@/lib/crm/detalles'
import { COLUMNAS_SOLICITUD, type SolicitudFila } from '@/lib/crm/solicitudes'

type Ctx = { params: Promise<{ id: string }> }

const ROLES_LECTURA = ['direccion', 'coordinacion', 'asistencia', 'asociado', 'externo'] as const
const ROLES_EDICION = ['direccion', 'coordinacion', 'asistencia', 'asociado'] as const

const CAMPOS = ['descripcion', 'objetivo_cliente', 'modalidad', 'urgencia', 'area_principal_id', 'servicio_id', 'empresa_id'] as const
/** El contenido de estos campos no se copia a la bitácora. */
const SIN_CONTENIDO_EN_BITACORA = new Set<string>(['descripcion', 'objetivo_cliente'])

export async function GET(_request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(ROLES_LECTURA)
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  try {
    // Un caso que no puede ver responde 404 (no 403), para no revelar que existe.
    const detalle = await detalleSolicitud(a.personal, id)
    return detalle ? NextResponse.json(detalle) : jsonError(404, 'No encontrado')
  } catch (e) {
    return respuestaExcepcion('admin/crm/solicitudes/[id] GET', e)
  }
}

/** Solo datos de calificación. NUNCA cambia `estado` (eso es POST …/estado). */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(ROLES_EDICION)
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = solicitudEditarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data
  const rol = a.personal.rol

  try {
    const nivel = await puedeVerSolicitud(a.personal, id)
    if (!nivel) return jsonError(404, 'No encontrado')
    // Resumen o vista reducida: no edita. El asociado edita solo con acceso completo (sus casos).
    if (nivel === 'resumen' || nivel === 'reducido') return jsonError(403, 'No tienes permiso para editar este caso')

    const { data, error } = await supabase.from('crm_solicitudes').select(COLUMNAS_SOLICITUD).eq('id', id).maybeSingle()
    if (error) return respuestaErrorBD('admin/crm/solicitudes/[id] PATCH (lectura)', error)
    if (!data) return jsonError(404, 'No encontrado')
    const actual = data as unknown as SolicitudFila

    // Caso cerrado: solo lectura para todos.
    if (actual.estado === 'cerrada') return jsonError(422, 'Caso cerrado: solo lectura.')

    const entrada = d as Record<string, unknown>
    const previo = actual as unknown as Record<string, unknown>
    const cambios: Record<string, unknown> = {}
    for (const campo of CAMPOS) {
      const nuevo = entrada[campo]
      if (nuevo !== undefined && nuevo !== previo[campo]) cambios[campo] = nuevo
    }
    // Cambiar el área sin indicar servicio: el servicio anterior ya no corresponde (R-15).
    if ('area_principal_id' in cambios && !('servicio_id' in cambios) && actual.servicio_id) cambios.servicio_id = null

    // Reserva reforzada: marcar D, C y el asociado en sus casos; quitar solo Dirección.
    if (d.reserva_reforzada !== undefined && d.reserva_reforzada !== actual.reserva_reforzada) {
      const permitido = d.reserva_reforzada ? puedeMarcarReservaEnCaso(rol) : puedeQuitarReserva(rol)
      if (!permitido) return jsonError(403, 'No tienes permiso para cambiar la reserva reforzada')
      cambios.reserva_reforzada = d.reserva_reforzada
    }
    if (Object.keys(cambios).length === 0) return jsonError(422, 'No hay cambios que guardar.')

    // Edición simultánea: solo aplica si nadie modificó el registro.
    const { data: actualizado, error: errUpd } = await supabase
      .from('crm_solicitudes')
      .update(cambios)
      .eq('id', id)
      .eq('updated_at', d.updated_at)
      .select('id,codigo,urgencia,reserva_reforzada,updated_at')
    if (errUpd) return respuestaErrorBD('admin/crm/solicitudes/[id] PATCH', errUpd)
    if (!actualizado || actualizado.length === 0) return jsonError(409, 'Alguien más modificó este registro; recarga.')
    const nueva = actualizado[0] as { id: string; codigo: string; urgencia: string; reserva_reforzada: boolean; updated_at: string }

    // Efectos posteriores (best-effort).
    const antes: Record<string, unknown> = {}
    const despues: Record<string, unknown> = {}
    for (const k of Object.keys(cambios)) {
      antes[k] = SIN_CONTENIDO_EN_BITACORA.has(k) ? '[editado]' : previo[k]
      despues[k] = SIN_CONTENIDO_EN_BITACORA.has(k) ? '[editado]' : cambios[k]
    }
    await registrar({ userId: a.user.id, accion: 'actualizar', entidad: 'crm_solicitudes', entidadId: id, antes, despues })

    // R-16: al subirla a crítica al calificar, aviso inmediato.
    if (cambios.urgencia === 'critica' && actual.urgencia !== 'critica') {
      await avisarSolicitudCritica({ id, codigo: nueva.codigo, reservada: nueva.reserva_reforzada })
    }

    return NextResponse.json({ solicitud: nueva })
  } catch (e) {
    return respuestaExcepcion('admin/crm/solicitudes/[id] PATCH', e)
  }
}

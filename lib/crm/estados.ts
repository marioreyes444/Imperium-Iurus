// Estados de una solicitud: tabla de transiciones (R-12), quién puede cada cambio (sección 8.1)
// y `cambiarEstado()`, la ÚNICA vía manual para cambiarlos. La base impone las reglas (R-12, R-13,
// R-14, R-20…); aquí se validan antes para dar un mensaje claro y se hacen los efectos posteriores.
import type { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { registrar, type AccionBitacora } from '@/lib/crm/bitacora'
import { esTablaAusente, jsonError, respuestaErrorBD } from '@/lib/crm/errores'
import { recalcularEtapa } from '@/lib/crm/etapas'
import { hoyGuayaquil } from '@/lib/crm/fechas'
import { marcarPrimeraRespuesta } from '@/lib/crm/solicitudes'
import type { Personal } from '@/lib/crm/permisos'
import type { Rol } from '@/lib/crm/roles'
import type { ESTADOS_SOLICITUD } from '@/lib/crm/schemas'

export type Estado = (typeof ESTADOS_SOLICITUD)[number]

export const ETIQUETA_ESTADO: Record<Estado, string> = {
  nueva: 'Nueva',
  en_calificacion: 'En calificación',
  pendiente_informacion: 'Pendiente de información',
  consulta_agendada: 'Consulta agendada',
  propuesta_enviada: 'Propuesta enviada',
  pendiente_aceptacion: 'Pendiente de aceptación',
  aceptada_pendiente_asignacion: 'Aceptada, pendiente de asignación',
  asignada: 'Asignada',
  en_curso: 'En curso',
  en_espera: 'En espera',
  cerrada: 'Cerrada',
  descartada: 'Descartada',
}

/** Fase para el indicador (9.5): por atender · en trámite · activo · terminado. */
export type FaseEstado = 'por_atender' | 'en_tramite' | 'activo' | 'terminado'
export const FASE_ESTADO: Record<Estado, FaseEstado> = {
  nueva: 'por_atender',
  en_calificacion: 'en_tramite',
  pendiente_informacion: 'en_tramite',
  consulta_agendada: 'en_tramite',
  propuesta_enviada: 'en_tramite',
  pendiente_aceptacion: 'en_tramite',
  aceptada_pendiente_asignacion: 'en_tramite',
  asignada: 'activo',
  en_curso: 'activo',
  en_espera: 'activo',
  cerrada: 'terminado',
  descartada: 'terminado',
}

/** R-12: transiciones que admite la base. */
export const TRANSICIONES: Record<Estado, readonly Estado[]> = {
  nueva: ['en_calificacion', 'descartada'],
  en_calificacion: ['pendiente_informacion', 'consulta_agendada', 'propuesta_enviada', 'descartada'],
  pendiente_informacion: ['en_calificacion', 'descartada'],
  consulta_agendada: ['en_calificacion', 'propuesta_enviada', 'descartada'],
  propuesta_enviada: ['pendiente_aceptacion', 'descartada'],
  pendiente_aceptacion: ['aceptada_pendiente_asignacion', 'descartada'],
  aceptada_pendiente_asignacion: ['asignada', 'descartada'],
  asignada: ['en_curso', 'aceptada_pendiente_asignacion'],
  en_curso: ['en_espera', 'cerrada'],
  en_espera: ['en_curso', 'cerrada'],
  cerrada: ['en_curso'],
  descartada: ['en_calificacion'],
}

/** Cambios que NUNCA se hacen por la ruta de estado: solo con las funciones de asignación (Entrega 3). */
const SOLO_POR_FUNCION = new Set<string>([
  'aceptada_pendiente_asignacion>asignada',
  'asignada>en_curso',
  'asignada>aceptada_pendiente_asignacion',
])

export const esReapertura = (desde: Estado) => desde === 'cerrada' || desde === 'descartada'

export type ContextoEstado = {
  estado: Estado
  requiereValidacion: boolean
  /** La persona es titular ACTIVO del caso. */
  esTitularActivo: boolean
}

export function transicionValida(desde: Estado, hacia: Estado): boolean {
  return TRANSICIONES[desde].includes(hacia) && !SOLO_POR_FUNCION.has(`${desde}>${hacia}`)
}

/** Sección 8.1: quién puede hacer cada cambio de estado. */
export function rolPuedeCambiar(rol: Rol, ctx: ContextoEstado, hacia: Estado): boolean {
  const desde = ctx.estado
  if (!transicionValida(desde, hacia)) return false

  if (esReapertura(desde)) return rol === 'direccion'
  if (hacia === 'descartada') {
    if (rol === 'direccion') return true
    // Coordinación y asistencia solo descartan un envío por validar.
    return (rol === 'coordinacion' || rol === 'asistencia') && desde === 'nueva' && ctx.requiereValidacion
  }
  if (hacia === 'aceptada_pendiente_asignacion') return rol === 'direccion'
  if (hacia === 'en_espera' || hacia === 'cerrada' || (desde === 'en_espera' && hacia === 'en_curso')) {
    return rol === 'direccion' || rol === 'coordinacion' || ctx.esTitularActivo
  }
  // Hacia calificación, información pendiente, consulta agendada, propuesta enviada o pendiente de aceptación.
  return rol === 'direccion' || rol === 'coordinacion' || rol === 'asistencia'
}

/** Estados que ofrece «Cambiar estado» a esa persona: solo los permitidos desde el actual. */
export function estadosPermitidos(rol: Rol, ctx: ContextoEstado): Estado[] {
  return TRANSICIONES[ctx.estado].filter((h) => rolPuedeCambiar(rol, ctx, h))
}

/** R-13: espera, descarte, cierre y reapertura exigen motivo en ese mismo cambio. */
export function exigeMotivo(desde: Estado, hacia: Estado): boolean {
  return hacia === 'en_espera' || hacia === 'descartada' || hacia === 'cerrada' || esReapertura(desde)
}

// ─── cambiarEstado ──────────────────────────────────────────────────────────

export type CambioEstado = {
  personal: Personal
  solicitudId: string
  hacia: Estado
  motivo?: string | null
  resultado_cierre?: string | null
  pendientes_cierre?: string | null
}

export type ResultadoCambio =
  | { ok: true; desde: Estado; hacia: Estado }
  | { ok: false; respuesta: NextResponse }

const fallo = (respuesta: NextResponse): ResultadoCambio => ({ ok: false, respuesta })

/**
 * Cambia el estado de una solicitud. El llamador YA comprobó que la persona puede ver el caso.
 * Después del cambio (best-effort, nunca lo deshace): tareas pendientes → canceladas si se descarta
 * (R-19), `primera_respuesta_at` si sale de «nueva», etapa del contacto y bitácora.
 */
export async function cambiarEstado(c: CambioEstado): Promise<ResultadoCambio> {
  const { personal, solicitudId, hacia } = c
  const motivo = c.motivo?.trim() || null

  const { data: sol, error: errSol } = await supabase
    .from('crm_solicitudes')
    .select('id,estado,contacto_id,empresa_id,requiere_validacion,conflicto_revision')
    .eq('id', solicitudId)
    .maybeSingle()
  if (errSol) return fallo(respuestaErrorBD('crm/estados (lectura)', errSol))
  if (!sol) return fallo(jsonError(404, 'No encontrado'))

  const desde = sol.estado as Estado

  // R-12: transición válida (409: choca con el estado actual).
  if (!transicionValida(desde, hacia)) {
    return fallo(jsonError(409, `No se puede pasar de «${ETIQUETA_ESTADO[desde]}» a «${ETIQUETA_ESTADO[hacia]}» desde aquí.`))
  }

  // Titular activo (para en espera / cierre por el titular).
  const { data: titular, error: errTit } = await supabase
    .from('crm_solicitud_equipo')
    .select('id')
    .eq('solicitud_id', solicitudId)
    .eq('personal_id', personal.id)
    .eq('rol', 'titular')
    .eq('estado', 'activo')
    .limit(1)
  if (errTit && !esTablaAusente(errTit)) console.error('[crm/estados] titular', errTit.code)

  const ctx: ContextoEstado = {
    estado: desde,
    requiereValidacion: sol.requiere_validacion === true,
    esTitularActivo: (titular ?? []).length > 0,
  }
  if (!rolPuedeCambiar(personal.rol, ctx, hacia)) {
    return fallo(jsonError(403, 'No tienes permiso para este cambio de estado'))
  }

  // R-13: motivo en este mismo cambio.
  if (exigeMotivo(desde, hacia) && !motivo) {
    return fallo(jsonError(400, 'Revisa los datos enviados.', { campos: { motivo: 'Indica el motivo (mínimo 5 caracteres)' } }))
  }

  // R-20: sin revisión «sin conflicto» no se acepta el encargo.
  if (hacia === 'aceptada_pendiente_asignacion' && sol.conflicto_revision !== 'sin_conflicto') {
    return fallo(jsonError(422, 'Sin una revisión de conflictos con resultado «sin conflicto» no se puede aceptar el encargo.', { codigo: 'R-20' }))
  }

  // R-18: no se cierra ni descarta con citas futuras activas (la base también lo impone con M5).
  if (hacia === 'cerrada' || hacia === 'descartada') {
    const { data: citas, error: errCitas } = await supabase
      .from('citas')
      .select('id')
      .eq('solicitud_id', solicitudId)
      .in('estado', ['pendiente', 'confirmada'])
      .gte('fecha', hoyGuayaquil())
      .limit(1)
    // 42703 = la columna solicitud_id aún no existe (M5 sin aplicar): no hay citas vinculadas que revisar.
    if (errCitas && errCitas.code !== '42703' && !esTablaAusente(errCitas)) console.error('[crm/estados] citas', errCitas.code)
    if ((citas ?? []).length > 0) {
      return fallo(jsonError(422, 'El caso tiene citas futuras activas. Cancélalas antes de cerrarlo o descartarlo.', { codigo: 'R-18' }))
    }
  }

  // R-14: el cierre exige resultado; con tareas abiertas, además, las pendientes de cumplimiento.
  const cambios: Record<string, unknown> = {
    estado: hacia,
    motivo_estado: motivo,
    estado_por: personal.user_id,
  }
  if (hacia === 'cerrada') {
    const resultado = c.resultado_cierre?.trim()
    if (!resultado) {
      return fallo(jsonError(400, 'Revisa los datos enviados.', { campos: { resultado_cierre: 'Indica el resultado del cierre' } }))
    }
    const { count } = await supabase
      .from('crm_actividades')
      .select('id', { count: 'exact', head: true })
      .eq('solicitud_id', solicitudId)
      .eq('estado_tarea', 'pendiente')
    const pendientes = c.pendientes_cierre?.trim() || null
    if ((count ?? 0) > 0 && !pendientes) {
      return fallo(jsonError(422, 'Hay tareas abiertas: complétalas o regístralas como pendientes de cumplimiento.', {
        codigo: 'R-14', campos: { pendientes_cierre: 'Indica qué tareas quedan pendientes de cumplimiento' },
      }))
    }
    cambios.resultado_cierre = resultado
    cambios.pendientes_cierre = pendientes
  }

  // UPDATE solo si el estado sigue siendo el que vimos (otra persona pudo cambiarlo).
  const { data: actualizada, error } = await supabase
    .from('crm_solicitudes')
    .update(cambios)
    .eq('id', solicitudId)
    .eq('estado', desde)
    .select('id')
  if (error) return fallo(respuestaErrorBD('crm/estados (cambio)', error))
  if (!actualizada || actualizada.length === 0) {
    return fallo(jsonError(409, 'Alguien más cambió el estado de esta solicitud; recarga.'))
  }

  // ── Efectos posteriores: best-effort, nunca deshacen el cambio ──────────────
  try {
    if (hacia === 'descartada') {
      // R-19: las tareas pendientes del caso pasan a «cancelada».
      const { error: errTareas } = await supabase
        .from('crm_actividades')
        .update({ estado_tarea: 'cancelada' })
        .eq('solicitud_id', solicitudId)
        .eq('estado_tarea', 'pendiente')
      if (errTareas) console.error('[crm/estados] cancelar tareas', errTareas.code)
    }
    if (desde === 'nueva') await marcarPrimeraRespuesta(solicitudId)

    await recalcularEtapa(sol.contacto_id)
    if (sol.empresa_id) await recalcularEtapa(sol.empresa_id)

    const accion: AccionBitacora = hacia === 'cerrada' ? 'cerrar' : esReapertura(desde) ? 'reabrir' : 'cambiar_estado'
    await registrar({
      userId: personal.user_id,
      accion,
      entidad: 'crm_solicitudes',
      entidadId: solicitudId,
      antes: { estado: desde },
      despues: { estado: hacia },
      motivo,
    })
  } catch (e) {
    console.error('[crm/estados] efectos posteriores', e instanceof Error ? e.name : 'error')
  }

  return { ok: true, desde, hacia }
}

import { NextResponse } from 'next/server'
import type { ZodError } from 'zod'

export type CuerpoError = {
  error: string
  codigo?: string
  campos?: Record<string, string>
  datos?: unknown
}

export function jsonError(status: number, error: string, extra: Omit<CuerpoError, 'error'> = {}) {
  const cuerpo: CuerpoError = { error, ...extra }
  return NextResponse.json(cuerpo, { status })
}

/** 400 con el detalle por campo. */
export function respuestaZod(err: ZodError) {
  const campos: Record<string, string> = {}
  for (const issue of err.issues) {
    const clave = issue.path.join('.') || '_'
    if (!(clave in campos)) campos[clave] = issue.message
  }
  return jsonError(400, 'Revisa los datos enviados.', { campos })
}

type ErrorBD = { code?: string; message?: string; details?: string | null }

/** El módulo no está disponible: tablas ausentes (migraciones M4/M5 sin aplicar). */
export function esTablaAusente(error: ErrorBD | null | undefined): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202' || error.code === '42883'
}

/**
 * Traduce un error de la base a una respuesta HTTP (sección 7).
 * Nunca devuelve `error.message` de Supabase al navegador.
 */
export function respuestaErrorBD(contexto: string, error: ErrorBD) {
  const msg = error.message ?? ''
  const detalle = `${msg} ${error.details ?? ''}`

  if (error.code === 'P0001') {
    const m = /^CRM-R(\d+):\s*([\s\S]+)$/.exec(msg)
    if (m) return jsonError(422, m[2].trim(), { codigo: `R-${m[1]}` })
  }
  if (error.code === '23P01' && detalle.includes('citas_sin_cruce_abogado'))
    return jsonError(409, 'Esa hora acaba de ocuparse')
  if (error.code === '23P01' && detalle.includes('crm_horarios_sin_solape'))
    return jsonError(422, 'Esa franja se cruza con otra del mismo día')
  if (error.code === '23505') {
    if (detalle.includes('citas_un_turno_sin_abogado')) return jsonError(409, 'Horario no disponible')
    if (detalle.includes('crm_contactos_identificacion_key')) return jsonError(409, 'Ya existe una ficha con esa identificación')
    if (detalle.includes('crm_solicitud_equipo_un_titular')) return jsonError(422, 'El caso ya tiene un titular')
    if (detalle.includes('crm_solicitud_equipo_miembro_vigente')) return jsonError(422, 'Esa persona ya está en el equipo')
    if (detalle.includes('crm_personal_areas_un_titular')) return jsonError(422, 'El área ya tiene titular de referencia')
    if (detalle.includes('crm_personal_areas_un_suplente')) return jsonError(422, 'El área ya tiene suplente de referencia')
    if (detalle.includes('crm_personal_user_id_key')) return jsonError(409, 'Esa cuenta ya tiene una ficha')
  }
  if (error.code === '23514') {
    // Defecto de validación: se registra la restricción, no se expone.
    console.error(`[${contexto}] CHECK violado:`, msg)
    return jsonError(422, 'El dato no cumple una regla del sistema')
  }
  if (esTablaAusente(error)) {
    console.error(`[${contexto}] tabla o función ausente (¿migración M4/M5 sin aplicar?):`, error.code)
    return jsonError(503, 'El módulo CRM aún no está disponible en este entorno.', { codigo: 'CRM_NO_DISPONIBLE' })
  }
  console.error(`[${contexto}] Supabase error:`, error.code, msg)
  return jsonError(502, 'Ocurrió un error inesperado. Inténtalo de nuevo.')
}

/**
 * Respuesta para una excepción no prevista en una ruta. Las tablas ausentes (migraciones sin aplicar)
 * dan 503; cualquier otra cosa, 502 genérico. En el log queda solo el nombre del error, sin datos personales.
 */
export function respuestaExcepcion(contexto: string, e: unknown) {
  if (e instanceof Error && e.message === 'CRM_NO_DISPONIBLE') {
    return jsonError(503, 'El módulo CRM aún no está disponible en este entorno.', { codigo: 'CRM_NO_DISPONIBLE' })
  }
  console.error(`[${contexto}] error inesperado:`, e instanceof Error ? e.name : 'error')
  return jsonError(502, 'Ocurrió un error inesperado. Inténtalo de nuevo.')
}

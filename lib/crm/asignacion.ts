// Asignación de equipo (Entrega 3): lecturas del equipo de un caso y de las asignaciones por confirmar.
// Las ESCRITURAS de aprobar, responder y reasignar se hacen solo con las funciones de la base
// (crm_aprobar_asignacion, crm_responder_asignacion, crm_reasignar_titular); aquí solo se lee.
import { supabase } from '@/lib/supabase'
import { esTablaAusente } from '@/lib/crm/errores'
import { CrmNoDisponibleError, type Personal } from '@/lib/crm/permisos'
import { obtenerCatalogo } from '@/lib/crm/catalogo'
import { recalcularEtapa } from '@/lib/crm/etapas'
import { ROLES_EQUIPO, MOTIVOS_REASIGNACION } from '@/lib/crm/schemas'

export const ETIQUETA_ROL_EQUIPO: Record<(typeof ROLES_EQUIPO)[number], string> = {
  titular: 'Titular',
  suplente: 'Suplente',
  coordinador: 'Coordinador',
  apoyo: 'Apoyo',
  perito: 'Perito',
}

export const ETIQUETA_ESTADO_EQUIPO: Record<string, string> = {
  propuesto: 'Propuesto, por aprobar',
  pendiente_confirmacion: 'Aprobado, por confirmar',
  activo: 'Activo',
  en_reserva: 'Suplente en reserva',
  rechazado: 'Rechazado',
  finalizado: 'Finalizado',
}

export const ETIQUETA_MOTIVO_REASIGNACION: Record<(typeof MOTIVOS_REASIGNACION)[number], string> = {
  ausencia: 'Ausencia',
  vacaciones: 'Vacaciones',
  exceso_carga: 'Exceso de carga',
  impedimento: 'Impedimento',
  conflicto_interes: 'Conflicto de interés',
  especialidad_complementaria: 'Especialidad complementaria',
  inactividad: 'Inactividad',
  otro: 'Otro',
}

/** Estados de una fila de equipo que cuentan como vigentes. */
export const ESTADOS_VIGENTES_EQUIPO = ['propuesto', 'pendiente_confirmacion', 'activo', 'en_reserva'] as const

type PersonaMin = { id: string; nombres: string; apellidos: string; rol: string; capacidad_maxima: number | null }

export type MiembroEquipo = {
  id: string
  personal_id: string
  nombre: string
  rol_persona: string
  rol: string
  estado: string
  funciones: string | null
  supera_capacidad: boolean
  motivo_supera_capacidad: string | null
  motivo_rechazo: string | null
  carga: number | null
  capacidad: number | null
  propuesto_at: string
}

/**
 * Equipo de un caso: filas vigentes y las cerradas recientes. El llamador YA comprobó que la persona puede
 * ver el caso (nivel `completo` o `sin_juridico`); el nivel `resumen` y `reducido` no lo reciben.
 */
export async function equipoDeSolicitud(solicitudId: string): Promise<MiembroEquipo[]> {
  const { data, error } = await supabase
    .from('crm_solicitud_equipo')
    .select('id,personal_id,rol,funciones,estado,supera_capacidad,motivo_supera_capacidad,motivo_rechazo,propuesto_at')
    .eq('solicitud_id', solicitudId)
    .order('propuesto_at', { ascending: true })
  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    console.error('[crm/asignacion] equipo', error.code)
    throw new Error('CRM_ERROR')
  }
  const filas = (data ?? []) as {
    id: string; personal_id: string; rol: string; funciones: string | null; estado: string
    supera_capacidad: boolean; motivo_supera_capacidad: string | null; motivo_rechazo: string | null; propuesto_at: string
  }[]
  if (filas.length === 0) return []

  const ids = [...new Set(filas.map((f) => f.personal_id))]
  const { data: personas } = await supabase.from('crm_personal').select('id,nombres,apellidos,rol,capacidad_maxima').in('id', ids)
  const porId = new Map(((personas ?? []) as PersonaMin[]).map((p) => [p.id, p]))
  const { data: cargas } = await supabase.from('crm_v_carga_personal').select('personal_id,carga_titular').in('personal_id', ids)
  const cargaDe = new Map(((cargas ?? []) as { personal_id: string; carga_titular: number }[]).map((c) => [c.personal_id, c.carga_titular]))

  return filas.map((f) => {
    const p = porId.get(f.personal_id)
    return {
      id: f.id,
      personal_id: f.personal_id,
      nombre: p ? `${p.nombres} ${p.apellidos}` : '—',
      rol_persona: p?.rol ?? '',
      rol: f.rol,
      estado: f.estado,
      funciones: f.funciones,
      supera_capacidad: f.supera_capacidad,
      motivo_supera_capacidad: f.motivo_supera_capacidad,
      motivo_rechazo: f.motivo_rechazo,
      carga: cargaDe.get(f.personal_id) ?? null,
      capacidad: p?.capacidad_maxima ?? null,
      propuesto_at: f.propuesto_at,
    }
  })
}

/** Resumen de un caso para quien tiene la asignación por confirmar: SIN datos del contacto (sección 4). */
export type ResumenAsignacion = {
  equipo_id: string
  solicitud_id: string
  rol: string
  funciones: string | null
  codigo: string
  area: string | null
  servicio: string | null
  urgencia: string
  descripcion: string
  aprobada_at: string | null
}

/**
 * Asignaciones por confirmar DE LA CUENTA que llama (la fila es suya: el rol no importa). Devuelve
 * solo código, área, servicio, urgencia y descripción del caso.
 */
export async function asignacionesPendientes(personal: Personal): Promise<ResumenAsignacion[]> {
  const { data, error } = await supabase
    .from('crm_solicitud_equipo')
    .select('id,solicitud_id,rol,funciones,aprobado_at,crm_solicitudes(codigo,area_principal_id,servicio_id,urgencia,descripcion)')
    .eq('personal_id', personal.id)
    .eq('estado', 'pendiente_confirmacion')
    .order('aprobado_at', { ascending: true })
  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    console.error('[crm/asignacion] pendientes', error.code)
    throw new Error('CRM_ERROR')
  }
  type Sol = { codigo: string; area_principal_id: string | null; servicio_id: string | null; urgencia: string; descripcion: string }
  const filas = (data ?? []) as unknown as {
    id: string; solicitud_id: string; rol: string; funciones: string | null; aprobado_at: string | null
    crm_solicitudes: Sol | Sol[] | null
  }[]
  if (filas.length === 0) return []

  const catalogo = await obtenerCatalogo()
  const salida: ResumenAsignacion[] = []
  for (const f of filas) {
    const s = Array.isArray(f.crm_solicitudes) ? f.crm_solicitudes[0] : f.crm_solicitudes
    if (!s) continue
    salida.push({
      equipo_id: f.id,
      solicitud_id: f.solicitud_id,
      rol: f.rol,
      funciones: f.funciones,
      codigo: s.codigo,
      area: catalogo.areas.find((a) => a.id === s.area_principal_id)?.nombre ?? null,
      servicio: catalogo.servicios.find((x) => x.id === s.servicio_id)?.nombre ?? null,
      urgencia: s.urgencia,
      descripcion: s.descripcion,
      aprobada_at: f.aprobado_at,
    })
  }
  return salida
}

export type FilaEquipoCompleta = {
  id: string
  solicitud_id: string
  personal_id: string
  rol: string
  estado: string
  propuesto_por: string
  /** Cuenta (auth.users.id) de la persona asignada; null si su ficha aún no tiene cuenta. */
  persona_user_id: string | null
  solicitud: { codigo: string; reserva_reforzada: boolean; contacto_id: string; empresa_id: string | null }
}

/** Una fila de equipo con lo necesario para decidir permisos y avisos. `null` si no existe. */
export async function filaEquipo(id: string): Promise<FilaEquipoCompleta | null> {
  const { data, error } = await supabase
    .from('crm_solicitud_equipo')
    .select('id,solicitud_id,personal_id,rol,estado,propuesto_por,crm_personal(user_id),crm_solicitudes(codigo,reserva_reforzada,contacto_id,empresa_id)')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    console.error('[crm/asignacion] fila de equipo', error.code)
    throw new Error('CRM_ERROR')
  }
  if (!data) return null
  const f = data as unknown as {
    id: string; solicitud_id: string; personal_id: string; rol: string; estado: string; propuesto_por: string
    crm_personal: { user_id: string | null } | { user_id: string | null }[] | null
    crm_solicitudes: FilaEquipoCompleta['solicitud'] | FilaEquipoCompleta['solicitud'][] | null
  }
  const persona = Array.isArray(f.crm_personal) ? f.crm_personal[0] : f.crm_personal
  const solicitud = Array.isArray(f.crm_solicitudes) ? f.crm_solicitudes[0] : f.crm_solicitudes
  if (!solicitud) return null
  return {
    id: f.id, solicitud_id: f.solicitud_id, personal_id: f.personal_id, rol: f.rol, estado: f.estado,
    propuesto_por: f.propuesto_por, persona_user_id: persona?.user_id ?? null, solicitud,
  }
}

/**
 * Las funciones de la base cambian el estado del caso sin pasar por `cambiarEstado`, así que la etapa de
 * relación del contacto (10.3) se recalcula aquí. Nunca lanza.
 */
export async function recalcularEtapasDe(solicitudId: string): Promise<void> {
  try {
    const { data } = await supabase.from('crm_solicitudes').select('contacto_id,empresa_id').eq('id', solicitudId).maybeSingle()
    if (!data) return
    await recalcularEtapa(data.contacto_id)
    if (data.empresa_id) await recalcularEtapa(data.empresa_id)
  } catch (e) {
    console.error('[crm/asignacion] etapa', e instanceof Error ? e.name : 'error')
  }
}

/** Cuántas asignaciones por confirmar tiene la persona (para el menú). Nunca lanza. */
export async function contarAsignacionesPendientes(personal: Personal): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('crm_solicitud_equipo')
      .select('id', { count: 'exact', head: true })
      .eq('personal_id', personal.id)
      .eq('estado', 'pendiente_confirmacion')
    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

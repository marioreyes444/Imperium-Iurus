// Capa de permisos del CRM. ÚNICO lugar donde se decide quién puede qué.
// Ninguna ruta ni página decide permisos por su cuenta (sección 2 de la especificación).
import { cache } from 'react'
import { redirect } from 'next/navigation'
import type { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { getUser } from '@/lib/supabase-server'
import { isAdminUser } from '@/lib/admin-auth'
import { ROLES, esRol, type Rol } from '@/lib/crm/roles'
import { esTablaAusente, jsonError } from '@/lib/crm/errores'
import { registrar } from '@/lib/crm/bitacora'

// ─── Ficha del personal ─────────────────────────────────────────────────────

export type Personal = {
  id: string
  user_id: string | null
  rol: Rol
  nombres: string
  apellidos: string
  correo: string | null
  activo: boolean
  es_abogado: boolean
}

const COLUMNAS_PERSONAL = 'id,user_id,rol,nombres,apellidos,correo,activo,es_abogado'

/** Las tablas del CRM no existen (migraciones M4/M5 sin aplicar en este entorno). */
export class CrmNoDisponibleError extends Error {
  constructor() {
    super('CRM_NO_DISPONIBLE')
  }
}

/**
 * Ficha ACTIVA de la cuenta, leída de crm_personal en cada petición (fuente de verdad
 * del rol). Un administrador sin ficha recibe una de Dirección en su primer ingreso.
 */
export async function getPersonal(user: User): Promise<Personal | null> {
  const { data, error } = await supabase
    .from('crm_personal')
    .select(COLUMNAS_PERSONAL)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    console.error('[crm/permisos] getPersonal', error.code)
    throw new Error('CRM_ERROR')
  }
  if (data) {
    const ficha = data as Personal
    return ficha.activo && esRol(ficha.rol) ? ficha : null
  }
  if (!isAdminUser(user)) return null
  return crearFichaDireccion(user)
}

async function crearFichaDireccion(user: User): Promise<Personal | null> {
  const completo = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : ''
  const partes = completo.split(/\s+/).filter(Boolean)
  const nombres = partes.length >= 2 ? partes[0] : 'Administrador'
  const apellidos = partes.length >= 2 ? partes.slice(1).join(' ') : 'Imperium Iuris'

  const { data, error } = await supabase
    .from('crm_personal')
    .insert({
      user_id: user.id,
      rol: 'direccion',
      nombres,
      apellidos,
      correo: user.email?.toLowerCase() ?? null,
      created_by: user.id,
    })
    .select(COLUMNAS_PERSONAL)
    .single()

  if (error) {
    if (error.code === '23505') {
      // Otra petición la creó a la vez: se lee la existente.
      const { data: existente } = await supabase
        .from('crm_personal').select(COLUMNAS_PERSONAL).eq('user_id', user.id).maybeSingle()
      const ficha = existente as Personal | null
      return ficha && ficha.activo ? ficha : null
    }
    console.error('[crm/permisos] crear ficha de Dirección', error.code)
    return null
  }
  await registrar({
    userId: user.id,
    accion: 'crear',
    entidad: 'crm_personal',
    entidadId: (data as Personal).id,
    despues: { rol: 'direccion', origen: 'arranque_admin' },
  })
  return data as Personal
}

// ─── Matriz de acciones (sección 4.3) ───────────────────────────────────────

export const ACCIONES = {
  'tablero.ver':       ROLES,
  'solicitudes.ver':   ROLES,
  'contactos.ver':     ['direccion', 'coordinacion', 'asistencia', 'asociado'],
  'validacion.ver':    ['direccion', 'coordinacion', 'asistencia'],
  'duplicados.ver':    ['direccion', 'coordinacion', 'asistencia'],
  'usuarios.gestionar': ['direccion'],
  'bitacora.ver':      ['direccion'],
  'bitacora.ver_caso': ['direccion', 'coordinacion', 'asociado'],
  // Entrega 3: la lista de personal es de Dirección y Coordinación; cada quien ve su propia ficha.
  'personal.ver':      ['direccion', 'coordinacion'],
  // Confirmar o rechazar la PROPIA asignación: lo decide la fila, no el rol (por eso la ven todos).
  'asignaciones.ver':  ROLES,
  // Entrega 4. Agenda: asociado ve la suya. Tareas y avisos: cada quien los suyos.
  'agenda.ver':        ['direccion', 'coordinacion', 'asistencia', 'asociado'],
  'tareas.ver':        ROLES,
  'avisos.ver':        ROLES,
  // Entrega 5. El asociado NO entra a reportes: ve su carga en su tablero.
  'reportes.ver':      ['direccion', 'coordinacion'],
  'exportar.csv':      ['direccion', 'coordinacion'],
  'turnos.gestionar':  ['direccion', 'coordinacion'],
} as const satisfies Record<string, readonly Rol[]>

export type Accion = keyof typeof ACCIONES

export function puede(rol: Rol, accion: Accion): boolean {
  return (ACCIONES[accion] as readonly Rol[]).includes(rol)
}

export function permisosDe(rol: Rol): Accion[] {
  return (Object.keys(ACCIONES) as Accion[]).filter((a) => puede(rol, a))
}

export function requireRol(personal: Personal, roles: readonly Rol[]): boolean {
  return roles.includes(personal.rol)
}

/** Secciones del menú del CRM; cada rol ve solo las suyas. */
export type SeccionMenu = {
  href: string
  label: string
  icono: 'tablero' | 'solicitudes' | 'contactos' | 'validacion' | 'duplicados' | 'usuarios' | 'bitacora' | 'personal' | 'asignaciones'
    | 'agenda' | 'tareas' | 'avisos' | 'reportes' | 'turnos'
}

const SECCIONES: (SeccionMenu & { accion: Accion })[] = [
  { href: '/admin/crm',             label: 'Tablero',     icono: 'tablero',     accion: 'tablero.ver' },
  { href: '/admin/crm/solicitudes', label: 'Solicitudes', icono: 'solicitudes', accion: 'solicitudes.ver' },
  { href: '/admin/crm/contactos',   label: 'Contactos',   icono: 'contactos',   accion: 'contactos.ver' },
  { href: '/admin/crm/validacion',  label: 'Validación',  icono: 'validacion',  accion: 'validacion.ver' },
  { href: '/admin/crm/duplicados',  label: 'Duplicados',  icono: 'duplicados',  accion: 'duplicados.ver' },
  { href: '/admin/crm/asignaciones', label: 'Mis asignaciones', icono: 'asignaciones', accion: 'asignaciones.ver' },
  { href: '/admin/crm/agenda',      label: 'Agenda',      icono: 'agenda',      accion: 'agenda.ver' },
  { href: '/admin/crm/tareas',      label: 'Tareas',      icono: 'tareas',      accion: 'tareas.ver' },
  { href: '/admin/crm/avisos',      label: 'Avisos',      icono: 'avisos',      accion: 'avisos.ver' },
  { href: '/admin/crm/personal',    label: 'Personal',    icono: 'personal',    accion: 'personal.ver' },
  { href: '/admin/crm/reportes',    label: 'Reportes',    icono: 'reportes',    accion: 'reportes.ver' },
  { href: '/admin/crm/turnos',      label: 'Turnos',      icono: 'turnos',      accion: 'turnos.gestionar' },
  { href: '/admin/crm/usuarios', label: 'Usuarios',  icono: 'usuarios', accion: 'usuarios.gestionar' },
  { href: '/admin/crm/bitacora', label: 'Historial', icono: 'bitacora', accion: 'bitacora.ver' },
]

const HREF_ASIGNACIONES = '/admin/crm/asignaciones'

/**
 * Menú de un rol. «Mis asignaciones» aparece solo si la persona tiene asignaciones por confirmar
 * (cualquier rol: la regla es que la fila sea de su cuenta).
 */
export function menuDe(rol: Rol, opciones: { conAsignaciones?: boolean } = {}): SeccionMenu[] {
  return SECCIONES
    .filter((s) => puede(rol, s.accion) && (s.href !== HREF_ASIGNACIONES || opciones.conAsignaciones))
    .map(({ href, label, icono }) => ({ href, label, icono }))
}

// ─── Autorización de rutas API ──────────────────────────────────────────────

export type Autorizado = { user: User; personal: Personal }

/**
 * Pasos 1–3 de la sección 4.2: sesión (401), ficha activa (403) y rol (403).
 * Uso: `const a = await autorizarApi(['direccion']); if ('status' in a) return a`.
 */
export async function autorizarApi(roles?: readonly Rol[]): Promise<Autorizado | NextResponse> {
  const user = await getUser()
  if (!user) return jsonError(401, 'No autorizado')

  let personal: Personal | null
  try {
    personal = await getPersonal(user)
  } catch (e) {
    if (e instanceof CrmNoDisponibleError) {
      return jsonError(503, 'El módulo CRM aún no está disponible en este entorno.', { codigo: 'CRM_NO_DISPONIBLE' })
    }
    return jsonError(502, 'Ocurrió un error inesperado. Inténtalo de nuevo.')
  }
  if (!personal) return jsonError(403, 'No tienes acceso al CRM')
  if (roles && !requireRol(personal, roles)) return jsonError(403, 'No tienes permiso para esta acción')
  return { user, personal }
}

// ─── Autorización de páginas ────────────────────────────────────────────────

export type SesionCrm =
  | { estado: 'sin_sesion' }
  | { estado: 'no_disponible' }
  | { estado: 'sin_acceso'; user: User }
  | { estado: 'ok'; user: User; personal: Personal }

/** Una sola consulta por render (layout y página comparten el resultado). */
export const getSesionCrm = cache(async (): Promise<SesionCrm> => {
  const user = await getUser()
  if (!user) return { estado: 'sin_sesion' }
  try {
    const personal = await getPersonal(user)
    return personal ? { estado: 'ok', user, personal } : { estado: 'sin_acceso', user }
  } catch (e) {
    if (e instanceof CrmNoDisponibleError) return { estado: 'no_disponible' }
    console.error('[crm/permisos] getSesionCrm', e instanceof Error ? e.message : 'error')
    return { estado: 'no_disponible' }
  }
})

/**
 * Para páginas (distintas del tablero): devuelve la ficha o redirige.
 * Sin sesión → login; sin acceso, módulo no disponible o rol insuficiente → /admin/crm.
 */
export async function personalDePagina(roles?: readonly Rol[]): Promise<Personal> {
  const sesion = await getSesionCrm()
  if (sesion.estado === 'sin_sesion') redirect('/admin/login?redirect=/admin/crm')
  if (sesion.estado !== 'ok') redirect('/admin/crm')
  if (roles && !requireRol(sesion.personal, roles)) redirect('/admin/crm')
  return sesion.personal
}

// ─── Visibilidad de un caso (sección 4.2) ───────────────────────────────────

/**
 * `completo`      Dirección y coordinación.
 * `sin_juridico`  Asistencia: sin actividades jurídicas ni datos del expediente.
 * `resumen`       Asignación pendiente de confirmar: sin datos del contacto.
 * `reducido`      Externo activo: resumen del caso y sus propias tareas.
 * `null`          No puede verlo (las rutas responden 404, nunca 403).
 */
export type NivelVista = 'completo' | 'sin_juridico' | 'resumen' | 'reducido'

export async function puedeVerSolicitud(personal: Personal, solicitudId: string): Promise<NivelVista | null> {
  const { data: sol, error } = await supabase
    .from('crm_solicitudes')
    .select('id,estado,reserva_reforzada')
    .eq('id', solicitudId)
    .maybeSingle()
  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    console.error('[crm/permisos] puedeVerSolicitud', error.code)
    return null
  }
  if (!sol) return null

  const { data: filas, error: errEquipo } = await supabase
    .from('crm_solicitud_equipo')
    .select('rol,estado')
    .eq('solicitud_id', solicitudId)
    .eq('personal_id', personal.id)
  if (errEquipo) {
    console.error('[crm/permisos] equipo', errEquipo.code)
    return null
  }
  const equipo = (filas ?? []) as { rol: string; estado: string }[]
  const activo = equipo.some((f) => f.estado === 'activo')
  const reservado = sol.reserva_reforzada === true
  const cerrado = sol.estado === 'cerrada'

  switch (personal.rol) {
    case 'direccion':
      if (reservado && !activo) {
        await registrar({ userId: personal.user_id, accion: 'ver_reservado', entidad: 'crm_solicitudes', entidadId: solicitudId })
      }
      return 'completo'
    case 'coordinacion':
      return reservado && !activo ? null : 'completo'
    case 'asistencia':
      return reservado && !activo ? null : 'sin_juridico'
    case 'asociado':
    case 'externo': {
      if (cerrado) {
        // Caso cerrado: del equipo solo lo ve el titular.
        const titular = equipo.some((f) => f.rol === 'titular' && (f.estado === 'activo' || f.estado === 'finalizado'))
        if (!titular) return null
        return personal.rol === 'externo' ? 'reducido' : 'completo'
      }
      if (activo) return personal.rol === 'externo' ? 'reducido' : 'completo'
      if (equipo.some((f) => f.estado === 'pendiente_confirmacion')) return 'resumen'
      return null
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTREGA 4 — Agenda y seguimiento. Toda decisión de permiso de la entrega vive aquí.
// ═══════════════════════════════════════════════════════════════════════════

/** Filas de equipo de una persona en un caso (para titular activo / miembro activo). */
async function filasEquipo(personalId: string, solicitudId: string): Promise<{ rol: string; estado: string }[]> {
  const { data, error } = await supabase
    .from('crm_solicitud_equipo')
    .select('rol,estado')
    .eq('solicitud_id', solicitudId)
    .eq('personal_id', personalId)
  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    console.error('[crm/permisos] equipo (E4)', error.code)
    return []
  }
  return (data ?? []) as { rol: string; estado: string }[]
}

export async function esTitularActivo(personalId: string, solicitudId: string): Promise<boolean> {
  return (await filasEquipo(personalId, solicitudId)).some((f) => f.rol === 'titular' && f.estado === 'activo')
}

export async function esMiembroActivo(personalId: string, solicitudId: string): Promise<boolean> {
  return (await filasEquipo(personalId, solicitudId)).some((f) => f.estado === 'activo')
}

// ─── Horario y bloqueos (matriz 4.3) ────────────────────────────────────────

/** Horario semanal: Dirección edita; coordinación, asistencia y el propio abogado lo ven. */
export function puedeVerHorario(personal: Personal, fichaId: string): boolean {
  return personal.rol === 'direccion' || personal.rol === 'coordinacion' || personal.rol === 'asistencia' || personal.id === fichaId
}
export function puedeEditarHorario(personal: Personal): boolean {
  return personal.rol === 'direccion'
}

/** Bloqueos (ausencias): Dirección y coordinación; el asociado, los suyos. Los ve quien ve el horario. */
export function puedeGestionarBloqueos(personal: Personal, fichaId: string): boolean {
  return personal.rol === 'direccion' || personal.rol === 'coordinacion' || (personal.rol === 'asociado' && personal.id === fichaId)
}

// ─── Citas ──────────────────────────────────────────────────────────────────

/** Agenda: Dirección, coordinación y asistencia ven a todos los abogados; el asociado, solo la suya. */
export function abogadosVisiblesEnAgenda(personal: Personal): 'todos' | 'propio' | 'ninguno' {
  if (personal.rol === 'direccion' || personal.rol === 'coordinacion' || personal.rol === 'asistencia') return 'todos'
  if (personal.rol === 'asociado') return 'propio'
  return 'ninguno'
}

/**
 * Agendar, reagendar y cancelar citas de un caso: D, C, A; el asociado en sus casos (nivel completo).
 * `nivel` es el resultado de `puedeVerSolicitud` sobre el caso de la cita.
 */
export function puedeGestionarCitasDe(personal: Personal, nivel: NivelVista | null): boolean {
  if (!nivel) return false
  if (personal.rol === 'direccion' || personal.rol === 'coordinacion') return nivel === 'completo'
  if (personal.rol === 'asistencia') return nivel === 'sin_juridico'
  if (personal.rol === 'asociado') return nivel === 'completo'
  return false
}

/** Cita sin caso vinculado (p. ej. reserva web cuyo ingreso al CRM falló): solo D, C y A. */
export function puedeGestionarCitaSinCaso(personal: Personal): boolean {
  return personal.rol === 'direccion' || personal.rol === 'coordinacion' || personal.rol === 'asistencia'
}

/**
 * Quién puede VER una cita: quien ve su caso con acceso completo o sin jurídico, quien la atiende
 * como abogado y, si no tiene caso, D, C y A.
 */
export async function puedeVerCita(personal: Personal, cita: { solicitud_id: string | null; abogado_id: string | null }): Promise<boolean> {
  if (cita.abogado_id && cita.abogado_id === personal.id) return true
  if (!cita.solicitud_id) return puedeGestionarCitaSinCaso(personal)
  const nivel = await puedeVerSolicitud(personal, cita.solicitud_id)
  return nivel === 'completo' || nivel === 'sin_juridico'
}

/** Permiso para gestionar una cita concreta (con o sin caso). */
export async function puedeGestionarCita(personal: Personal, cita: { solicitud_id: string | null }): Promise<boolean> {
  if (!cita.solicitud_id) return puedeGestionarCitaSinCaso(personal)
  return puedeGestionarCitasDe(personal, await puedeVerSolicitud(personal, cita.solicitud_id))
}

// ─── Actividades, tareas y plazos ───────────────────────────────────────────

/** Asistencia nunca crea ni recibe actividades jurídicas (es_juridica). */
export const recibeJuridicas = (rol: Rol) => rol !== 'asistencia'

/** Cronología según el nivel: completa, sin jurídicas (asistencia) o solo lo propio (externo). */
export function cronologiaDe(nivel: NivelVista | null): 'completa' | 'sin_juridico' | 'propia' | null {
  if (nivel === 'completo') return 'completa'
  if (nivel === 'sin_juridico') return 'sin_juridico'
  if (nivel === 'reducido') return 'propia'
  return null
}

/**
 * Crear una actividad en un caso (matriz 4.3):
 *   · Tareas y seguimientos: D, C, A (no jurídicas), asociado en sus casos.
 *   · Notas jurídicas: D, C, asociado y externo en sus casos. Asistencia nunca.
 *   · Un plazo jurídico cuenta como jurídico: asistencia no lo crea.
 */
export function puedeCrearActividad(
  personal: Personal,
  nivel: NivelVista | null,
  a: { tipo: string; es_juridica: boolean; es_plazo_juridico: boolean },
): boolean {
  if (!nivel || nivel === 'resumen') return false
  const juridica = a.es_juridica || a.es_plazo_juridico
  switch (personal.rol) {
    case 'direccion':
    case 'coordinacion':
    case 'asociado':
      return nivel === 'completo'
    case 'asistencia':
      return nivel === 'sin_juridico' && !juridica
    case 'externo':
      // Vista reducida: solo notas en sus casos; no crea tareas.
      return nivel === 'reducido' && a.tipo === 'nota'
  }
}

/**
 * Quién puede ser responsable de una tarea de un caso: personal activo que vea el caso (D; C y A si
 * no es reservado; o miembro activo del equipo). Una tarea jurídica nunca va a asistencia.
 */
export function puedeSerResponsable(
  ficha: { rol: Rol; activo: boolean },
  opciones: { miembroActivo: boolean; juridica: boolean; casoReservado: boolean },
): boolean {
  if (!ficha.activo) return false
  if (opciones.juridica && !recibeJuridicas(ficha.rol)) return false
  if (ficha.rol === 'direccion' || opciones.miembroActivo) return true
  if (opciones.casoReservado) return false
  return ficha.rol === 'coordinacion' || ficha.rol === 'asistencia'
}

export type AccionTarea = 'completar' | 'cancelar' | 'verificar_plazo' | 'reprogramar'

/**
 * Acciones sobre una tarea:
 *   · Completar: el responsable, o D/C.
 *   · Cancelar y reprogramar: D/C.
 *   · Verificar un plazo jurídico (R-41): titular activo o Dirección.
 */
export function puedeActuarSobreTarea(
  personal: Personal,
  accion: AccionTarea,
  t: { esResponsable: boolean; esTitularActivo: boolean; esPlazoJuridico: boolean },
): boolean {
  const dc = personal.rol === 'direccion' || personal.rol === 'coordinacion'
  switch (accion) {
    case 'completar':
      return dc || t.esResponsable
    case 'cancelar':
    case 'reprogramar':
      return dc
    case 'verificar_plazo':
      return t.esPlazoJuridico && (personal.rol === 'direccion' || t.esTitularActivo)
  }
}

// ─── Expediente ─────────────────────────────────────────────────────────────

/** Asistencia y externo no reciben datos del expediente (4.2). */
export const puedeVerExpediente = (nivel: NivelVista | null) => nivel === 'completo'

/** Editar el expediente: D, C y el titular activo. */
export function puedeEditarExpediente(personal: Personal, esTitular: boolean): boolean {
  return personal.rol === 'direccion' || personal.rol === 'coordinacion' || esTitular
}

// ─── Avisos (R-53) ──────────────────────────────────────────────────────────

/**
 * De una lista de fichas, cuáles pueden recibir un aviso sobre un caso. Si el caso tiene reserva
 * reforzada, solo Dirección y quien esté ACTIVO en su equipo. Sin caso, todas. Nunca lanza.
 */
export async function autorizadosParaAviso(solicitudId: string | null, personalIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(personalIds)]
  if (!solicitudId || ids.length === 0) return new Set(ids)
  try {
    const { data: sol } = await supabase.from('crm_solicitudes').select('reserva_reforzada').eq('id', solicitudId).maybeSingle()
    if (!sol || sol.reserva_reforzada !== true) return new Set(ids)
    const [{ data: fichas }, { data: equipo }] = await Promise.all([
      supabase.from('crm_personal').select('id,rol').in('id', ids),
      supabase.from('crm_solicitud_equipo').select('personal_id').eq('solicitud_id', solicitudId).eq('estado', 'activo').in('personal_id', ids),
    ])
    const activos = new Set(((equipo ?? []) as { personal_id: string }[]).map((e) => e.personal_id))
    return new Set(((fichas ?? []) as { id: string; rol: string }[]).filter((f) => f.rol === 'direccion' || activos.has(f.id)).map((f) => f.id))
  } catch (e) {
    console.error('[crm/permisos] autorizados para aviso', e instanceof Error ? e.name : 'error')
    return new Set()
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTREGA 5 — Control. Toda decisión de permiso de la entrega vive aquí.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tablero:
 *   · `completo`: Dirección y Coordinación (casos por estado, vencimientos, objetivos y carga de todos).
 *   · `propio`: asociado, lo mismo pero solo lo suyo (incluida su propia carga).
 *   · `basico`: asistencia y externo conservan el tablero de la Entrega 1.
 */
export type NivelTablero = 'completo' | 'propio' | 'basico'

export function nivelTablero(rol: Rol): NivelTablero {
  if (rol === 'direccion' || rol === 'coordinacion') return 'completo'
  if (rol === 'asociado') return 'propio'
  return 'basico'
}

/**
 * Reportes, exportación y turnos: Dirección y Coordinación. Qué casos entran lo decide `alcancesDe`
 * (Coordinación no ve reservados salvo los de su equipo activo), no estos permisos.
 */
export const puedeVerReportes = (rol: Rol) => puede(rol, 'reportes.ver')
export const puedeExportar = (rol: Rol) => puede(rol, 'exportar.csv')
export const puedeGestionarTurnos = (rol: Rol) => puede(rol, 'turnos.gestionar')

// ═══════════════════════════════════════════════════════════════════════════
// CIERRE DEL MÓDULO — Las preguntas «¿qué rol es?» que antes vivían en rutas, páginas y librerías.
// Cada función devuelve exactamente lo mismo que la comparación que reemplazó. Las que no están en
// `ACCIONES` lo están a propósito: añadirlas a la matriz cambiaría la lista de permisos que expone la
// ruta /api/admin/crm/yo.
// ═══════════════════════════════════════════════════════════════════════════

export const esDireccion = (rol: Rol) => rol === 'direccion'
export const esDireccionOCoordinacion = (rol: Rol) => rol === 'direccion' || rol === 'coordinacion'

/**
 * Cuánto ve una persona de los casos y contactos (4.2), antes de aplicar la visibilidad en la consulta:
 *   · `todo`: Dirección. · `sin_reservados`: coordinación y asistencia (más los reservados de su equipo
 *   activo). · `equipo`: asociado y externo, solo donde están en el equipo.
 */
export type CategoriaAlcance = 'todo' | 'sin_reservados' | 'equipo'
export function categoriaAlcance(rol: Rol): CategoriaAlcance {
  if (rol === 'direccion') return 'todo'
  if (rol === 'coordinacion' || rol === 'asistencia') return 'sin_reservados'
  return 'equipo'
}

/** Enlace «Panel Admin» del armazón del CRM: solo Dirección (equivale al admin). */
export const veEnlacePanelAdmin = (rol: Rol) => rol === 'direccion'

// ─── Fichas del personal (antes en lib/crm/personal.ts) ─────────────────────

/** Quién puede ver una ficha: Dirección y Coordinación, todas; el resto, solo la suya. */
export const puedeVerFicha = (personal: Personal, fichaId: string) =>
  personal.rol === 'direccion' || personal.rol === 'coordinacion' || personal.id === fichaId

/** Quién puede editarla: Dirección y Coordinación. */
export const puedeEditarFicha = (personal: Personal) => personal.rol === 'direccion' || personal.rol === 'coordinacion'

// ─── Solicitudes y contactos ────────────────────────────────────────────────

/** Vista reducida del externo: sin canal, marcas internas ni datos del contacto. */
export const tieneVistaReducida = (rol: Rol) => rol === 'externo'

/** Crear solicitudes (y crear una desde la ficha de un contacto): D, C, A. */
export const puedeCrearSolicitudes = (rol: Rol) => rol === 'direccion' || rol === 'coordinacion' || rol === 'asistencia'

/** Botones «Editar» y «Cambiar estado» del listado: todos menos el externo (el detalle decide el resto). */
export const puedeEditarEnListadoSolicitudes = (rol: Rol) => rol !== 'externo'

/** Validar o descartar un envío de la bandeja de validación: D, C, A. */
export const puedeValidarEnvios = (rol: Rol) => rol === 'direccion' || rol === 'coordinacion' || rol === 'asistencia'

/** Editar los datos de calificación de un caso: D, C, A; el asociado, con nivel completo. */
export const puedeEditarSolicitud = (rol: Rol, nivel: NivelVista | null) =>
  rol === 'direccion' || rol === 'coordinacion' || rol === 'asistencia' || (rol === 'asociado' && nivel === 'completo')

/** Marcar reserva reforzada en un contacto o al crear una solicitud: D y C. Quitarla: solo Dirección. */
export const puedeMarcarReserva = (rol: Rol) => rol === 'direccion' || rol === 'coordinacion'
export const puedeQuitarReserva = (rol: Rol) => rol === 'direccion'

/**
 * Marcar reserva reforzada en un caso existente: D, C y el asociado en sus casos. Sin `nivel` (la ruta ya
 * comprobó el acceso al caso) basta el rol; con `nivel`, el asociado necesita acceso completo.
 */
export const puedeMarcarReservaEnCaso = (rol: Rol, nivel?: NivelVista | null) =>
  rol === 'direccion' || rol === 'coordinacion' || (rol === 'asociado' && (nivel === undefined || nivel === 'completo'))

/** Crear contactos: D, C, A (el asociado edita los de sus casos, no crea). */
export const puedeCrearContactos = (rol: Rol) => rol === 'direccion' || rol === 'coordinacion' || rol === 'asistencia'
/** Cambiar a mano la etapa de relación de un contacto: todos los que lo editan menos el asociado. */
export const puedeCambiarEtapaContacto = (rol: Rol) => rol === 'direccion' || rol === 'coordinacion' || rol === 'asistencia'
/** Vincular personas con una empresa: D, C, A. */
export const puedeVincularContactos = (rol: Rol) => rol === 'direccion' || rol === 'coordinacion' || rol === 'asistencia'
/** Marcar un posible duplicado a mano: D, C, A. */
export const puedeMarcarDuplicado = (rol: Rol) => rol === 'direccion' || rol === 'coordinacion' || rol === 'asistencia'
/** Fusionar o descartar un par de duplicados: D y C. */
export const puedeResolverDuplicados = (rol: Rol) => rol === 'direccion' || rol === 'coordinacion'

// ─── Equipo y asignación ────────────────────────────────────────────────────

/** Revisión de conflictos, proponer equipo y retirar a un miembro: D y C. */
export const puedeGestionarEquipo = (rol: Rol) => rol === 'direccion' || rol === 'coordinacion'
export const puedeAprobarAsignacion = (rol: Rol) => rol === 'direccion'
export const puedeReasignarTitular = (rol: Rol) => rol === 'direccion'

// ─── Estados (sección 8.1) ──────────────────────────────────────────────────

/**
 * ¿Puede el rol hacer este cambio de estado? La TABLA de transiciones (R-12) vive en lib/crm/estados.ts
 * como dato; ESTA función es la decisión de permiso. Recibe valores simples para no importar estados.ts
 * (evita una importación circular): `desde` y `hacia` son estados de la solicitud.
 */
export function puedeCambiarEstado(
  rol: Rol,
  c: { desde: string; hacia: string; requiereValidacion: boolean; esTitularActivo: boolean },
): boolean {
  const reapertura = c.desde === 'cerrada' || c.desde === 'descartada'
  if (reapertura) return rol === 'direccion'
  if (c.hacia === 'descartada') {
    if (rol === 'direccion') return true
    // Coordinación y asistencia solo descartan un envío por validar.
    return (rol === 'coordinacion' || rol === 'asistencia') && c.desde === 'nueva' && c.requiereValidacion
  }
  if (c.hacia === 'aceptada_pendiente_asignacion') return rol === 'direccion'
  if (c.hacia === 'en_espera' || c.hacia === 'cerrada' || (c.desde === 'en_espera' && c.hacia === 'en_curso')) {
    return rol === 'direccion' || rol === 'coordinacion' || c.esTitularActivo
  }
  // Hacia calificación, información pendiente, consulta agendada, propuesta enviada o pendiente de aceptación.
  return rol === 'direccion' || rol === 'coordinacion' || rol === 'asistencia'
}

// ─── Actividades, tareas y citas ────────────────────────────────────────────

/** El externo solo ve las tareas que se le asignaron; los demás, también las de sus casos. */
export const veTareasDeSusCasos = (rol: Rol) => rol !== 'externo'

/** El externo solo registra notas en la cronología de sus casos. */
export const soloRegistraNotas = (rol: Rol) => rol === 'externo'

/** Una actividad sin caso (poco frecuente) solo la ven Dirección y Coordinación. */
export const veActividadesSinCaso = (rol: Rol) => rol === 'direccion' || rol === 'coordinacion'

/** Si cancela una cita, la tarea de reagendar es de quien cancela cuando es asistencia o coordinación. */
export const asumeTareaDeCancelacion = (rol: Rol) => rol === 'asistencia' || rol === 'coordinacion'
/** Si no, el responsable es la primera persona activa de estos roles, en este orden. */
export const ORDEN_RESPONSABLE_CANCELACION: readonly Rol[] = ['asistencia', 'coordinacion', 'direccion']

/** Filtro «titular» del listado de solicitudes (sección 8, Entrega 2): Dirección y Coordinación. */
export const puedeFiltrarPorTitular = (rol: Rol) => rol === 'direccion' || rol === 'coordinacion'

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
}

const SECCIONES: (SeccionMenu & { accion: Accion })[] = [
  { href: '/admin/crm',             label: 'Tablero',     icono: 'tablero',     accion: 'tablero.ver' },
  { href: '/admin/crm/solicitudes', label: 'Solicitudes', icono: 'solicitudes', accion: 'solicitudes.ver' },
  { href: '/admin/crm/contactos',   label: 'Contactos',   icono: 'contactos',   accion: 'contactos.ver' },
  { href: '/admin/crm/validacion',  label: 'Validación',  icono: 'validacion',  accion: 'validacion.ver' },
  { href: '/admin/crm/duplicados',  label: 'Duplicados',  icono: 'duplicados',  accion: 'duplicados.ver' },
  { href: '/admin/crm/asignaciones', label: 'Mis asignaciones', icono: 'asignaciones', accion: 'asignaciones.ver' },
  { href: '/admin/crm/personal',    label: 'Personal',    icono: 'personal',    accion: 'personal.ver' },
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

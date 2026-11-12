// Roles del CRM y su espejo en app_metadata.role.
// Archivo PURO (sin Supabase ni Next): seguro para el middleware (Edge),
// Server Components y Route Handlers. La fuente de verdad del rol es la tabla
// crm_personal; esto solo sirve para decidir rutas y menús de forma barata.
import type { User } from '@supabase/supabase-js'
import { isAdminUser } from '@/lib/admin-auth'

export const ROLES = ['direccion', 'coordinacion', 'asistencia', 'asociado', 'externo'] as const
export type Rol = (typeof ROLES)[number]

export const ROL_LABEL: Record<Rol, string> = {
  direccion:    'Dirección',
  coordinacion: 'Coordinación',
  asistencia:   'Asistencia',
  asociado:     'Asociado',
  externo:      'Externo',
}

export function esRol(valor: unknown): valor is Rol {
  return typeof valor === 'string' && (ROLES as readonly string[]).includes(valor)
}

/** Valor de app_metadata.role que corresponde a un rol del CRM (Dirección = 'admin'). */
export function rolAMetadata(rol: Rol): string {
  return rol === 'direccion' ? 'admin' : rol
}

/**
 * Rol del CRM que indica la sesión (sin consultar la base): lo usan el middleware
 * y el menú. `null` = no es personal del CRM. Dirección equivale al admin actual,
 * incluido el respaldo por ADMIN_EMAIL.
 */
export function rolCrmDesdeUsuario(user: User | null | undefined): Rol | null {
  if (!user) return null
  const role = user.app_metadata?.role
  if (role === 'admin') return 'direccion'
  if (esRol(role) && role !== 'direccion') return role
  return isAdminUser(user) ? 'direccion' : null
}

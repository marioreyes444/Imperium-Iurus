import { supabase } from '@/lib/supabase'
import type { Personal } from '@/lib/crm/permisos'
import { alcancesDe, aplicarAlcance, contactosBloqueados } from '@/lib/crm/visibilidad'

/**
 * Contadores de pendientes del menú (Validación y Duplicados). Respetan la visibilidad EN la consulta
 * (R-53): una persona no cuenta lo que no puede ver. Nunca lanza: sin datos, el menú no muestra contador.
 */
export async function contadoresMenu(personal: Personal): Promise<Record<string, number>> {
  if (personal.rol !== 'direccion' && personal.rol !== 'coordinacion' && personal.rol !== 'asistencia') return {}
  try {
    const al = await alcancesDe(personal)

    const porValidar = aplicarAlcance(
      supabase.from('crm_solicitudes').select('id', { count: 'exact', head: true }).eq('estado', 'nueva').eq('requiere_validacion', true),
      al.solicitudes,
    )

    let duplicados = supabase.from('crm_posibles_duplicados').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente')
    const bloqueados = await contactosBloqueados(al.contactos)
    if (bloqueados.length > 0) {
      const lista = `(${bloqueados.join(',')})`
      duplicados = duplicados.not('contacto_a', 'in', lista).not('contacto_b', 'in', lista)
    }

    const [v, d] = await Promise.all([porValidar, duplicados])
    return {
      '/admin/crm/validacion': v.error ? 0 : (v.count ?? 0),
      '/admin/crm/duplicados': d.error ? 0 : (d.count ?? 0),
    }
  } catch {
    return {}
  }
}

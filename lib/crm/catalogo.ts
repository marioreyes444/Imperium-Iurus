import { supabase } from '@/lib/supabase'
import { esTablaAusente } from '@/lib/crm/errores'

export type AreaCatalogo = { id: string; slug: string; numero: number | null; nombre: string; orden: number | null }
export type ServicioCatalogo = {
  id: string
  area_id: string
  slug: string
  numero: number | null
  nombre: string
  orden: number | null
}
export type Catalogo = { areas: AreaCatalogo[]; servicios: ServicioCatalogo[]; disponible: boolean }

/**
 * Catálogo del módulo E5, solo lectura, solo activos y ordenado por `orden`.
 *   public.areas_practica: id, slug, numero, nombre, orden, activo
 *   public.servicios:      id, area_id, slug, numero, nombre, objeto_actuacion,
 *                          servicio_ofrecido, descripcion_publica, orden, activo
 * Si las tablas no existen en el entorno (o fallan), devuelve listas vacías SIN error
 * (`disponible: false`): los selectores quedan preparados y se llenan solos.
 */
export async function obtenerCatalogo(): Promise<Catalogo> {
  const [areasRes, serviciosRes] = await Promise.all([
    supabase
      .from('areas_practica')
      .select('id,slug,numero,nombre,orden')
      .eq('activo', true)
      .order('orden', { ascending: true }),
    supabase
      .from('servicios')
      .select('id,area_id,slug,numero,nombre,orden')
      .eq('activo', true)
      .order('orden', { ascending: true }),
  ])

  const error = areasRes.error ?? serviciosRes.error
  if (error) {
    if (!esTablaAusente(error)) console.error('[crm/catalogo]', error.code)
    return { areas: [], servicios: [], disponible: false }
  }

  return {
    areas: (areasRes.data ?? []) as AreaCatalogo[],
    servicios: (serviciosRes.data ?? []) as ServicioCatalogo[],
    disponible: true,
  }
}

import { supabase } from '@/lib/supabase'

export type TipoCoincidencia = 'telefono' | 'correo' | 'nombre'

/**
 * R-04: un teléfono o correo repetido NO bloquea; deja un par para revisar. La base exige
 * `contacto_a < contacto_b` (comparación de uuid = orden de la cadena hexadecimal en minúsculas)
 * y un solo par por combinación. Si el par ya existe (incluso descartado) no se reabre.
 * Nunca lanza.
 */
export async function registrarPosibleDuplicado(x: string, y: string, coincidencia: TipoCoincidencia): Promise<void> {
  if (x === y) return
  const a = x.toLowerCase() < y.toLowerCase() ? x : y
  const b = a === x ? y : x
  const { error } = await supabase
    .from('crm_posibles_duplicados')
    .insert({ contacto_a: a, contacto_b: b, coincidencia })
  if (error && error.code !== '23505') {
    console.error('[crm/duplicados] no se pudo registrar el par', error.code)
  }
}

/** Registra un par por cada coincidencia de teléfono o correo (la identificación no puede repetirse: la bloquea la base). */
export async function registrarCoincidencias(
  nuevoId: string,
  coincidencias: { id: string; coincidencia: 'identificacion' | 'telefono' | 'correo' }[],
): Promise<void> {
  for (const c of coincidencias) {
    if (c.coincidencia === 'identificacion') continue
    await registrarPosibleDuplicado(nuevoId, c.id, c.coincidencia)
  }
}

export type ParDuplicado = {
  id: string
  contacto_a: string
  contacto_b: string
  coincidencia: TipoCoincidencia
  estado: 'pendiente' | 'fusionado' | 'descartado'
  resuelto_por: string | null
  resuelto_at: string | null
  created_at: string
}

export const COLUMNAS_PAR = 'id,contacto_a,contacto_b,coincidencia,estado,resuelto_por,resuelto_at,created_at'

export async function obtenerPar(id: string): Promise<{ par: ParDuplicado | null; error: { code?: string; message?: string } | null }> {
  const { data, error } = await supabase.from('crm_posibles_duplicados').select(COLUMNAS_PAR).eq('id', id).maybeSingle()
  return { par: (data as ParDuplicado | null) ?? null, error }
}

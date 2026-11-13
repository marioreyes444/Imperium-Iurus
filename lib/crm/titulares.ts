// «Último titular» de una solicitud: la fila de titular más reciente (por `propuesto_at`) entre los estados
// pendiente_confirmacion, activo y finalizado. Cada caso cuenta para UNA sola persona. La usan los reportes,
// la exportación (columna «titular») y el filtro «titular» del listado de solicitudes.
import { supabase } from '@/lib/supabase'
import { esTablaAusente } from '@/lib/crm/errores'
import { CrmNoDisponibleError } from '@/lib/crm/permisos'

const ESTADOS_TITULAR = ['pendiente_confirmacion', 'activo', 'finalizado']
const LOTE_IDS = 80
/** Máximo de ids que se pasan en la URL de la consulta del listado (límite práctico de PostgREST). */
export const TOPE_IDS_FILTRO_TITULAR = 300

function lanzar(contexto: string, error: { code?: string }): never {
  if (esTablaAusente(error)) throw new CrmNoDisponibleError()
  console.error('[crm/titulares]', contexto, error.code)
  throw new Error('CRM_ERROR')
}

/** Último titular (personal_id) de cada solicitud, por lotes de ids para no pasar el límite de la URL. */
export async function titularesDe(solicitudIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(solicitudIds)]
  const ultimo = new Map<string, { personal: string; at: string }>()
  const lotes: string[][] = []
  for (let i = 0; i < ids.length; i += LOTE_IDS) lotes.push(ids.slice(i, i + LOTE_IDS))

  for (let i = 0; i < lotes.length; i += 4) {
    const resultados = await Promise.all(lotes.slice(i, i + 4).map((lote) =>
      supabase
        .from('crm_solicitud_equipo')
        .select('solicitud_id,personal_id,propuesto_at')
        .eq('rol', 'titular')
        .in('estado', ESTADOS_TITULAR)
        .in('solicitud_id', lote)
        .limit(1000)))
    for (const r of resultados) {
      if (r.error) lanzar('titulares', r.error)
      for (const f of (r.data ?? []) as { solicitud_id: string; personal_id: string; propuesto_at: string }[]) {
        const previo = ultimo.get(f.solicitud_id)
        if (!previo || f.propuesto_at > previo.at) ultimo.set(f.solicitud_id, { personal: f.personal_id, at: f.propuesto_at })
      }
    }
  }
  return new Map([...ultimo.entries()].map(([k, v]) => [k, v.personal]))
}

export async function nombresPersonal(ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return new Map()
  const { data, error } = await supabase.from('crm_personal').select('id,nombres,apellidos').in('id', unicos)
  if (error) lanzar('nombres del personal', error)
  return new Map(((data ?? []) as { id: string; nombres: string; apellidos: string }[]).map((p) => [p.id, `${p.nombres} ${p.apellidos}`]))
}

/**
 * Ids de las solicitudes cuyo ÚLTIMO titular es esta persona. Quien llama los aplica EN la consulta del
 * listado, junto con la visibilidad: un caso reservado que la persona no ve no aparece aunque esté aquí.
 */
export async function idsDeUltimoTitular(personalId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('crm_solicitud_equipo')
    .select('solicitud_id')
    .eq('personal_id', personalId)
    .eq('rol', 'titular')
    .in('estado', ESTADOS_TITULAR)
    .limit(1000)
  if (error) lanzar('casos del titular', error)
  const candidatos = [...new Set(((data ?? []) as { solicitud_id: string }[]).map((f) => f.solicitud_id))]
  const titulares = await titularesDe(candidatos)
  return candidatos.filter((id) => titulares.get(id) === personalId)
}

/** Abogados para el filtro «titular» (también los inactivos: pueden ser el último titular de un caso). */
export async function abogadosParaFiltro(): Promise<{ id: string; nombre: string }[]> {
  const { data, error } = await supabase
    .from('crm_personal')
    .select('id,nombres,apellidos,activo')
    .eq('es_abogado', true)
    .order('nombres', { ascending: true })
    .limit(500)
  if (error) lanzar('abogados', error)
  return ((data ?? []) as { id: string; nombres: string; apellidos: string; activo: boolean }[])
    .map((p) => ({ id: p.id, nombre: `${p.nombres} ${p.apellidos}${p.activo ? '' : ' (inactivo)'}` }))
}

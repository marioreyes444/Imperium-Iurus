// Fichas del personal (Entrega 3): columnas, lectura con carga y áreas de referencia.
import { supabase } from '@/lib/supabase'
import { esTablaAusente } from '@/lib/crm/errores'
import { CrmNoDisponibleError } from '@/lib/crm/permisos'

export const COLUMNAS_FICHA =
  'id,user_id,rol,nombres,apellidos,identificacion,correo,telefono,ciudad,es_abogado,matricula,' +
  'habilitacion_verificada,habilitacion_verificada_at,especialidad,capacidad_maxima,fecha_vinculacion,' +
  'acuerdo_confidencialidad,acuerdo_confidencialidad_at,activo,created_at,updated_at'

export type FichaFila = {
  id: string
  user_id: string | null
  rol: string
  nombres: string
  apellidos: string
  identificacion: string | null
  correo: string | null
  telefono: string | null
  ciudad: string | null
  es_abogado: boolean
  matricula: string | null
  habilitacion_verificada: boolean
  habilitacion_verificada_at: string | null
  especialidad: string | null
  capacidad_maxima: number | null
  fecha_vinculacion: string | null
  acuerdo_confidencialidad: boolean
  acuerdo_confidencialidad_at: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export type CargaPersonal = {
  carga_titular: number
  casos_apoyo: number
  tareas_vencidas: number
  tareas_7_dias: number
}

export type AreaReferencia = { area_id: string; rol_referencia: string; competencia_acreditada: boolean }

/** Nunca se expone user_id: solo si la ficha tiene cuenta. */
export function fichaParaPantalla(f: FichaFila) {
  const { user_id, ...resto } = f
  return { ...resto, sin_cuenta: user_id === null }
}

export async function obtenerFicha(id: string): Promise<FichaFila | null> {
  const { data, error } = await supabase.from('crm_personal').select(COLUMNAS_FICHA).eq('id', id).maybeSingle()
  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    console.error('[crm/personal] ficha', error.code)
    throw new Error('CRM_ERROR')
  }
  return (data as unknown as FichaFila | null) ?? null
}

export async function cargaDe(personalId: string): Promise<CargaPersonal | null> {
  const { data, error } = await supabase
    .from('crm_v_carga_personal')
    .select('carga_titular,casos_apoyo,tareas_vencidas,tareas_7_dias')
    .eq('personal_id', personalId)
    .maybeSingle()
  if (error) {
    if (!esTablaAusente(error)) console.error('[crm/personal] carga', error.code)
    return null
  }
  return (data as CargaPersonal | null) ?? null
}

export async function areasDe(personalId: string): Promise<AreaReferencia[]> {
  const { data, error } = await supabase
    .from('crm_personal_areas')
    .select('area_id,rol_referencia,competencia_acreditada')
    .eq('personal_id', personalId)
  if (error) {
    if (!esTablaAusente(error)) console.error('[crm/personal] áreas', error.code)
    return []
  }
  return (data ?? []) as AreaReferencia[]
}

import { supabase } from '@/lib/supabase'
import { esTablaAusente } from '@/lib/crm/errores'
import { hoyGuayaquil } from '@/lib/crm/fechas'

/** Columnas de crm_personal que ve la pantalla de usuarios (solo Dirección). */
export const COLUMNAS_USUARIO =
  'id,user_id,rol,nombres,apellidos,correo,telefono,ciudad,es_abogado,matricula,activo,created_at,updated_at'

export type UsuarioFila = {
  id: string
  user_id: string | null
  rol: string
  nombres: string
  apellidos: string
  correo: string | null
  telefono: string | null
  ciudad: string | null
  es_abogado: boolean
  matricula: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

/** Lo que ve la pantalla: nunca se expone user_id, solo si la ficha tiene cuenta. */
export function paraPantalla(fila: UsuarioFila) {
  const { user_id, ...resto } = fila
  return { ...resto, sin_cuenta: user_id === null }
}

export async function obtenerUsuario(id: string): Promise<UsuarioFila | null> {
  const { data, error } = await supabase.from('crm_personal').select(COLUMNAS_USUARIO).eq('id', id).maybeSingle()
  if (error) {
    console.error('[crm/usuarios] obtener', error.code)
    return null
  }
  return (data as UsuarioFila | null) ?? null
}

export type Afectados = {
  casos: { solicitud_id: string; codigo: string | null; estado: string | null }[]
  citas: { id: string; fecha: string; hora: string }[]
  /** true si no se pudo consultar (p. ej. M5 sin aplicar). */
  incompleto: boolean
}

/**
 * R-45: casos y citas activas de una persona. No se reasignan ni se cancelan solos:
 * se devuelve la lista para que Dirección los gestione.
 */
export async function afectadosPor(personalId: string): Promise<Afectados> {
  const salida: Afectados = { casos: [], citas: [], incompleto: false }

  const { data: equipo, error: errEquipo } = await supabase
    .from('crm_solicitud_equipo')
    .select('solicitud_id, crm_solicitudes(codigo,estado)')
    .eq('personal_id', personalId)
    .in('estado', ['activo', 'pendiente_confirmacion', 'en_reserva'])
  if (errEquipo) {
    if (!esTablaAusente(errEquipo)) console.error('[crm/usuarios] afectados equipo', errEquipo.code)
    salida.incompleto = true
  } else {
    for (const fila of (equipo ?? []) as unknown as {
      solicitud_id: string
      crm_solicitudes: { codigo: string | null; estado: string | null } | { codigo: string | null; estado: string | null }[] | null
    }[]) {
      const sol = Array.isArray(fila.crm_solicitudes) ? fila.crm_solicitudes[0] : fila.crm_solicitudes
      if (sol && ['cerrada', 'descartada'].includes(sol.estado ?? '')) continue
      salida.casos.push({ solicitud_id: fila.solicitud_id, codigo: sol?.codigo ?? null, estado: sol?.estado ?? null })
    }
  }

  const { data: citas, error: errCitas } = await supabase
    .from('citas')
    .select('id,fecha,hora')
    .eq('abogado_id', personalId)
    .in('estado', ['pendiente', 'confirmada'])
    .gte('fecha', hoyGuayaquil())
  if (errCitas) {
    // 42703 = columna abogado_id inexistente (M5 sin aplicar).
    if (errCitas.code !== '42703' && !esTablaAusente(errCitas)) console.error('[crm/usuarios] afectados citas', errCitas.code)
    salida.incompleto = true
  } else {
    salida.citas = (citas ?? []) as Afectados['citas']
  }
  return salida
}

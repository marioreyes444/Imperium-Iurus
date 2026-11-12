import { supabase } from '@/lib/supabase'

/** Acciones que admite el CHECK de crm_bitacora (migración M4). No inventes otras. */
export const ACCIONES_BITACORA = [
  'crear', 'actualizar', 'cambiar_estado', 'revisar_conflicto',
  'proponer_asignacion', 'aprobar_asignacion', 'confirmar_asignacion',
  'rechazar_asignacion', 'reasignar', 'autorizar_capacidad',
  'fusionar', 'descartar_duplicado', 'cerrar', 'reabrir',
  'agendar_cita', 'reagendar_cita', 'cancelar_cita', 'verificar_plazo',
  'exportar', 'ver_reservado', 'acceso_excepcional',
  'crear_usuario', 'cambiar_rol', 'desactivar_usuario', 'reactivar_usuario',
] as const
export type AccionBitacora = (typeof ACCIONES_BITACORA)[number]

type Valores = Record<string, unknown> | null | undefined

export type EntradaBitacora = {
  /** auth.users.id de quien actúa; null/omitido = acción automática. */
  userId?: string | null
  accion: AccionBitacora
  entidad: string
  entidadId?: string | null
  antes?: Valores
  despues?: Valores
  motivo?: string | null
  detalle?: Record<string, unknown> | null
}

const CLAVE_SENSIBLE = /contrase|password|token|secret|clave|jwt/i

/** R-51: nunca se registran contraseñas ni credenciales. */
function limpiar(valores: Valores): Record<string, unknown> | null {
  if (!valores) return null
  const salida: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(valores)) {
    if (!CLAVE_SENSIBLE.test(k)) salida[k] = v
  }
  return salida
}

/**
 * Registra una acción en crm_bitacora. Nunca lanza: devuelve false si no se pudo
 * (el error se deja en el log del servidor, sin datos personales).
 */
export async function registrar(entrada: EntradaBitacora): Promise<boolean> {
  const { error } = await supabase.from('crm_bitacora').insert({
    user_id: entrada.userId ?? null,
    accion: entrada.accion,
    entidad: entrada.entidad,
    entidad_id: entrada.entidadId ?? null,
    valores_antes: limpiar(entrada.antes),
    valores_despues: limpiar(entrada.despues),
    motivo: entrada.motivo ?? null,
    detalle: limpiar(entrada.detalle),
  })
  if (error) {
    console.error('[crm/bitacora] no se pudo registrar', entrada.accion, entrada.entidad, error.code)
    return false
  }
  return true
}

import { supabase } from '@/lib/supabase'

/** Columnas de crm_solicitudes que usan las pantallas. */
export const COLUMNAS_SOLICITUD =
  'id,codigo,contacto_id,empresa_id,canal_origen,origen_tabla,origen_id,area_principal_id,servicio_id,' +
  'descripcion,objetivo_cliente,modalidad,urgencia,estado,motivo_estado,estado_at,conflicto_revision,' +
  'requiere_validacion,reserva_reforzada,resultado_cierre,pendientes_cierre,fecha_recepcion,' +
  'primera_respuesta_at,asignada_at,cerrada_at,created_by,created_at,updated_at'

export type SolicitudFila = {
  id: string
  codigo: string
  contacto_id: string
  empresa_id: string | null
  canal_origen: string
  origen_tabla: string | null
  origen_id: string | null
  area_principal_id: string | null
  servicio_id: string | null
  descripcion: string
  objetivo_cliente: string | null
  modalidad: string | null
  urgencia: string
  estado: string
  motivo_estado: string | null
  estado_at: string
  conflicto_revision: string
  requiere_validacion: boolean
  reserva_reforzada: boolean
  resultado_cierre: string | null
  pendientes_cierre: string | null
  fecha_recepcion: string
  primera_respuesta_at: string | null
  asignada_at: string | null
  cerrada_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Fija `primera_respuesta_at` la PRIMERA vez que ocurra cualquiera de estas dos cosas:
 *   · la solicitud sale de «nueva» (la llama `cambiarEstado`), o
 *   · alguien registra una actividad de contacto con el cliente: llamada, o mensaje (incluido el
 *     correo, que en la base es `tipo = 'mensaje'` con `canal = 'correo'`). La ruta de actividades
 *     es de la Entrega 4 y llamará a esta función.
 * Una vez fijado NO se cambia nunca: la base no lo protege, por eso el UPDATE lleva
 * `primera_respuesta_at IS NULL`. Nunca lanza.
 */
export async function marcarPrimeraRespuesta(solicitudId: string, instante: Date = new Date()): Promise<void> {
  const { error } = await supabase
    .from('crm_solicitudes')
    .update({ primera_respuesta_at: instante.toISOString() })
    .eq('id', solicitudId)
    .is('primera_respuesta_at', null)
  if (error) console.error('[crm/solicitudes] primera respuesta', error.code)
}

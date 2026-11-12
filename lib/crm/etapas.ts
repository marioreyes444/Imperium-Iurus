// Etapa de relación del contacto (sección 10.3). Se recalcula tras cada cambio de estado,
// tomando la más avanzada entre sus solicitudes.
import { supabase } from '@/lib/supabase'

const POR_ESTADO: Record<string, { rango: number; etapa: string }> = {
  nueva:                         { rango: 1, etapa: 'prospecto_nuevo' },
  en_calificacion:               { rango: 2, etapa: 'prospecto_calificado' },
  pendiente_informacion:         { rango: 2, etapa: 'prospecto_calificado' },
  consulta_agendada:             { rango: 3, etapa: 'consulta_agendada' },
  propuesta_enviada:             { rango: 4, etapa: 'propuesta_enviada' },
  pendiente_aceptacion:          { rango: 4, etapa: 'propuesta_enviada' },
  aceptada_pendiente_asignacion: { rango: 4, etapa: 'propuesta_enviada' },
  asignada:                      { rango: 5, etapa: 'cliente_activo' },
  en_curso:                      { rango: 5, etapa: 'cliente_activo' },
  en_espera:                     { rango: 5, etapa: 'cliente_activo' },
}

/**
 * Etapa que corresponde a un conjunto de estados de solicitud, o `null` si no hay base para
 * decidir (sin solicitudes, o solo descartadas). Solo cerradas → cliente_inactivo.
 */
export function etapaDeEstados(estados: string[]): string | null {
  let mejor: { rango: number; etapa: string } | null = null
  for (const e of estados) {
    const candidata = POR_ESTADO[e]
    if (candidata && (!mejor || candidata.rango > mejor.rango)) mejor = candidata
  }
  if (mejor) return mejor.etapa
  return estados.includes('cerrada') ? 'cliente_inactivo' : null
}

/**
 * Recalcula la etapa de un contacto (o empresa). `no_continua` se pone a mano con motivo y no se
 * sobrescribe, salvo que llegue una solicitud nueva (`solicitudNueva`). Nunca lanza.
 */
export async function recalcularEtapa(contactoId: string, opciones: { solicitudNueva?: boolean } = {}): Promise<void> {
  try {
    const { data: contacto, error } = await supabase
      .from('crm_contactos').select('id,etapa_relacion').eq('id', contactoId).maybeSingle()
    if (error || !contacto) {
      if (error) console.error('[crm/etapas] contacto', error.code)
      return
    }
    if (contacto.etapa_relacion === 'no_continua' && !opciones.solicitudNueva) return

    const { data: solicitudes, error: errSol } = await supabase
      .from('crm_solicitudes')
      .select('estado')
      .or(`contacto_id.eq.${contactoId},empresa_id.eq.${contactoId}`)
    if (errSol) {
      console.error('[crm/etapas] solicitudes', errSol.code)
      return
    }

    const etapa = etapaDeEstados((solicitudes ?? []).map((s) => (s as { estado: string }).estado))
    if (!etapa || etapa === contacto.etapa_relacion) return

    const { error: errUpd } = await supabase
      .from('crm_contactos')
      .update({ etapa_relacion: etapa, motivo_no_continua: null })
      .eq('id', contactoId)
    if (errUpd) console.error('[crm/etapas] actualizar', errUpd.code)
  } catch (e) {
    console.error('[crm/etapas] error inesperado', e instanceof Error ? e.name : 'error')
  }
}

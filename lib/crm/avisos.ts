// Avisos del CRM (versión de la Entrega 2: solo lo que exige R-16).
//   · Canales de esta entrega: PANEL (para todo el personal que corresponda) y PUSH.
//   · El push usa `sendPushToAdmin` de lib/push.ts SIN modificarlo: llega a las suscripciones del panel
//     de administración, no a una persona concreta. El push personal queda pendiente para el E7.
//   · El correo va en la Entrega 4.
//   · Nunca lanzan, y se disparan DESPUÉS de completar la acción: un aviso fallido no la deshace (R-44).
//   · Los títulos no llevan datos sensibles. Un caso con reserva reforzada solo avisa a Dirección, y su
//     push es genérico (sin código ni enlace al caso).
import { supabase } from '@/lib/supabase'
import { sendPushToAdmin } from '@/lib/push'

type Destinatario = { id: string; user_id: string }

async function direccionActiva(): Promise<Destinatario[]> {
  const { data, error } = await supabase
    .from('crm_personal')
    .select('id,user_id')
    .eq('rol', 'direccion')
    .eq('activo', true)
    .not('user_id', 'is', null)
  if (error) {
    console.error('[crm/avisos] Dirección', error.code)
    return []
  }
  return (data ?? []) as Destinatario[]
}

/** Personal con turno vigente ahora (crm_turnos), activo y con cuenta. */
async function personalDeTurno(): Promise<Destinatario[]> {
  const ahora = new Date().toISOString()
  const { data: turnos, error } = await supabase
    .from('crm_turnos')
    .select('personal_id')
    .lte('desde', ahora)
    .gte('hasta', ahora)
  if (error) {
    console.error('[crm/avisos] turnos', error.code)
    return []
  }
  const ids = [...new Set((turnos ?? []).map((t) => (t as { personal_id: string }).personal_id))]
  if (ids.length === 0) return []
  const { data: personas, error: errPersonas } = await supabase
    .from('crm_personal')
    .select('id,user_id')
    .in('id', ids)
    .eq('activo', true)
    .not('user_id', 'is', null)
  if (errPersonas) {
    console.error('[crm/avisos] personal de turno', errPersonas.code)
    return []
  }
  return (personas ?? []) as Destinatario[]
}

/**
 * R-16: aviso inmediato por una solicitud crítica a Dirección y al personal de turno, sin esperar la
 * calificación. Nunca lanza.
 */
export async function avisarSolicitudCritica(solicitud: { id: string; codigo: string; reservada: boolean }): Promise<void> {
  try {
    const destinatarios = new Map<string, Destinatario>()
    for (const d of await direccionActiva()) destinatarios.set(d.user_id, d)
    // Un caso reservado no avisa a quien no esté autorizado: aún no tiene equipo, solo Dirección.
    if (!solicitud.reservada) for (const d of await personalDeTurno()) destinatarios.set(d.user_id, d)

    const ahora = new Date().toISOString()
    const filas = [...destinatarios.values()].map((d) => ({
      destinatario_id: d.user_id,
      canal: 'panel',
      tipo: 'solicitud_critica',
      solicitud_id: solicitud.id,
      titulo: `Solicitud crítica ${solicitud.codigo}`,
      url: `/admin/crm/solicitudes/${solicitud.id}`,
      estado: 'enviada',
      enviada_at: ahora,
    }))
    if (filas.length > 0) {
      const { error } = await supabase.from('crm_notificaciones').insert(filas)
      if (error) console.error('[crm/avisos] no se guardaron los avisos del panel', error.code)
    }

    // Push: sin nombre del cliente ni datos de un caso reservado.
    await sendPushToAdmin(
      solicitud.reservada
        ? { title: 'Solicitud crítica pendiente', body: 'Revisa el CRM.', url: '/admin/crm' }
        : { title: `Solicitud crítica ${solicitud.codigo}`, body: 'Requiere atención inmediata.', url: `/admin/crm/solicitudes/${solicitud.id}` },
    )
  } catch (e) {
    console.error('[crm/avisos] error inesperado', e instanceof Error ? e.name : 'error')
  }
}

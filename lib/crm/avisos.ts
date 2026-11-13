// Avisos del CRM (sección 11.2).
//   · Canales: PANEL (siempre, para el personal) y CORREO (Resend, lib/crm/correo.ts). Cada aviso se guarda
//     en crm_notificaciones con su resultado: `enviada` o `fallida` con `intentos` y `ultimo_error` (R-44).
//   · PUSH: solo para la solicitud crítica (R-16), con `sendPushToAdmin` de lib/push.ts SIN modificarlo:
//     llega a las suscripciones del panel de administración. El push personal queda para el E7.
//   · Solo para el personal: ningún correo al cliente (los recordatorios son del E7).
//   · Nunca lanzan, y se disparan DESPUÉS de completar la acción: un aviso fallido no la deshace.
//   · Los títulos no llevan datos sensibles (código del caso, nunca el nombre del cliente).
//   · Un caso con reserva reforzada solo avisa a Dirección y a quien esté activo en su equipo; su push es
//     genérico (sin código ni enlace al caso).
import { supabase } from '@/lib/supabase'
import { sendPushToAdmin } from '@/lib/push'
import { autorizadosParaAviso } from '@/lib/crm/permisos'
import { enviarCorreoAviso } from '@/lib/crm/correo'

type Destinatario = { id: string; user_id: string; correo: string | null }

type Aviso = {
  tipo: string
  titulo: string
  url: string
  solicitudId?: string | null
  citaId?: string | null
}

const COLUMNAS_DESTINO = 'id,user_id,correo'

async function personasActivas(filtro: { roles?: string[]; ids?: string[]; userIds?: string[]; soloAbogados?: boolean }): Promise<Destinatario[]> {
  let q = supabase.from('crm_personal').select(COLUMNAS_DESTINO).eq('activo', true).not('user_id', 'is', null)
  if (filtro.soloAbogados) q = q.eq('es_abogado', true)
  if (filtro.roles) q = q.in('rol', filtro.roles)
  if (filtro.ids) q = q.in('id', filtro.ids.length > 0 ? filtro.ids : ['00000000-0000-0000-0000-000000000000'])
  if (filtro.userIds) q = q.in('user_id', filtro.userIds.length > 0 ? filtro.userIds : ['00000000-0000-0000-0000-000000000000'])
  const { data, error } = await q
  if (error) {
    console.error('[crm/avisos] destinatarios', error.code)
    return []
  }
  return (data ?? []) as Destinatario[]
}

/** Abogados con turno vigente ahora (crm_turnos), activos y con cuenta. Sin turno vigente: lista vacía. */
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
  return ids.length === 0 ? [] : personasActivas({ ids, soloAbogados: true })
}

/**
 * Núcleo: aviso de PANEL (queda `enviada` al insertarse) y de CORREO (`pendiente` → se intenta enviar →
 * `enviada` o `fallida`). Nunca lanza.
 */
async function entregar(destinatarios: Destinatario[], aviso: Aviso): Promise<void> {
  const unicos = [...new Map(destinatarios.map((d) => [d.user_id, d])).values()]
  if (unicos.length === 0) return
  const ahora = new Date().toISOString()
  const base = {
    tipo: aviso.tipo,
    solicitud_id: aviso.solicitudId ?? null,
    cita_id: aviso.citaId ?? null,
    titulo: aviso.titulo,
    url: aviso.url,
  }

  const { error: errPanel } = await supabase.from('crm_notificaciones').insert(
    unicos.map((d) => ({ ...base, destinatario_id: d.user_id, canal: 'panel', estado: 'enviada', enviada_at: ahora })),
  )
  if (errPanel) console.error('[crm/avisos] panel', aviso.tipo, errPanel.code)

  const { data: filas, error: errCorreo } = await supabase
    .from('crm_notificaciones')
    .insert(unicos.map((d) => ({ ...base, destinatario_id: d.user_id, canal: 'correo', estado: 'pendiente' })))
    .select('id,destinatario_id')
  if (errCorreo) {
    console.error('[crm/avisos] correo (registro)', aviso.tipo, errCorreo.code)
    return
  }

  const porUsuario = new Map(unicos.map((d) => [d.user_id, d]))
  await Promise.allSettled(((filas ?? []) as { id: string; destinatario_id: string }[]).map(async (fila) => {
    const destino = porUsuario.get(fila.destinatario_id)
    const r = destino?.correo
      ? await enviarCorreoAviso({ para: destino.correo, titulo: aviso.titulo, url: aviso.url })
      : { ok: false as const, error: 'Sin correo registrado en la ficha' }
    const { error } = await supabase
      .from('crm_notificaciones')
      .update(r.ok
        ? { estado: 'enviada', enviada_at: new Date().toISOString(), intentos: 1, ultimo_error: null }
        : { estado: 'fallida', intentos: 1, ultimo_error: r.error })
      .eq('id', fila.id)
    if (error) console.error('[crm/avisos] correo (resultado)', aviso.tipo, error.code)
  }))
}

/** Aviso a fichas concretas, respetando la reserva reforzada del caso y excluyendo a quien actúa. */
async function avisarFichas(personalIds: (string | null | undefined)[], aviso: Aviso, actorPersonalId?: string | null): Promise<void> {
  const ids = [...new Set(personalIds.filter((x): x is string => !!x && x !== actorPersonalId))]
  if (ids.length === 0) return
  const autorizados = await autorizadosParaAviso(aviso.solicitudId ?? null, ids)
  if (autorizados.size === 0) return
  await entregar(await personasActivas({ ids: [...autorizados] }), aviso)
}

const fechaCorta = (fecha: string, hora: string) => {
  const [, m, d] = fecha.split('-')
  return `${d}/${m} ${hora.slice(0, 5)}`
}

// ─── Entregas 2 y 3 (ahora también por correo) ──────────────────────────────

/** Asignación por confirmar: aviso a la persona asignada (`userId` = su cuenta). Nunca lanza. */
export async function avisarAsignacionPorConfirmar(a: { solicitudId: string; codigo: string; userId: string | null }): Promise<void> {
  try {
    if (!a.userId) return
    await entregar(await personasActivas({ userIds: [a.userId] }), {
      tipo: 'asignacion_por_confirmar',
      solicitudId: a.solicitudId,
      titulo: `Nueva asignación en ${a.codigo}`,
      url: '/admin/crm/asignaciones',
    })
  } catch (e) {
    console.error('[crm/avisos] asignación por confirmar', e instanceof Error ? e.name : 'error')
  }
}

/**
 * Asignación rechazada: aviso a Dirección y a quien propuso (este solo si el caso no tiene reserva
 * reforzada). Nunca lanza.
 */
export async function avisarAsignacionRechazada(a: {
  solicitudId: string; codigo: string; reservada: boolean; propuestoPor: string | null
}): Promise<void> {
  try {
    const destinos = await personasActivas({ roles: ['direccion'] })
    if (!a.reservada && a.propuestoPor) destinos.push(...await personasActivas({ userIds: [a.propuestoPor] }))
    await entregar(destinos, {
      tipo: 'asignacion_rechazada',
      solicitudId: a.solicitudId,
      titulo: `Asignación rechazada en ${a.codigo}`,
      url: `/admin/crm/solicitudes/${a.solicitudId}?tab=equipo`,
    })
  } catch (e) {
    console.error('[crm/avisos] asignación rechazada', e instanceof Error ? e.name : 'error')
  }
}

/**
 * R-16: aviso inmediato por una solicitud crítica a Dirección y al personal de turno, sin esperar la
 * calificación. Panel, correo y push. Nunca lanza.
 */
export async function avisarSolicitudCritica(solicitud: { id: string; codigo: string; reservada: boolean }): Promise<void> {
  try {
    const destinos = await personasActivas({ roles: ['direccion'] })
    // Un caso reservado no avisa a quien no esté autorizado: aún no tiene equipo, solo Dirección.
    if (!solicitud.reservada) destinos.push(...await personalDeTurno())
    await entregar(destinos, {
      tipo: 'solicitud_critica',
      solicitudId: solicitud.id,
      titulo: `Solicitud crítica ${solicitud.codigo}`,
      url: `/admin/crm/solicitudes/${solicitud.id}`,
    })

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

// ─── Entrega 4: citas, tareas y bloqueos (panel + correo) ───────────────────

export type EventoCita = 'cita_agendada' | 'cita_reagendada' | 'cita_cancelada'

const TITULO_CITA: Record<EventoCita, string> = {
  cita_agendada: 'Cita agendada',
  cita_reagendada: 'Cita reagendada',
  cita_cancelada: 'Cita cancelada',
}

/**
 * Cita agendada / reagendada / cancelada: aviso al abogado de la cita (y al anterior, si cambió), salvo
 * a quien actúa. Nunca lanza.
 */
export async function avisarCita(a: {
  evento: EventoCita
  cita: { id: string; solicitud_id: string | null; fecha: string; hora: string }
  codigo: string | null
  abogados: (string | null)[]
  actorPersonalId: string
}): Promise<void> {
  try {
    await avisarFichas(a.abogados, {
      tipo: a.evento,
      solicitudId: a.cita.solicitud_id,
      citaId: a.cita.id,
      titulo: `${TITULO_CITA[a.evento]}: ${fechaCorta(a.cita.fecha, a.cita.hora)}${a.codigo ? ` · ${a.codigo}` : ''}`,
      url: `/admin/crm/agenda?semana=${a.cita.fecha}`,
    }, a.actorPersonalId)
  } catch (e) {
    console.error('[crm/avisos] cita', e instanceof Error ? e.name : 'error')
  }
}

/** Tarea asignada: aviso al responsable, salvo que sea quien la crea. Nunca lanza. */
export async function avisarTareaAsignada(a: {
  solicitudId: string; codigo: string | null; responsableId: string; actorPersonalId: string | null
}): Promise<void> {
  try {
    await avisarFichas([a.responsableId], {
      tipo: 'tarea_asignada',
      solicitudId: a.solicitudId,
      titulo: a.codigo ? `Nueva tarea en ${a.codigo}` : 'Nueva tarea asignada',
      url: '/admin/crm/tareas',
    }, a.actorPersonalId)
  } catch (e) {
    console.error('[crm/avisos] tarea', e instanceof Error ? e.name : 'error')
  }
}

/**
 * Bloqueo que deja citas activas por reagendar (R-45): aviso a Dirección y Coordinación.
 * El título no lleva datos de ningún caso. Nunca lanza.
 */
export async function avisarBloqueoConCitas(a: { personalId: string; cantidad: number }): Promise<void> {
  try {
    if (a.cantidad <= 0) return
    const plural = a.cantidad === 1 ? '1 cita' : `${a.cantidad} citas`
    await entregar(await personasActivas({ roles: ['direccion', 'coordinacion'] }), {
      tipo: 'bloqueo_con_citas',
      titulo: `Bloqueo con ${plural} por reagendar`,
      url: `/admin/crm/personal/${a.personalId}/horario`,
    })
  } catch (e) {
    console.error('[crm/avisos] citas por reagendar', e instanceof Error ? e.name : 'error')
  }
}

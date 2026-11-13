// Citas del CRM (Entrega 4): consulta con visibilidad, agendar, reagendar / asignar abogado, confirmar,
// marcar atendida / no asistió y cancelar. Los permisos los decide lib/crm/permisos.ts.
//   · R-30/R-31: la base impide los cruces; aquí se revalida la disponibilidad antes (11.1).
//   · R-34: duración fija DURACION_CITA_MIN; no se agenda en el pasado ni con menos antelación.
//   · R-37: se cancela SIEMPRE con crm_cancelar_cita (que escribe su propia bitácora).
//   · R-38: una cita cancelada o concluida no vuelve a estar activa. R-39: atendida/no_asistio solo si ya pasó.
import type { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { esCruceCita, esTablaAusente, jsonError, respuestaErrorBD } from '@/lib/crm/errores'
import { CrmNoDisponibleError, puedeGestionarCita, puedeVerSolicitud, type Personal } from '@/lib/crm/permisos'
import { alcancesDe } from '@/lib/crm/visibilidad'
import { registrar } from '@/lib/crm/bitacora'
import { cambiarEstado, type Estado } from '@/lib/crm/estados'
import { recalcularEtapa } from '@/lib/crm/etapas'
import { avisarCita, avisarTareaAsignada } from '@/lib/crm/avisos'
import { nombreContacto } from '@/lib/crm/contactos'
import { DURACION_CITA_MIN } from '@/lib/crm/config'
import { comprobarHora, ESTADOS_CITA_ACTIVA, horasLibresDelDia } from '@/lib/crm/disponibilidad'
import { instanteGuayaquil } from '@/lib/crm/fechas'

export const COLUMNAS_CITA =
  'id,nombre,correo,telefono,tipo_consulta,fecha,hora,mensaje,estado,created_at,cliente_id,abogado_id,solicitud_id,' +
  'duracion_min,reagendada_de,cancelada_at,cancelada_origen,motivo_cancelacion'

export type CitaFila = {
  id: string
  nombre: string
  correo: string
  telefono: string
  tipo_consulta: string
  fecha: string
  hora: string
  mensaje: string | null
  estado: string
  created_at: string
  cliente_id: string | null
  abogado_id: string | null
  solicitud_id: string | null
  duracion_min: number | null
  reagendada_de: string | null
  cancelada_at: string | null
  cancelada_origen: string | null
  motivo_cancelacion: string | null
}

export const ETIQUETA_ESTADO_CITA: Record<string, string> = {
  pendiente: 'Pendiente', confirmada: 'Confirmada', cancelada: 'Cancelada', atendida: 'Atendida', no_asistio: 'No asistió',
}
export const ETIQUETA_ORIGEN_CANCELACION: Record<string, string> = { cliente: 'El cliente', estudio: 'El estudio', abogado: 'El abogado' }

export const esActiva = (estado: string) => (ESTADOS_CITA_ACTIVA as readonly string[]).includes(estado)

/** La hora de inicio de la cita ya pasó (R-39). */
export function yaPaso(cita: { fecha: string; hora: string }, ahora: Date = new Date()): boolean {
  return instanteGuayaquil(cita.fecha, cita.hora).getTime() <= ahora.getTime()
}

export async function obtenerCita(id: string): Promise<CitaFila | null> {
  const { data, error } = await supabase.from('citas').select(COLUMNAS_CITA).eq('id', id).maybeSingle()
  if (error) {
    if (esTablaAusente(error) || error.code === '42703') throw new CrmNoDisponibleError()
    console.error('[crm/citas] cita', error.code)
    throw new Error('CRM_ERROR')
  }
  return (data as unknown as CitaFila | null) ?? null
}

// ─── Visibilidad EN la consulta ─────────────────────────────────────────────

type FiltroCitas = { modo: 'todo' } | { modo: 'or'; expresion: string } | { modo: 'ninguno' }

/** Casos reservados que la persona NO puede ver (para excluir sus citas). */
async function reservadosAjenos(incluir: string[]): Promise<string[]> {
  let q = supabase.from('crm_solicitudes').select('id').eq('reserva_reforzada', true).limit(1000)
  if (incluir.length > 0) q = q.not('id', 'in', `(${incluir.join(',')})`)
  const { data, error } = await q
  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    console.error('[crm/citas] reservados', error.code)
    return []
  }
  return (data ?? []).map((f) => (f as { id: string }).id)
}

/**
 * Qué citas puede ver la persona (4.2 aplicado a citas, que no tienen columna de reserva):
 *   · Dirección: todas.
 *   · Coordinación y asistencia: todas salvo las de casos reservados donde no estén activas.
 *   · Asociado: las de sus casos y las que atiende como abogado.
 *   · Externo: ninguna (no usa la agenda).
 */
export async function filtroCitasDe(personal: Personal): Promise<FiltroCitas> {
  if (personal.rol === 'direccion') return { modo: 'todo' }
  if (personal.rol === 'externo') return { modo: 'ninguno' }
  const al = await alcancesDe(personal)
  if (personal.rol === 'coordinacion' || personal.rol === 'asistencia') {
    const ajenos = await reservadosAjenos(al.solicitudesActivas)
    return ajenos.length === 0 ? { modo: 'todo' } : { modo: 'or', expresion: `solicitud_id.is.null,solicitud_id.not.in.(${ajenos.join(',')})` }
  }
  const ids = al.solicitudes.modo === 'solo' ? al.solicitudes.ids : []
  return { modo: 'or', expresion: ids.length > 0 ? `abogado_id.eq.${personal.id},solicitud_id.in.(${ids.join(',')})` : `abogado_id.eq.${personal.id}` }
}

type Filtrable = { or: (f: string) => unknown; in: (c: string, v: string[]) => unknown }
export function aplicarFiltroCitas<Q>(consulta: Q, filtro: FiltroCitas): Q {
  const q = consulta as unknown as Filtrable
  if (filtro.modo === 'or') return q.or(filtro.expresion) as Q
  if (filtro.modo === 'ninguno') return q.in('id', ['00000000-0000-0000-0000-000000000000']) as Q
  return consulta
}

export type CitaVista = CitaFila & {
  codigo: string | null
  abogado: string | null
  estado_etiqueta: string
  ya_paso: boolean
}

/** Agrega código del caso y nombre del abogado a una lista de citas. */
export async function enriquecer(citas: CitaFila[]): Promise<CitaVista[]> {
  const sol = [...new Set(citas.map((c) => c.solicitud_id).filter((x): x is string => !!x))]
  const abo = [...new Set(citas.map((c) => c.abogado_id).filter((x): x is string => !!x))]
  const [s, a] = await Promise.all([
    sol.length > 0 ? supabase.from('crm_solicitudes').select('id,codigo').in('id', sol) : Promise.resolve({ data: [] }),
    abo.length > 0 ? supabase.from('crm_personal').select('id,nombres,apellidos').in('id', abo) : Promise.resolve({ data: [] }),
  ])
  const codigos = new Map(((s.data ?? []) as { id: string; codigo: string }[]).map((x) => [x.id, x.codigo]))
  const nombres = new Map(((a.data ?? []) as { id: string; nombres: string; apellidos: string }[]).map((x) => [x.id, `${x.nombres} ${x.apellidos}`]))
  const ahora = new Date()
  return citas.map((c) => ({
    ...c,
    hora: c.hora.slice(0, 5),
    codigo: c.solicitud_id ? (codigos.get(c.solicitud_id) ?? null) : null,
    abogado: c.abogado_id ? (nombres.get(c.abogado_id) ?? null) : null,
    estado_etiqueta: ETIQUETA_ESTADO_CITA[c.estado] ?? c.estado,
    ya_paso: yaPaso(c, ahora),
  }))
}

/** Citas visibles en un rango (agenda) o de un caso. */
export async function listarCitas(personal: Personal, f: {
  desde?: string; hasta?: string; abogadoId?: string; solicitudId?: string; sinAbogado?: boolean; soloActivas?: boolean
}): Promise<CitaVista[]> {
  let q = supabase
    .from('citas')
    .select(COLUMNAS_CITA)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true })
    .limit(500)
  if (f.desde) q = q.gte('fecha', f.desde)
  if (f.hasta) q = q.lte('fecha', f.hasta)
  if (f.abogadoId) q = q.eq('abogado_id', f.abogadoId)
  if (f.sinAbogado) q = q.is('abogado_id', null)
  if (f.solicitudId) q = q.eq('solicitud_id', f.solicitudId)
  if (f.soloActivas) q = q.in('estado', ESTADOS_CITA_ACTIVA)
  q = aplicarFiltroCitas(q, await filtroCitasDe(personal))

  const { data, error } = await q
  if (error) {
    if (esTablaAusente(error) || error.code === '42703') throw new CrmNoDisponibleError()
    console.error('[crm/citas] listar', error.code)
    throw new Error('CRM_ERROR')
  }
  return enriquecer((data ?? []) as unknown as CitaFila[])
}

// ─── Escrituras ─────────────────────────────────────────────────────────────

export type Resultado<T> = { ok: true; datos: T } | { ok: false; respuesta: NextResponse }
const fallo = <T>(respuesta: NextResponse): Resultado<T> => ({ ok: false, respuesta })

type SolicitudCita = { id: string; codigo: string; estado: string; urgencia: string; contacto_id: string; empresa_id: string | null }
type ContactoCita = {
  id: string; tipo: 'persona' | 'empresa'; nombres: string | null; apellidos: string | null; razon_social: string | null
  correo: string | null; telefono: string | null; user_id: string | null
}

async function abogadoActivo(id: string): Promise<boolean> {
  const { data } = await supabase.from('crm_personal').select('id').eq('id', id).eq('activo', true).eq('es_abogado', true).maybeSingle()
  return !!data
}

/** 409 con las horas libres actualizadas de ese día (el formulario no pierde lo escrito). */
async function respuestaOcupada(abogadoId: string, fecha: string, excluir: string | null, mensaje = 'Esa hora acaba de ocuparse') {
  const disponibilidad = await horasLibresDelDia(abogadoId, fecha, excluir)
  return jsonError(409, mensaje, { codigo: 'HORA_OCUPADA', datos: disponibilidad })
}

/** tipo_consulta de una cita del CRM (decisión del responsable): empresa → empresarial; crítica → urgencia. */
function tipoConsulta(contacto: ContactoCita, solicitud: SolicitudCita): string {
  if (contacto.tipo === 'empresa') return 'empresarial'
  if (solicitud.urgencia === 'critica') return 'urgencia'
  return 'personal'
}

/**
 * Agenda una cita para un caso. El llamador YA comprobó que la persona puede gestionar citas del caso.
 * Si la solicitud está `nueva`, pasa por `en_calificacion` y luego a `consulta_agendada`; si está
 * `en_calificacion`, pasa a `consulta_agendada` (con `cambiarEstado`, que respeta 8.1).
 */
export async function agendarCita(personal: Personal, d: {
  solicitud_id: string; abogado_id: string; fecha: string; hora: string; mensaje?: string | null; reagendada_de?: string | null
}): Promise<Resultado<{ id: string }>> {
  const { data: solData, error: errSol } = await supabase
    .from('crm_solicitudes').select('id,codigo,estado,urgencia,contacto_id,empresa_id').eq('id', d.solicitud_id).maybeSingle()
  if (errSol) return fallo(respuestaErrorBD('crm/citas (solicitud)', errSol))
  if (!solData) return fallo(jsonError(404, 'No encontrado'))
  const sol = solData as SolicitudCita
  if (sol.estado === 'cerrada' || sol.estado === 'descartada') {
    return fallo(jsonError(422, 'No se agendan citas en un caso cerrado o descartado.'))
  }

  // La cita copia nombre, correo y teléfono del contacto (columnas obligatorias de citas). Sin relleno.
  const { data: conData, error: errCon } = await supabase
    .from('crm_contactos').select('id,tipo,nombres,apellidos,razon_social,correo,telefono,user_id').eq('id', sol.contacto_id).maybeSingle()
  if (errCon) return fallo(respuestaErrorBD('crm/citas (contacto)', errCon))
  const contacto = conData as ContactoCita | null
  if (!contacto || !contacto.correo || !contacto.telefono) {
    return fallo(jsonError(422, 'Completa el correo y el teléfono del contacto para agendar', {
      codigo: 'CONTACTO_INCOMPLETO',
      datos: { contacto_id: sol.contacto_id, editar: `/admin/crm/contactos/${sol.contacto_id}/editar` },
    }))
  }

  if (!(await abogadoActivo(d.abogado_id))) {
    return fallo(jsonError(400, 'Revisa los datos enviados.', { campos: { abogado_id: 'Elige un abogado activo' } }))
  }

  if (d.reagendada_de) {
    const anterior = await obtenerCita(d.reagendada_de)
    if (!anterior || anterior.estado !== 'cancelada' || anterior.solicitud_id !== sol.id) {
      return fallo(jsonError(400, 'Revisa los datos enviados.', { campos: { reagendada_de: 'La cita anterior no corresponde' } }))
    }
  }

  // 11.1: se repite la comprobación al guardar.
  const c = await comprobarHora({ abogadoId: d.abogado_id, fecha: d.fecha, hora: d.hora, enRejilla: true })
  if (!c.ok) return fallo(jsonError(409, c.mensaje, { codigo: 'HORA_OCUPADA', datos: c.disponibilidad }))

  const { data: creada, error } = await supabase
    .from('citas')
    .insert({
      nombre: nombreContacto(contacto),
      correo: contacto.correo,
      telefono: contacto.telefono,
      tipo_consulta: tipoConsulta(contacto, sol),
      fecha: d.fecha,
      hora: d.hora,
      mensaje: d.mensaje ?? null,
      cliente_id: contacto.user_id,
      abogado_id: d.abogado_id,
      solicitud_id: sol.id,
      duracion_min: DURACION_CITA_MIN,
      reagendada_de: d.reagendada_de ?? null,
    })
    .select('id')
    .single()
  if (error) {
    if (esCruceCita(error)) return fallo(await respuestaOcupada(d.abogado_id, d.fecha, null))
    return fallo(respuestaErrorBD('crm/citas (agendar)', error))
  }
  const id = (creada as { id: string }).id

  // ── Efectos posteriores: best-effort, nunca deshacen la cita ──────────────
  try {
    await registrar({
      userId: personal.user_id,
      accion: 'agendar_cita',
      entidad: 'citas',
      entidadId: id,
      despues: { fecha: d.fecha, hora: d.hora, abogado_id: d.abogado_id, solicitud_id: sol.id, duracion_min: DURACION_CITA_MIN, reagendada_de: d.reagendada_de ?? null },
    })

    const pasos: Estado[] = sol.estado === 'nueva' ? ['en_calificacion', 'consulta_agendada'] : sol.estado === 'en_calificacion' ? ['consulta_agendada'] : []
    for (const hacia of pasos) {
      const r = await cambiarEstado({ personal, solicitudId: sol.id, hacia })
      if (!r.ok) {
        console.error('[crm/citas] no se pudo pasar la solicitud a', hacia, r.respuesta.status)
        break
      }
    }

    await avisarCita({
      evento: 'cita_agendada',
      cita: { id, solicitud_id: sol.id, fecha: d.fecha, hora: d.hora },
      codigo: sol.codigo,
      abogados: [d.abogado_id],
      actorPersonalId: personal.id,
    })
  } catch (e) {
    console.error('[crm/citas] efectos posteriores (agendar)', e instanceof Error ? e.name : 'error')
  }
  return { ok: true, datos: { id } }
}

async function codigoDe(solicitudId: string | null): Promise<string | null> {
  if (!solicitudId) return null
  const { data } = await supabase.from('crm_solicitudes').select('codigo').eq('id', solicitudId).maybeSingle()
  return (data as { codigo: string } | null)?.codigo ?? null
}

/** UPDATE solo si la cita sigue como la vimos (citas no tiene updated_at). */
function conVersion<Q extends { eq: (c: string, v: string) => Q; is: (c: string, v: null) => Q }>(q: Q, cita: CitaFila): Q {
  let r = q.eq('estado', cita.estado).eq('fecha', cita.fecha).eq('hora', cita.hora)
  r = cita.abogado_id ? r.eq('abogado_id', cita.abogado_id) : r.is('abogado_id', null)
  return r
}

const MODIFICADA = 'Alguien más modificó esta cita; recarga.'

/**
 * Reagendar (otra fecha/hora) o asignar abogado (misma fecha/hora, p. ej. una reserva web). Misma cita:
 * la base revalida los cruces. El llamador YA comprobó el permiso.
 */
export async function reprogramarCita(personal: Personal, cita: CitaFila, d: { fecha: string; hora: string; abogado_id: string }): Promise<Resultado<{ id: string }>> {
  if (!esActiva(cita.estado)) return fallo(jsonError(409, 'Solo se reagenda una cita pendiente o confirmada.', { codigo: 'R-38' }))
  if (!(await abogadoActivo(d.abogado_id))) {
    return fallo(jsonError(400, 'Revisa los datos enviados.', { campos: { abogado_id: 'Elige un abogado activo' } }))
  }
  const mismaHora = d.fecha === cita.fecha && d.hora === cita.hora.slice(0, 5)
  if (mismaHora && d.abogado_id === cita.abogado_id) return fallo(jsonError(400, 'No hay cambios que guardar'))

  const c = await comprobarHora({ abogadoId: d.abogado_id, fecha: d.fecha, hora: d.hora, excluirCitaId: cita.id, enRejilla: !mismaHora })
  if (!c.ok) return fallo(jsonError(409, c.mensaje, { codigo: 'HORA_OCUPADA', datos: c.disponibilidad }))

  const { data, error } = await conVersion(
    supabase.from('citas').update({ fecha: d.fecha, hora: d.hora, abogado_id: d.abogado_id, duracion_min: cita.duracion_min ?? DURACION_CITA_MIN }).eq('id', cita.id),
    cita,
  ).select('id')
  if (error) {
    if (esCruceCita(error)) return fallo(await respuestaOcupada(d.abogado_id, d.fecha, cita.id))
    return fallo(respuestaErrorBD('crm/citas (reprogramar)', error))
  }
  if (!data || data.length === 0) return fallo(jsonError(409, MODIFICADA))

  try {
    const antes = { fecha: cita.fecha, hora: cita.hora.slice(0, 5), abogado_id: cita.abogado_id }
    const despues = { fecha: d.fecha, hora: d.hora, abogado_id: d.abogado_id }
    await registrar({ userId: personal.user_id, accion: mismaHora ? 'actualizar' : 'reagendar_cita', entidad: 'citas', entidadId: cita.id, antes, despues })
    await avisarCita({
      evento: mismaHora ? 'cita_agendada' : 'cita_reagendada',
      cita: { id: cita.id, solicitud_id: cita.solicitud_id, fecha: d.fecha, hora: d.hora },
      codigo: await codigoDe(cita.solicitud_id),
      abogados: [d.abogado_id, ...(cita.abogado_id && cita.abogado_id !== d.abogado_id && !mismaHora ? [cita.abogado_id] : [])],
      actorPersonalId: personal.id,
    })
  } catch (e) {
    console.error('[crm/citas] efectos posteriores (reprogramar)', e instanceof Error ? e.name : 'error')
  }
  return { ok: true, datos: { id: cita.id } }
}

/** Confirmar una cita pendiente. */
export async function confirmarCita(personal: Personal, cita: CitaFila): Promise<Resultado<{ id: string }>> {
  if (cita.estado !== 'pendiente') return fallo(jsonError(409, 'Solo se confirma una cita pendiente.'))
  const { data, error } = await conVersion(supabase.from('citas').update({ estado: 'confirmada' }).eq('id', cita.id), cita).select('id')
  if (error) return fallo(respuestaErrorBD('crm/citas (confirmar)', error))
  if (!data || data.length === 0) return fallo(jsonError(409, MODIFICADA))
  await registrar({ userId: personal.user_id, accion: 'actualizar', entidad: 'citas', entidadId: cita.id, antes: { estado: 'pendiente' }, despues: { estado: 'confirmada' } })
  return { ok: true, datos: { id: cita.id } }
}

/** R-39: atendida / no asistió, solo en una cita activa cuya hora ya pasó. R-38: no vuelve a estar activa. */
export async function marcarCita(personal: Personal, cita: CitaFila, resultado: 'atendida' | 'no_asistio'): Promise<Resultado<{ id: string }>> {
  if (!esActiva(cita.estado)) return fallo(jsonError(409, 'Esta cita ya no está activa.', { codigo: 'R-38' }))
  if (!yaPaso(cita)) return fallo(jsonError(422, 'Solo se marca como atendida o no asistida una cita cuya hora ya pasó.', { codigo: 'R-39' }))
  const { data, error } = await conVersion(supabase.from('citas').update({ estado: resultado }).eq('id', cita.id), cita).select('id')
  if (error) return fallo(respuestaErrorBD('crm/citas (marcar)', error))
  if (!data || data.length === 0) return fallo(jsonError(409, MODIFICADA))
  await registrar({ userId: personal.user_id, accion: 'actualizar', entidad: 'citas', entidadId: cita.id, antes: { estado: cita.estado }, despues: { estado: resultado } })
  return { ok: true, datos: { id: cita.id } }
}

/**
 * Responsable de la tarea de reagendar (sección 8): quien cancela si es asistencia o coordinación; si no,
 * la primera persona activa de asistencia, luego coordinación, luego Dirección.
 */
export async function responsableTareaCancelacion(personal: Pick<Personal, 'id' | 'rol'> | null): Promise<string | null> {
  if (personal && (personal.rol === 'asistencia' || personal.rol === 'coordinacion')) return personal.id
  for (const rol of ['asistencia', 'coordinacion', 'direccion']) {
    const { data, error } = await supabase
      .from('crm_personal').select('id').eq('rol', rol).eq('activo', true)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1)
    if (error) {
      console.error('[crm/citas] responsable de la tarea', error.code)
      return null
    }
    const fila = (data ?? [])[0] as { id: string } | undefined
    if (fila) return fila.id
  }
  return null
}

/**
 * Cancela con crm_cancelar_cita (R-37): libera la hora, devuelve el caso a calificación si estaba en
 * «consulta agendada» y crea la tarea de reagendar. La función escribe su propia bitácora: no se duplica.
 * Después (best-effort): etapa del contacto y avisos.
 */
export async function cancelarCita(
  actor: { personal: Pick<Personal, 'id' | 'rol' | 'user_id'> | null; userId: string | null },
  cita: CitaFila,
  d: { origen: 'cliente' | 'estudio' | 'abogado'; motivo: string },
): Promise<Resultado<{ id: string }>> {
  if (!esActiva(cita.estado)) return fallo(jsonError(409, 'Solo se cancela una cita pendiente o confirmada.', { codigo: 'R-38' }))
  const responsable = cita.solicitud_id ? await responsableTareaCancelacion(actor.personal) : null

  const { error } = await supabase.rpc('crm_cancelar_cita', {
    p_cita: cita.id,
    p_origen: d.origen,
    p_motivo: d.motivo,
    p_usuario: actor.userId,
    p_responsable_tarea: responsable,
  })
  if (error) return fallo(respuestaErrorBD('crm/citas (cancelar)', error))

  try {
    if (cita.solicitud_id) {
      const { data: sol } = await supabase.from('crm_solicitudes').select('contacto_id,empresa_id,codigo').eq('id', cita.solicitud_id).maybeSingle()
      const s = sol as { contacto_id: string; empresa_id: string | null; codigo: string } | null
      if (s) {
        await recalcularEtapa(s.contacto_id)
        if (s.empresa_id) await recalcularEtapa(s.empresa_id)
      }
      if (responsable) {
        await avisarTareaAsignada({ solicitudId: cita.solicitud_id, codigo: s?.codigo ?? null, responsableId: responsable, actorPersonalId: actor.personal?.id ?? null })
      }
      if (cita.abogado_id && actor.personal) {
        await avisarCita({
          evento: 'cita_cancelada',
          cita: { id: cita.id, solicitud_id: cita.solicitud_id, fecha: cita.fecha, hora: cita.hora },
          codigo: s?.codigo ?? null,
          abogados: [cita.abogado_id],
          actorPersonalId: actor.personal.id,
        })
      }
    } else if (cita.abogado_id && actor.personal) {
      await avisarCita({
        evento: 'cita_cancelada',
        cita: { id: cita.id, solicitud_id: null, fecha: cita.fecha, hora: cita.hora },
        codigo: null,
        abogados: [cita.abogado_id],
        actorPersonalId: actor.personal.id,
      })
    }
  } catch (e) {
    console.error('[crm/citas] efectos posteriores (cancelar)', e instanceof Error ? e.name : 'error')
  }
  return { ok: true, datos: { id: cita.id } }
}

/**
 * Citas listas para la pantalla: solo las columnas que se muestran y si la persona puede gestionarlas
 * (calculado una vez por caso).
 */
export async function citasParaPantalla(personal: Personal, citas: CitaVista[]) {
  const porCaso = new Map<string, boolean>()
  // Dirección gestiona todas: no se consulta caso por caso (evita registrar «ver_reservado» por un listado).
  if (personal.rol !== 'direccion') {
    for (const id of new Set(citas.map((c) => c.solicitud_id).filter((x): x is string => !!x))) {
      porCaso.set(id, await puedeGestionarCita(personal, { solicitud_id: id }))
    }
  }
  const sinCaso = await puedeGestionarCita(personal, { solicitud_id: null })
  return citas.map((c) => ({
    id: c.id,
    fecha: c.fecha,
    hora: c.hora,
    estado: c.estado,
    estado_etiqueta: c.estado_etiqueta,
    ya_paso: c.ya_paso,
    solicitud_id: c.solicitud_id,
    codigo: c.codigo,
    abogado: c.abogado,
    abogado_id: c.abogado_id,
    nombre: c.nombre,
    motivo_cancelacion: c.motivo_cancelacion,
    gestionable: personal.rol === 'direccion' || (c.solicitud_id ? (porCaso.get(c.solicitud_id) ?? false) : sinCaso),
  }))
}

/** Datos de un caso para la pantalla de agendar (código, estado y si al contacto le faltan datos). */
export async function datosParaAgendar(solicitudId: string) {
  const { data, error } = await supabase.from('crm_solicitudes').select('id,codigo,estado,contacto_id').eq('id', solicitudId).maybeSingle()
  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    throw new Error('CRM_ERROR')
  }
  if (!data) return null
  const s = data as { id: string; codigo: string; estado: string; contacto_id: string }
  const { data: c } = await supabase.from('crm_contactos').select('correo,telefono').eq('id', s.contacto_id).maybeSingle()
  const contacto = c as { correo: string | null; telefono: string | null } | null
  return { ...s, contacto_completo: !!contacto?.correo && !!contacto?.telefono }
}

/** Nivel de acceso a la solicitud de una cita (null si no tiene caso). */
export async function nivelDeCita(personal: Personal, cita: { solicitud_id: string | null }) {
  return cita.solicitud_id ? puedeVerSolicitud(personal, cita.solicitud_id) : null
}

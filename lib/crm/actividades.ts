// Cronología, tareas y plazos (crm_actividades). Entrega 4.
//   · R-40 (BD): toda tarea tiene responsable, vencimiento y estado.
//   · R-41 (BD): un plazo jurídico es una tarea de un caso; solo lo verifica el titular activo o Dirección.
//   · R-42: en las bandejas, un plazo jurídico verificado va antes que el resto.
//   · Asistencia no crea ni recibe actividades jurídicas: se filtra EN la consulta (no en pantalla).
//   · R-51: el contenido de las actividades (y en especial de las notas jurídicas) no va a la bitácora.
//   · Primera respuesta: una llamada o un mensaje (correo = mensaje con canal correo) la fija, con el helper
//     de la Entrega 2 (`marcarPrimeraRespuesta`).
import type { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { esTablaAusente, jsonError, respuestaErrorBD } from '@/lib/crm/errores'
import {
  CrmNoDisponibleError, cronologiaDe, esMiembroActivo, esTitularActivo, puedeActuarSobreTarea, puedeCrearActividad,
  puedeSerResponsable, puedeVerSolicitud, recibeJuridicas, type AccionTarea, type NivelVista, type Personal,
} from '@/lib/crm/permisos'
import { alcancesDe } from '@/lib/crm/visibilidad'
import { registrar } from '@/lib/crm/bitacora'
import { marcarPrimeraRespuesta } from '@/lib/crm/solicitudes'
import { avisarTareaAsignada } from '@/lib/crm/avisos'
import { localAIso } from '@/lib/crm/fechas'
import { esRol } from '@/lib/crm/roles'
import type { ActividadCrear } from '@/lib/crm/schemas'

export const COLUMNAS_ACTIVIDAD =
  'id,contacto_id,solicitud_id,tipo,canal,descripcion,resultado,es_juridica,responsable_id,vence_at,estado_tarea,' +
  'completada_at,es_plazo_juridico,plazo_verificado_por,plazo_verificado_at,autor_id,created_at'

export type ActividadFila = {
  id: string
  contacto_id: string
  solicitud_id: string | null
  tipo: string
  canal: string | null
  descripcion: string
  resultado: string | null
  es_juridica: boolean
  responsable_id: string | null
  vence_at: string | null
  estado_tarea: string | null
  completada_at: string | null
  es_plazo_juridico: boolean
  plazo_verificado_por: string | null
  plazo_verificado_at: string | null
  autor_id: string | null
  created_at: string
}

export const ETIQUETA_TIPO_ACTIVIDAD: Record<string, string> = {
  llamada: 'Llamada', reunion: 'Reunión', mensaje: 'Mensaje', actuacion: 'Actuación', tarea: 'Tarea', nota: 'Nota',
  cambio_estado: 'Cambio de estado', asignacion: 'Asignación', cita: 'Cita', sistema: 'Sistema',
}
export const ETIQUETA_CANAL_ACTIVIDAD: Record<string, string> = {
  telefono: 'Teléfono', whatsapp: 'WhatsApp', correo: 'Correo', presencial: 'Presencial', videollamada: 'Videollamada', otro: 'Otro',
}
export const ETIQUETA_ESTADO_TAREA: Record<string, string> = { pendiente: 'Pendiente', hecha: 'Hecha', cancelada: 'Cancelada' }

export type AccionesTarea = Record<AccionTarea, boolean>

export type ActividadVista = Omit<ActividadFila, 'autor_id' | 'plazo_verificado_por'> & {
  codigo: string | null
  responsable: string | null
  autor: string | null
  verificado_por: string | null
  acciones: AccionesTarea
}

type Resultado<T> = { ok: true; datos: T } | { ok: false; respuesta: NextResponse }
const fallo = <T>(respuesta: NextResponse): Resultado<T> => ({ ok: false, respuesta })

const UUID_NULO = '00000000-0000-0000-0000-000000000000'

function lanzar(contexto: string, error: { code?: string }): never {
  if (esTablaAusente(error)) throw new CrmNoDisponibleError()
  console.error(`[crm/actividades] ${contexto}`, error.code)
  throw new Error('CRM_ERROR')
}

/** Combina varias condiciones OR con AND en un solo filtro (igual que `aplicarAlcance`). */
type ConOr = { or: (f: string) => unknown }
function combinarOr<Q>(q: Q, ors: string[]): Q {
  if (ors.length === 0) return q
  const c = q as unknown as ConOr
  if (ors.length === 1) return c.or(ors[0]) as Q
  return c.or(`and(${ors.map((e) => `or(${e})`).join(',')})`) as Q
}

// ─── Lectura y presentación ─────────────────────────────────────────────────

/** Nombres, código y acciones permitidas para una página de actividades. */
async function presentar(personal: Personal, filas: ActividadFila[]): Promise<ActividadVista[]> {
  const personalIds = new Set<string>()
  const userIds = new Set<string>()
  const solicitudes = new Set<string>()
  for (const f of filas) {
    if (f.responsable_id) personalIds.add(f.responsable_id)
    if (f.plazo_verificado_por) personalIds.add(f.plazo_verificado_por)
    if (f.autor_id) userIds.add(f.autor_id)
    if (f.solicitud_id) solicitudes.add(f.solicitud_id)
  }
  const [porId, porUsuario, codigos, titulares] = await Promise.all([
    personalIds.size > 0 ? supabase.from('crm_personal').select('id,nombres,apellidos').in('id', [...personalIds]) : Promise.resolve({ data: [] }),
    userIds.size > 0 ? supabase.from('crm_personal').select('user_id,nombres,apellidos').in('user_id', [...userIds]) : Promise.resolve({ data: [] }),
    solicitudes.size > 0 ? supabase.from('crm_solicitudes').select('id,codigo,estado').in('id', [...solicitudes]) : Promise.resolve({ data: [] }),
    solicitudes.size > 0
      ? supabase.from('crm_solicitud_equipo').select('solicitud_id').eq('personal_id', personal.id).eq('rol', 'titular').eq('estado', 'activo').in('solicitud_id', [...solicitudes])
      : Promise.resolve({ data: [] }),
  ])
  const nombre = (x: { nombres: string; apellidos: string }) => `${x.nombres} ${x.apellidos}`
  const nId = new Map(((porId.data ?? []) as { id: string; nombres: string; apellidos: string }[]).map((x) => [x.id, nombre(x)]))
  const nUser = new Map(((porUsuario.data ?? []) as { user_id: string; nombres: string; apellidos: string }[]).map((x) => [x.user_id, nombre(x)]))
  const sol = new Map(((codigos.data ?? []) as { id: string; codigo: string; estado: string }[]).map((x) => [x.id, x]))
  const tit = new Set(((titulares.data ?? []) as { solicitud_id: string }[]).map((x) => x.solicitud_id))

  return filas.map((f) => {
    const { autor_id, plazo_verificado_por, ...resto } = f
    const caso = f.solicitud_id ? sol.get(f.solicitud_id) : undefined
    const abierta = f.tipo === 'tarea' && f.estado_tarea === 'pendiente' && caso?.estado !== 'cerrada'
    const ctx = {
      esResponsable: f.responsable_id === personal.id,
      esTitularActivo: f.solicitud_id ? tit.has(f.solicitud_id) : false,
      esPlazoJuridico: f.es_plazo_juridico,
    }
    return {
      ...resto,
      codigo: caso?.codigo ?? null,
      responsable: f.responsable_id ? (nId.get(f.responsable_id) ?? null) : null,
      autor: autor_id ? (nUser.get(autor_id) ?? null) : null,
      verificado_por: plazo_verificado_por ? (nId.get(plazo_verificado_por) ?? null) : null,
      acciones: {
        completar: abierta && puedeActuarSobreTarea(personal, 'completar', ctx),
        cancelar: abierta && puedeActuarSobreTarea(personal, 'cancelar', ctx),
        reprogramar: abierta && puedeActuarSobreTarea(personal, 'reprogramar', ctx),
        verificar_plazo: abierta && !f.plazo_verificado_at && puedeActuarSobreTarea(personal, 'verificar_plazo', ctx),
      },
    }
  })
}

const FORMATO_CURSOR_CRONO = /^(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))\|([0-9a-f-]{36})$/i

/**
 * Cronología de un caso (más recientes primero). `nivel` viene de `puedeVerSolicitud`:
 *   · completo: todo · sin_juridico (asistencia): sin actividades jurídicas · reducido (externo): solo sus
 *     tareas y lo que él escribió.
 */
export async function cronologiaDeCaso(personal: Personal, solicitudId: string, nivel: NivelVista, pag: { cursor?: string; limite: number }) {
  const modo = cronologiaDe(nivel)
  if (!modo) return null
  let cursor: { marca: string; id: string } | undefined
  if (pag.cursor) {
    const m = FORMATO_CURSOR_CRONO.exec(pag.cursor)
    if (!m) return 'cursor_invalido' as const
    cursor = { marca: m[1], id: m[2] }
  }

  let q = supabase
    .from('crm_actividades')
    .select(COLUMNAS_ACTIVIDAD, { count: 'exact' })
    .eq('solicitud_id', solicitudId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pag.limite + 1)
  if (modo === 'sin_juridico' || !recibeJuridicas(personal.rol)) q = q.eq('es_juridica', false)
  const ors: string[] = []
  if (modo === 'propia') ors.push(`responsable_id.eq.${personal.id},autor_id.eq.${personal.user_id ?? UUID_NULO}`)
  if (cursor) ors.push(`created_at.lt.${cursor.marca},and(created_at.eq.${cursor.marca},id.lt.${cursor.id})`)
  q = combinarOr(q, ors)

  const { data, error, count } = await q
  if (error) lanzar('cronología', error)
  const filas = (data ?? []) as unknown as ActividadFila[]
  const hayMas = filas.length > pag.limite
  const pagina = filas.slice(0, pag.limite)
  const ultimo = pagina[pagina.length - 1]
  return {
    items: await presentar(personal, pagina),
    siguienteCursor: hayMas && ultimo ? `${ultimo.created_at}|${ultimo.id}` : null,
    total: count ?? 0,
  }
}

// ─── Bandeja de tareas (R-42) ───────────────────────────────────────────────

const FORMATO_CURSOR_TAREAS = /^([AB])\|(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))\|([0-9a-f-]{36})$/i

/** Condiciones OR de visibilidad de tareas: las mismas reglas que los casos (4.2). */
async function visibilidadTareas(personal: Personal, modo: 'mias' | 'todas'): Promise<string[]> {
  if (modo === 'mias' || personal.rol === 'externo') return [`responsable_id.eq.${personal.id}`]
  if (personal.rol === 'direccion') return []
  const al = await alcancesDe(personal)
  if (personal.rol === 'coordinacion' || personal.rol === 'asistencia') {
    let q = supabase.from('crm_solicitudes').select('id').eq('reserva_reforzada', true).limit(1000)
    if (al.solicitudesActivas.length > 0) q = q.not('id', 'in', `(${al.solicitudesActivas.join(',')})`)
    const { data, error } = await q
    if (error) lanzar('reservados', error)
    const ajenos = (data ?? []).map((f) => (f as { id: string }).id)
    return ajenos.length > 0 ? [`responsable_id.eq.${personal.id},solicitud_id.not.in.(${ajenos.join(',')})`] : []
  }
  const ids = al.solicitudes.modo === 'solo' ? al.solicitudes.ids : []
  return [ids.length > 0 ? `responsable_id.eq.${personal.id},solicitud_id.in.(${ids.join(',')})` : `responsable_id.eq.${personal.id}`]
}

/**
 * Bandeja de tareas con carga progresiva. Con estado «pendiente», primero los plazos jurídicos
 * verificados (segmento A) y luego el resto (B), cada uno por vencimiento ascendente (R-42).
 */
export async function bandejaTareas(personal: Personal, f: {
  modo: 'mias' | 'todas'; estado: 'pendiente' | 'hecha' | 'cancelada' | 'todas'; cursor?: string; limite: number
}) {
  let cursor: { seg: 'A' | 'B'; marca: string; id: string } | undefined
  if (f.cursor) {
    const m = FORMATO_CURSOR_TAREAS.exec(f.cursor)
    if (!m) return 'cursor_invalido' as const
    cursor = { seg: m[1] as 'A' | 'B', marca: m[2], id: m[3] }
  }
  const vis = await visibilidadTareas(personal, f.modo)
  const segmentar = f.estado === 'pendiente'

  const consulta = (seg: 'A' | 'B' | 'todo', limite: number, desde?: { marca: string; id: string }, soloContar = false) => {
    let q = supabase
      .from('crm_actividades')
      .select(soloContar ? 'id' : COLUMNAS_ACTIVIDAD, soloContar ? { count: 'exact', head: true } : { count: 'exact' })
      .eq('tipo', 'tarea')
    if (f.estado !== 'todas') q = q.eq('estado_tarea', f.estado)
    if (!recibeJuridicas(personal.rol)) q = q.eq('es_juridica', false)
    const ors = [...vis]
    if (seg === 'A') q = q.eq('es_plazo_juridico', true).not('plazo_verificado_at', 'is', null)
    if (seg === 'B') ors.push('es_plazo_juridico.eq.false,plazo_verificado_at.is.null')
    if (desde) ors.push(`vence_at.gt.${desde.marca},and(vence_at.eq.${desde.marca},id.gt.${desde.id})`)
    q = combinarOr(q, ors)
    if (soloContar) return q
    return q.order('vence_at', { ascending: true }).order('id', { ascending: true }).limit(limite + 1)
  }

  type Pagina = { filas: ActividadFila[]; hayMas: boolean }
  const leer = async (seg: 'A' | 'B' | 'todo', limite: number, desde?: { marca: string; id: string }): Promise<Pagina> => {
    if (limite <= 0) return { filas: [], hayMas: true }
    const { data, error } = await consulta(seg, limite, desde)
    if (error) lanzar('bandeja', error)
    const filas = (data ?? []) as unknown as ActividadFila[]
    return { filas: filas.slice(0, limite), hayMas: filas.length > limite }
  }
  const contar = async (seg: 'A' | 'B' | 'todo') => {
    const { count, error } = await consulta(seg, 0, undefined, true)
    if (error) lanzar('bandeja (conteo)', error)
    return count ?? 0
  }

  let filas: ActividadFila[] = []
  let siguiente: string | null = null
  let total = 0
  if (!segmentar) {
    const p = await leer('todo', f.limite, cursor)
    filas = p.filas
    const u = filas[filas.length - 1]
    siguiente = p.hayMas && u ? `B|${u.vence_at}|${u.id}` : null
    total = await contar('todo')
  } else {
    const [totalA, totalB] = await Promise.all([contar('A'), contar('B')])
    total = totalA + totalB
    if (!cursor || cursor.seg === 'A') {
      const a = await leer('A', f.limite, cursor)
      filas = a.filas
      if (a.hayMas) {
        const u = filas[filas.length - 1]
        siguiente = `A|${u.vence_at}|${u.id}`
      } else if (filas.length >= f.limite) {
        // Página llena solo con A: el siguiente lote empieza por el primer B.
        siguiente = totalB > 0 ? `B|0001-01-01T00:00:00Z|${UUID_NULO}` : null
      } else {
        const b = await leer('B', f.limite - filas.length)
        filas = [...filas, ...b.filas]
        const u = b.filas[b.filas.length - 1]
        siguiente = b.hayMas && u ? `B|${u.vence_at}|${u.id}` : null
      }
    } else {
      const b = await leer('B', f.limite, cursor)
      filas = b.filas
      const u = filas[filas.length - 1]
      siguiente = b.hayMas && u ? `B|${u.vence_at}|${u.id}` : null
    }
  }
  return { items: await presentar(personal, filas), siguienteCursor: siguiente, total }
}

// ─── Escrituras ─────────────────────────────────────────────────────────────

type CasoActividad = { id: string; codigo: string; estado: string; contacto_id: string; reserva_reforzada: boolean }

async function caso(solicitudId: string): Promise<CasoActividad | null> {
  const { data, error } = await supabase
    .from('crm_solicitudes').select('id,codigo,estado,contacto_id,reserva_reforzada').eq('id', solicitudId).maybeSingle()
  if (error) lanzar('caso', error)
  return (data as CasoActividad | null) ?? null
}

/** Valida al responsable de una tarea (activo, ve el caso, nunca asistencia en una tarea jurídica). */
async function validarResponsable(responsableId: string, c: CasoActividad, juridica: boolean): Promise<string | null> {
  const { data } = await supabase.from('crm_personal').select('id,rol,activo').eq('id', responsableId).maybeSingle()
  const ficha = data as { id: string; rol: string; activo: boolean } | null
  if (!ficha || !esRol(ficha.rol)) return 'Elige una persona activa del personal'
  const miembroActivo = await esMiembroActivo(ficha.id, c.id)
  if (!puedeSerResponsable({ rol: ficha.rol, activo: ficha.activo }, { miembroActivo, juridica, casoReservado: c.reserva_reforzada })) {
    return juridica && ficha.rol === 'asistencia'
      ? 'Una tarea jurídica no se asigna a asistencia'
      : 'Esa persona no puede ser responsable de tareas de este caso'
  }
  return null
}

function vencimiento(valor: string | null | undefined): { iso: string } | { error: string } {
  const iso = valor ? localAIso(valor) : null
  if (!iso) return { error: 'Fecha y hora inválidas' }
  if (Date.parse(iso) <= Date.now()) return { error: 'El vencimiento no puede estar en el pasado' }
  return { iso }
}

/** Crea una actividad en un caso. El llamador ya validó con Zod. */
export async function crearActividad(personal: Personal, d: ActividadCrear): Promise<Resultado<{ id: string }>> {
  const nivel = await puedeVerSolicitud(personal, d.solicitud_id)
  if (!nivel) return fallo(jsonError(404, 'No encontrado'))
  const c = await caso(d.solicitud_id)
  if (!c) return fallo(jsonError(404, 'No encontrado'))
  if (c.estado === 'cerrada') return fallo(jsonError(409, 'Caso cerrado — solo lectura'))

  const esTarea = d.tipo === 'tarea'
  const juridica = d.es_juridica || d.es_plazo_juridico
  if (!puedeCrearActividad(personal, nivel, { tipo: d.tipo, es_juridica: d.es_juridica, es_plazo_juridico: d.es_plazo_juridico })) {
    return fallo(jsonError(403, juridica && personal.rol === 'asistencia'
      ? 'Asistencia no registra notas ni plazos jurídicos'
      : 'No tienes permiso para registrar esta actividad'))
  }

  const fila: Record<string, unknown> = {
    contacto_id: c.contacto_id,
    solicitud_id: c.id,
    tipo: d.tipo,
    canal: d.canal ?? null,
    descripcion: d.descripcion,
    resultado: d.resultado ?? null,
    es_juridica: d.es_juridica,
    autor_id: personal.user_id,
  }
  if (esTarea) {
    const v = vencimiento(d.vence_at)
    if ('error' in v) return fallo(jsonError(400, 'Revisa los datos enviados.', { campos: { vence_at: v.error } }))
    const errResp = await validarResponsable(d.responsable_id as string, c, juridica)
    if (errResp) return fallo(jsonError(400, 'Revisa los datos enviados.', { campos: { responsable_id: errResp } }))
    Object.assign(fila, { responsable_id: d.responsable_id, vence_at: v.iso, estado_tarea: 'pendiente', es_plazo_juridico: d.es_plazo_juridico })
  }

  const { data, error } = await supabase.from('crm_actividades').insert(fila).select('id').single()
  if (error) return fallo(respuestaErrorBD('crm/actividades (crear)', error))
  const id = (data as { id: string }).id

  try {
    // Contacto con el cliente: llamada o mensaje (correo = mensaje con canal correo).
    if (d.tipo === 'llamada' || d.tipo === 'mensaje') await marcarPrimeraRespuesta(c.id)
    // R-51: sin el contenido de la actividad.
    await registrar({
      userId: personal.user_id,
      accion: 'crear',
      entidad: 'crm_actividades',
      entidadId: id,
      despues: {
        solicitud_id: c.id, tipo: d.tipo, canal: d.canal ?? null, es_juridica: d.es_juridica,
        ...(esTarea ? { responsable_id: d.responsable_id, vence_at: fila.vence_at, es_plazo_juridico: d.es_plazo_juridico } : {}),
      },
    })
    if (esTarea) await avisarTareaAsignada({ solicitudId: c.id, codigo: c.codigo, responsableId: d.responsable_id as string, actorPersonalId: personal.id })
  } catch (e) {
    console.error('[crm/actividades] efectos posteriores', e instanceof Error ? e.name : 'error')
  }
  return { ok: true, datos: { id } }
}

export type CambioTarea =
  | { accion: 'completar'; resultado?: string | null }
  | { accion: 'cancelar' }
  | { accion: 'verificar_plazo' }
  | { accion: 'reprogramar'; vence_at?: string | null; responsable_id?: string | null }

/** Completar, cancelar, verificar un plazo o reprogramar una tarea. */
export async function actualizarTarea(personal: Personal, id: string, cambio: CambioTarea): Promise<Resultado<{ id: string }>> {
  const { data, error } = await supabase.from('crm_actividades').select(COLUMNAS_ACTIVIDAD).eq('id', id).maybeSingle()
  if (error) return fallo(respuestaErrorBD('crm/actividades (lectura)', error))
  const a = data as unknown as ActividadFila | null
  if (!a) return fallo(jsonError(404, 'No encontrado'))

  // Visibilidad: quien no puede ver la actividad recibe 404 (no 403).
  const nivel = a.solicitud_id
    ? await puedeVerSolicitud(personal, a.solicitud_id)
    : (personal.rol === 'direccion' || personal.rol === 'coordinacion' ? 'completo' : null)
  const modo = cronologiaDe(nivel)
  const propia = a.responsable_id === personal.id || (!!personal.user_id && a.autor_id === personal.user_id)
  if (!modo || (a.es_juridica && !recibeJuridicas(personal.rol)) || (modo === 'propia' && !propia)) {
    return fallo(jsonError(404, 'No encontrado'))
  }
  if (a.tipo !== 'tarea') return fallo(jsonError(422, 'Solo las tareas cambian de estado.'))
  if (a.estado_tarea !== 'pendiente') return fallo(jsonError(409, 'Esta tarea ya no está pendiente.'))

  const c = a.solicitud_id ? await caso(a.solicitud_id) : null
  if (c?.estado === 'cerrada') return fallo(jsonError(409, 'Caso cerrado — solo lectura'))

  const ctx = {
    esResponsable: a.responsable_id === personal.id,
    esTitularActivo: a.solicitud_id ? await esTitularActivo(personal.id, a.solicitud_id) : false,
    esPlazoJuridico: a.es_plazo_juridico,
  }
  if (!puedeActuarSobreTarea(personal, cambio.accion, ctx)) {
    return fallo(jsonError(403, cambio.accion === 'verificar_plazo'
      ? 'Un plazo jurídico solo lo verifica el titular del caso o Dirección'
      : 'No tienes permiso para esta acción'))
  }

  let cambios: Record<string, unknown>
  let accionBitacora: 'actualizar' | 'verificar_plazo' = 'actualizar'
  let nuevoResponsable: string | null = null
  switch (cambio.accion) {
    case 'completar':
      cambios = { estado_tarea: 'hecha', ...(cambio.resultado ? { resultado: cambio.resultado } : {}) }
      break
    case 'cancelar':
      cambios = { estado_tarea: 'cancelada' }
      break
    case 'verificar_plazo':
      if (a.plazo_verificado_at) return fallo(jsonError(409, 'Este plazo ya está verificado.'))
      cambios = { plazo_verificado_por: personal.id }
      accionBitacora = 'verificar_plazo'
      break
    case 'reprogramar': {
      cambios = {}
      const campos: Record<string, string> = {}
      if (cambio.vence_at) {
        const v = vencimiento(cambio.vence_at)
        if ('error' in v) campos.vence_at = v.error
        else cambios.vence_at = v.iso
      }
      if (cambio.responsable_id && cambio.responsable_id !== a.responsable_id) {
        if (!c) campos.responsable_id = 'Esta tarea no pertenece a un caso'
        else {
          const errResp = await validarResponsable(cambio.responsable_id, c, a.es_juridica || a.es_plazo_juridico)
          if (errResp) campos.responsable_id = errResp
          else {
            cambios.responsable_id = cambio.responsable_id
            nuevoResponsable = cambio.responsable_id
          }
        }
      }
      if (Object.keys(campos).length > 0) return fallo(jsonError(400, 'Revisa los datos enviados.', { campos }))
      if (Object.keys(cambios).length === 0) return fallo(jsonError(400, 'No hay cambios que guardar'))
      break
    }
  }

  const { data: act, error: errUpd } = await supabase
    .from('crm_actividades').update(cambios).eq('id', id).eq('estado_tarea', 'pendiente').select('id')
  if (errUpd) return fallo(respuestaErrorBD('crm/actividades (actualizar)', errUpd))
  if (!act || act.length === 0) return fallo(jsonError(409, 'Alguien más modificó esta tarea; recarga.'))

  try {
    const antes: Record<string, unknown> = {}
    const despues: Record<string, unknown> = {}
    for (const k of Object.keys(cambios)) {
      if (k === 'resultado') continue // R-51: sin contenido
      antes[k] = (a as unknown as Record<string, unknown>)[k] ?? null
      despues[k] = cambios[k]
    }
    await registrar({ userId: personal.user_id, accion: accionBitacora, entidad: 'crm_actividades', entidadId: id, antes, despues })
    if (nuevoResponsable && a.solicitud_id) {
      await avisarTareaAsignada({ solicitudId: a.solicitud_id, codigo: c?.codigo ?? null, responsableId: nuevoResponsable, actorPersonalId: personal.id })
    }
  } catch (e) {
    console.error('[crm/actividades] efectos posteriores (tarea)', e instanceof Error ? e.name : 'error')
  }
  return { ok: true, datos: { id } }
}

/**
 * Personas que pueden ser responsables de una tarea del caso (para el selector del formulario).
 * `juridica = true` excluye a asistencia.
 */
export async function responsablesPosibles(solicitudId: string, juridica: boolean): Promise<{ id: string; nombre: string; rol: string }[]> {
  const c = await caso(solicitudId)
  if (!c) return []
  const [{ data: personas, error }, { data: equipo }] = await Promise.all([
    supabase.from('crm_personal').select('id,nombres,apellidos,rol,activo').eq('activo', true).order('nombres', { ascending: true }).limit(500),
    supabase.from('crm_solicitud_equipo').select('personal_id').eq('solicitud_id', solicitudId).eq('estado', 'activo'),
  ])
  if (error) lanzar('responsables', error)
  const activos = new Set(((equipo ?? []) as { personal_id: string }[]).map((e) => e.personal_id))
  return ((personas ?? []) as { id: string; nombres: string; apellidos: string; rol: string; activo: boolean }[])
    .filter((p) => esRol(p.rol) && puedeSerResponsable({ rol: p.rol, activo: p.activo }, { miembroActivo: activos.has(p.id), juridica, casoReservado: c.reserva_reforzada }))
    .map((p) => ({ id: p.id, nombre: `${p.nombres} ${p.apellidos}`, rol: p.rol }))
}

// ─── Entrega 5: conteos de vencimientos para el tablero ─────────────────────

/**
 * Tareas pendientes vencidas y por vencer en 7 días, con la MISMA visibilidad que la bandeja (4.2),
 * aplicada en la consulta. `modo: 'todas'` = las de los casos que la persona ve.
 */
export async function contarVencimientos(personal: Personal, modo: 'mias' | 'todas'): Promise<{ vencidas: number; proximas_7_dias: number }> {
  const vis = await visibilidadTareas(personal, modo)
  const ahora = new Date()
  const en7 = new Date(ahora.getTime() + 7 * 86_400_000).toISOString()
  const base = () => {
    let q = supabase.from('crm_actividades').select('id', { count: 'exact', head: true }).eq('tipo', 'tarea').eq('estado_tarea', 'pendiente')
    if (!recibeJuridicas(personal.rol)) q = q.eq('es_juridica', false)
    return combinarOr(q, vis)
  }
  const [vencidas, proximas] = await Promise.all([
    base().lt('vence_at', ahora.toISOString()),
    base().gte('vence_at', ahora.toISOString()).lt('vence_at', en7),
  ])
  if (vencidas.error) lanzar('conteo vencidas', vencidas.error)
  if (proximas.error) lanzar('conteo próximas', proximas.error)
  return { vencidas: vencidas.count ?? 0, proximas_7_dias: proximas.count ?? 0 }
}

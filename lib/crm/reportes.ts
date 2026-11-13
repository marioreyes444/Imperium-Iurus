// Reportes del CRM (Entrega 5). Solo Dirección y Coordinación (lo decide permisos.ts en la ruta/página).
//
// Cómo se agregan los datos:
//   · Cada bloque se lee con COLUMNAS MÍNIMAS y se agrega en el servidor. Nada se pide «completo».
//   · La visibilidad se aplica EN la consulta (`aplicarAlcance` / `aplicarAlcanceEmbebido`): Coordinación
//     nunca recibe filas de casos reservados ajenos (R-53), ni siquiera para contarlas.
//   · Tope: cada bloque se cuenta primero; si pasa de TOPE_FILAS_REPORTE filas se lanza
//     `ExcedeTopeError` y la ruta responde 422 (nunca se devuelven resultados parciales).
//   · Se lee en tramos de 1000 filas (máximo de una respuesta de PostgREST) con orden estable.
//   · «Responsable» = el ÚLTIMO titular del caso (fila de titular más reciente entre pendiente_confirmacion,
//     activo y finalizado). Se resuelve en el servidor, por lotes de ids, sobre las filas ya filtradas por
//     visibilidad; el tope se aplica antes de este filtro.
import { supabase } from '@/lib/supabase'
import { esTablaAusente } from '@/lib/crm/errores'
import { CrmNoDisponibleError, type Personal } from '@/lib/crm/permisos'
import { alcancesDe, aplicarAlcance, aplicarAlcanceEmbebido, contactosBloqueados } from '@/lib/crm/visibilidad'
import { aplicarFiltroCitas, filtroCitasDe } from '@/lib/crm/citas'
import { feriados } from '@/lib/crm/disponibilidad'
import { evaluarObjetivo, minutosHabilesEntre } from '@/lib/crm/objetivos'
import { obtenerCatalogo } from '@/lib/crm/catalogo'
import { titularesDe } from '@/lib/crm/titulares'
import { TOPE_FILAS_REPORTE } from '@/lib/crm/config'
import { instanteGuayaquil, sumarDias } from '@/lib/crm/fechas'
import type { ReportesQuery } from '@/lib/crm/schemas'

export type FiltrosReporte = ReportesQuery

/** Un bloque de datos superó el tope de filas. La ruta responde 422 con `REPORTE_EXCEDE_TOPE`. */
const LOTE_IDS = 80

export class ExcedeTopeError extends Error {
  constructor(public bloque: string, public total: number, public tope: number) {
    super('EXCEDE_TOPE')
  }
}

// ─── Utilidades puras ───────────────────────────────────────────────────────

/** Minúsculas, sin tildes y con espacios simples: agrupa textos libres que difieren solo en la forma. */
export function normalizarTextoLibre(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
}

export type ConteoTexto = { texto: string; total: number }

/**
 * Agrupa textos libres (motivo de descarte, resultado de cierre) por texto normalizado: los `max` más
 * frecuentes y el resto en «Otros». Muestra el primer texto original visto de cada grupo.
 */
export function agruparTexto(textos: (string | null | undefined)[], max = 20, sinTexto = 'Sin texto indicado'): ConteoTexto[] {
  const grupos = new Map<string, ConteoTexto>()
  for (const bruto of textos) {
    const original = (bruto ?? '').trim()
    const clave = original === '' ? '' : normalizarTextoLibre(original)
    const g = grupos.get(clave)
    if (g) g.total++
    else grupos.set(clave, { texto: clave === '' ? sinTexto : original.slice(0, 160), total: 1 })
  }
  const ordenados = [...grupos.values()].sort((a, b) => b.total - a.total || a.texto.localeCompare(b.texto))
  if (ordenados.length <= max) return ordenados
  const resto = ordenados.slice(max).reduce((s, g) => s + g.total, 0)
  return [...ordenados.slice(0, max), { texto: 'Otros', total: resto }]
}

export type Estadistica = { n: number; mediana: number | null; promedio: number | null }

export function estadistica(valores: number[]): Estadistica {
  if (valores.length === 0) return { n: 0, mediana: null, promedio: null }
  const s = [...valores].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return {
    n: s.length,
    mediana: s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2,
    promedio: s.reduce((a, b) => a + b, 0) / s.length,
  }
}

export type Conteo = { clave: string; total: number }

export function contarPor<T>(items: readonly T[], clave: (t: T) => string | null | undefined, sinClave = 'Sin dato'): Conteo[] {
  const m = new Map<string, number>()
  for (const i of items) {
    const k = clave(i) || sinClave
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].map(([clave, total]) => ({ clave, total })).sort((a, b) => b.total - a.total || a.clave.localeCompare(b.clave))
}

/** Período [desde 00:00, hasta + 1 día 00:00) en hora de Guayaquil, como instantes ISO. */
export function rangoIso(f: Pick<FiltrosReporte, 'desde' | 'hasta'>): { desdeIso: string; hastaIso: string } {
  return {
    desdeIso: instanteGuayaquil(f.desde, '00:00').toISOString(),
    hastaIso: instanteGuayaquil(sumarDias(f.hasta, 1), '00:00').toISOString(),
  }
}

// ─── Lectura con tope ───────────────────────────────────────────────────────

function lanzar(bloque: string, error: { code?: string }): never {
  if (esTablaAusente(error) || error.code === '42703') throw new CrmNoDisponibleError()
  console.error('[crm/reportes]', bloque, error.code)
  throw new Error('CRM_ERROR')
}

/**
 * Cuenta el bloque (con los mismos filtros) y, si cabe en el tope, lo lee en tramos de 1000 filas.
 * `filtrar` aplica los filtros, incluida la visibilidad; `orden` da un orden estable para paginar.
 */
export async function leerConTope<T>(
  bloque: string,
  tabla: string,
  columnas: string,
  filtrar: (q: any) => any,
  orden: string[],
  tope: number = TOPE_FILAS_REPORTE,
): Promise<T[]> {
  const conteo = await filtrar(supabase.from(tabla).select(columnas, { count: 'exact', head: true }))
  if (conteo.error) lanzar(`${bloque} (conteo)`, conteo.error)
  const total: number = conteo.count ?? 0
  if (total > tope) throw new ExcedeTopeError(bloque, total, tope)

  const filas: T[] = []
  for (let desde = 0; desde < total; desde += 1000) {
    let q = filtrar(supabase.from(tabla).select(columnas))
    for (const col of orden) q = q.order(col, { ascending: true })
    const { data, error } = await q.range(desde, Math.min(desde + 999, total - 1))
    if (error) lanzar(bloque, error)
    filas.push(...((data ?? []) as T[]))
  }
  return filas
}

/** Si hay responsable elegido, deja solo las filas cuyo caso tiene a esa persona como último titular. */
async function conResponsable<T extends { solicitud_id: string }>(filas: T[], responsable: string | undefined): Promise<T[]> {
  if (!responsable || filas.length === 0) return filas
  const titulares = await titularesDe(filas.map((f) => f.solicitud_id))
  return filas.filter((f) => titulares.get(f.solicitud_id) === responsable)
}

// ─── Solicitudes recibidas en el período (también las usa la exportación) ───

export const COLUMNAS_SOLICITUD_REPORTE =
  'id,codigo,canal_origen,estado,estado_at,urgencia,area_principal_id,servicio_id,reserva_reforzada,fecha_recepcion,' +
  'primera_respuesta_at,asignada_at,cerrada_at,resultado_cierre,motivo_estado'

export type SolicitudReporte = {
  id: string
  codigo: string
  canal_origen: string
  estado: string
  estado_at: string
  urgencia: string
  area_principal_id: string | null
  servicio_id: string | null
  reserva_reforzada: boolean
  fecha_recepcion: string
  primera_respuesta_at: string | null
  asignada_at: string | null
  cerrada_at: string | null
  resultado_cierre: string | null
  motivo_estado: string | null
}

/**
 * Solicitudes cuya fecha de recepción cae en el período, con los filtros de área y canal y la visibilidad
 * aplicados en la consulta, y luego el responsable. `columnas` permite añadir (p. ej. el contacto embebido).
 */
export async function solicitudesDelPeriodo<T extends SolicitudReporte = SolicitudReporte>(
  personal: Personal,
  f: FiltrosReporte,
  opciones: { columnas?: string; tope?: number; bloque?: string } = {},
): Promise<T[]> {
  const { solicitudes: alcance } = await alcancesDe(personal)
  const { desdeIso, hastaIso } = rangoIso(f)
  const filas = await leerConTope<T & { solicitud_id: string }>(
    opciones.bloque ?? 'solicitudes',
    'crm_solicitudes',
    opciones.columnas ?? COLUMNAS_SOLICITUD_REPORTE,
    (q) => {
      let x = aplicarAlcance(q, alcance).gte('fecha_recepcion', desdeIso).lt('fecha_recepcion', hastaIso)
      if (f.area) x = x.eq('area_principal_id', f.area)
      if (f.canal) x = x.eq('canal_origen', f.canal)
      return x
    },
    ['fecha_recepcion', 'id'],
    opciones.tope,
  )
  // Para el filtro por responsable, `solicitud_id` es el id de la propia solicitud.
  const conId = filas.map((s) => Object.assign(s, { solicitud_id: s.id }))
  return conResponsable(conId, f.responsable) as unknown as Promise<T[]>
}

// ─── El reporte ─────────────────────────────────────────────────────────────

export type FilaPrimeraRespuesta = {
  urgencia: string
  recibidas: number
  con_respuesta: number
  /** Horas hábiles (lunes a viernes 09:00–18:00, sin feriados) hasta la primera respuesta. */
  horas_habiles: Estadistica
  cumplidas: number
  incumplidas: number
  en_curso: number
}

export type Reporte = {
  periodo: { desde: string; hasta: string }
  filtros: { area: string | null; canal: string | null; responsable: string | null }
  solicitudes: {
    total: number
    por_estado: Conteo[]
    por_canal: Conteo[]
    por_urgencia: Conteo[]
    por_area: Conteo[]
  }
  contactos: {
    nuevos: number
    por_canal: Conteo[]
    duplicados: { total: number; por_estado: Conteo[]; por_coincidencia: Conteo[] }
  }
  citas: { total: number; vigentes: number; atendidas: number; no_asistio: number; canceladas: number; pct_asistencia: number | null }
  embudo: { propuestas: number; contrataciones: number }
  primera_respuesta: FilaPrimeraRespuesta[]
  asignacion: { casos: number; horas: Estadistica }
  tareas: { vencidas_pendientes: number; completadas_tarde: number; plazos_juridicos_vencidos: number }
  descartes: { total: number; motivos: ConteoTexto[] }
  cierres: { total: number; por_resultado: ConteoTexto[] }
}

type Transicion = {
  id: number
  solicitud_id: string
  estado_anterior: string | null
  estado_nuevo: string
  motivo: string | null
  created_at: string
}

export async function generarReporte(personal: Personal, f: FiltrosReporte): Promise<Reporte> {
  const al = await alcancesDe(personal)
  const { desdeIso, hastaIso } = rangoIso(f)
  const ahora = new Date()
  const [fer, catalogo] = await Promise.all([feriados(), obtenerCatalogo()])
  const nombreArea = new Map(catalogo.areas.map((a) => [a.id, a.nombre]))

  // Filtros de la solicitud embebida (historial de estados y tareas): área y canal, más la visibilidad.
  const embebido = (q: any) => {
    let x = aplicarAlcanceEmbebido(q, al.solicitudes)
    if (f.area) x = x.eq('crm_solicitudes.area_principal_id', f.area)
    if (f.canal) x = x.eq('crm_solicitudes.canal_origen', f.canal)
    return x
  }

  // 1. Solicitudes recibidas
  const solicitudes = await solicitudesDelPeriodo(personal, f)

  // 2. Primera respuesta y objetivos (R-43)
  const urgencias = ['critica', 'alta', 'media', 'ordinaria']
  const primera: FilaPrimeraRespuesta[] = urgencias.map((u) => {
    const delGrupo = solicitudes.filter((s) => s.urgencia === u)
    let cumplidas = 0, incumplidas = 0, enCurso = 0
    const horas: number[] = []
    for (const s of delGrupo) {
      const recepcion = Date.parse(s.fecha_recepcion)
      const respuesta = s.primera_respuesta_at ? Date.parse(s.primera_respuesta_at) : null
      if (respuesta !== null) horas.push(minutosHabilesEntre(recepcion, respuesta, fer) / 60)
      const ev = evaluarObjetivo({ recepcion, primeraRespuesta: respuesta, urgencia: u }, ahora, fer)
      if (ev?.estado === 'cumplido') cumplidas++
      else if (ev?.estado === 'incumplido') incumplidas++
      else if (ev?.estado === 'en_curso') enCurso++
    }
    return { urgencia: u, recibidas: delGrupo.length, con_respuesta: horas.length, horas_habiles: estadistica(horas), cumplidas, incumplidas, en_curso: enCurso }
  })

  // 3. Contactos nuevos (no aplica área ni responsable: un contacto nace antes de calificarse)
  const contactos = await leerConTope<{ id: string; canal_primer_contacto: string | null }>(
    'contactos nuevos', 'crm_contactos', 'id,canal_primer_contacto',
    (q) => {
      let x = aplicarAlcance(q, al.contactos).gte('created_at', desdeIso).lt('created_at', hastaIso).is('fusionado_en', null)
      if (f.canal) x = x.eq('canal_primer_contacto', f.canal)
      return x
    },
    ['created_at', 'id'],
  )

  // 4. Posibles duplicados creados en el período (sin pares con fichas que la persona no ve)
  const bloqueados = await contactosBloqueados(al.contactos)
  const duplicados = await leerConTope<{ id: string; estado: string; coincidencia: string }>(
    'duplicados', 'crm_posibles_duplicados', 'id,estado,coincidencia',
    (q) => {
      let x = q.gte('created_at', desdeIso).lt('created_at', hastaIso)
      if (bloqueados.length > 0) {
        const lista = `(${bloqueados.join(',')})`
        x = x.not('contacto_a', 'in', lista).not('contacto_b', 'in', lista)
      }
      return x
    },
    ['created_at', 'id'],
  )

  // 5. Citas: consultas agendadas vs. atendidas (fecha de la cita en el período)
  const filtroCitas = await filtroCitasDe(personal)
  const porCaso = !!f.area || !!f.canal
  const citas = await leerConTope<{ id: string; estado: string }>(
    'citas', 'citas', porCaso ? 'id,estado,crm_solicitudes!inner(id)' : 'id,estado',
    (q) => {
      let x = aplicarFiltroCitas(q, filtroCitas).gte('fecha', f.desde).lte('fecha', f.hasta)
      if (f.responsable) x = x.eq('abogado_id', f.responsable)
      if (f.area) x = x.eq('crm_solicitudes.area_principal_id', f.area)
      if (f.canal) x = x.eq('crm_solicitudes.canal_origen', f.canal)
      return x
    },
    ['fecha', 'id'],
  )
  const nCitas = (e: string) => citas.filter((c) => c.estado === e).length
  const atendidas = nCitas('atendida')
  const noAsistio = nCitas('no_asistio')

  // 6. Transiciones de estado dentro del período: propuestas, contrataciones, descartes y asignación
  const transiciones = await conResponsable(
    await leerConTope<Transicion & { crm_solicitudes: unknown }>(
      'historial de estados', 'crm_solicitud_estados',
      'id,solicitud_id,estado_anterior,estado_nuevo,motivo,created_at,crm_solicitudes!inner(id)',
      (q) => embebido(q.gte('created_at', desdeIso).lt('created_at', hastaIso)
        .in('estado_nuevo', ['propuesta_enviada', 'aceptada_pendiente_asignacion', 'descartada', 'en_curso'])),
      ['created_at', 'id'],
    ),
    f.responsable,
  )
  const distintas = (estado: string) => new Set(transiciones.filter((t) => t.estado_nuevo === estado).map((t) => t.solicitud_id)).size
  const descartes = transiciones.filter((t) => t.estado_nuevo === 'descartada')

  // Tiempo de asignación: de la primera entrada a «aceptada_pendiente_asignacion» al titular activo
  // (asignada → en_curso, la confirmación de la persona asignada), con la confirmación dentro del período.
  const confirmaciones = new Map<string, string>()
  for (const t of transiciones) {
    if (t.estado_nuevo === 'en_curso' && t.estado_anterior === 'asignada' && !confirmaciones.has(t.solicitud_id)) {
      confirmaciones.set(t.solicitud_id, t.created_at)
    }
  }
  const inicios = new Map<string, string>()
  const idsConfirmados = [...confirmaciones.keys()]
  for (let i = 0; i < idsConfirmados.length; i += LOTE_IDS * 4) {
    const grupo = idsConfirmados.slice(i, i + LOTE_IDS * 4)
    const lotes: string[][] = []
    for (let j = 0; j < grupo.length; j += LOTE_IDS) lotes.push(grupo.slice(j, j + LOTE_IDS))
    const resultados = await Promise.all(lotes.map((lote) =>
      supabase.from('crm_solicitud_estados').select('solicitud_id,created_at')
        .eq('estado_nuevo', 'aceptada_pendiente_asignacion').in('solicitud_id', lote).limit(1000)))
    for (const r of resultados) {
      if (r.error) lanzar('inicio de asignación', r.error)
      for (const x of (r.data ?? []) as { solicitud_id: string; created_at: string }[]) {
        const previo = inicios.get(x.solicitud_id)
        if (!previo || x.created_at < previo) inicios.set(x.solicitud_id, x.created_at)
      }
    }
  }
  const horasAsignacion: number[] = []
  for (const [id, fin] of confirmaciones) {
    const inicio = inicios.get(id)
    if (inicio && Date.parse(fin) >= Date.parse(inicio)) horasAsignacion.push((Date.parse(fin) - Date.parse(inicio)) / 3_600_000)
  }

  // 7. Cierres del período, por resultado (cerrar no equivale a éxito)
  const cierres = await conResponsable(
    (await leerConTope<{ id: string; resultado_cierre: string | null }>(
      'cierres', 'crm_solicitudes', 'id,resultado_cierre',
      (q) => {
        let x = aplicarAlcance(q, al.solicitudes).gte('cerrada_at', desdeIso).lt('cerrada_at', hastaIso)
        if (f.area) x = x.eq('area_principal_id', f.area)
        if (f.canal) x = x.eq('canal_origen', f.canal)
        return x
      },
      ['cerrada_at', 'id'],
    )).map((c) => ({ ...c, solicitud_id: c.id })),
    f.responsable,
  )

  // 8. Tareas de casos con vencimiento en el período que ya pasó
  const limiteVence = ahora.toISOString() < hastaIso ? ahora.toISOString() : hastaIso
  const tareas = await leerConTope<{ id: string; estado_tarea: string; vence_at: string; completada_at: string | null; es_plazo_juridico: boolean }>(
    'tareas vencidas', 'crm_actividades',
    'id,estado_tarea,vence_at,completada_at,es_plazo_juridico,crm_solicitudes!inner(id)',
    (q) => {
      let x = embebido(q.eq('tipo', 'tarea').neq('estado_tarea', 'cancelada').gte('vence_at', desdeIso).lt('vence_at', limiteVence))
      if (f.responsable) x = x.eq('responsable_id', f.responsable)
      return x
    },
    ['vence_at', 'id'],
  )
  const pendientesVencidas = tareas.filter((t) => t.estado_tarea === 'pendiente')

  return {
    periodo: { desde: f.desde, hasta: f.hasta },
    filtros: { area: f.area ?? null, canal: f.canal ?? null, responsable: f.responsable ?? null },
    solicitudes: {
      total: solicitudes.length,
      por_estado: contarPor(solicitudes, (s) => s.estado),
      por_canal: contarPor(solicitudes, (s) => s.canal_origen),
      por_urgencia: contarPor(solicitudes, (s) => s.urgencia),
      por_area: contarPor(solicitudes, (s) => (s.area_principal_id ? (nombreArea.get(s.area_principal_id) ?? 'Área sin nombre') : null), 'Sin área'),
    },
    contactos: {
      nuevos: contactos.length,
      por_canal: contarPor(contactos, (c) => c.canal_primer_contacto, 'Sin canal'),
      duplicados: {
        total: duplicados.length,
        por_estado: contarPor(duplicados, (d) => d.estado),
        por_coincidencia: contarPor(duplicados, (d) => d.coincidencia),
      },
    },
    citas: {
      total: citas.length,
      vigentes: nCitas('pendiente') + nCitas('confirmada'),
      atendidas,
      no_asistio: noAsistio,
      canceladas: nCitas('cancelada'),
      pct_asistencia: atendidas + noAsistio > 0 ? (atendidas / (atendidas + noAsistio)) * 100 : null,
    },
    embudo: { propuestas: distintas('propuesta_enviada'), contrataciones: distintas('aceptada_pendiente_asignacion') },
    primera_respuesta: primera,
    asignacion: { casos: horasAsignacion.length, horas: estadistica(horasAsignacion) },
    tareas: {
      vencidas_pendientes: pendientesVencidas.length,
      completadas_tarde: tareas.filter((t) => t.estado_tarea === 'hecha' && t.completada_at !== null && t.completada_at > t.vence_at).length,
      plazos_juridicos_vencidos: pendientesVencidas.filter((t) => t.es_plazo_juridico).length,
    },
    descartes: { total: descartes.length, motivos: agruparTexto(descartes.map((d) => d.motivo), 20, 'Sin motivo indicado') },
    cierres: { total: cierres.length, por_resultado: agruparTexto(cierres.map((c) => c.resultado_cierre), 20, 'Sin resultado indicado') },
  }
}

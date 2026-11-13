import { supabase } from '@/lib/supabase'
import { esTablaAusente } from '@/lib/crm/errores'
import { CrmNoDisponibleError, type Personal } from '@/lib/crm/permisos'
import { alcancesDe, aplicarAlcance, type Alcance } from '@/lib/crm/visibilidad'
import { bandejaTareas, contarVencimientos } from '@/lib/crm/actividades'
import { feriados } from '@/lib/crm/disponibilidad'
import { evaluarObjetivo } from '@/lib/crm/objetivos'
import { TOPE_OBJETIVOS_TABLERO } from '@/lib/crm/config'
import { ESTADOS_SOLICITUD } from '@/lib/crm/schemas'

export type Pendiente = {
  id: string
  solicitud_id: string | null
  descripcion: string
  vence_at: string
  es_plazo_juridico: boolean
  plazo_verificado: boolean
}

export type Tablero = {
  contadores: {
    /** null = el rol no ve este dato. */
    nuevas: number | null
    por_validar: number | null
    casos_activos: number
    tareas_pendientes: number
    tareas_vencidas: number
    avisos_sin_leer: number
  }
  pendientes: Pendiente[]
}

/** Cuenta solicitudes con el alcance de visibilidad aplicado EN la consulta (no después). */
async function contarSolicitudes(
  alcance: Alcance,
  filtro: { estados?: string[]; porValidar?: boolean },
): Promise<number> {
  let q = supabase.from('crm_solicitudes').select('id', { count: 'exact', head: true })
  if (filtro.estados) q = q.in('estado', filtro.estados)
  if (filtro.porValidar) q = q.eq('estado', 'nueva').eq('requiere_validacion', true)
  q = aplicarAlcance(q, alcance)

  const { count, error } = await q
  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    console.error('[crm/tablero] contar', error.code)
    return 0
  }
  return count ?? 0
}

/** Versión básica (Entrega 1): pendientes propios y contadores. */
export async function obtenerTablero(personal: Personal): Promise<Tablero> {
  const ahora = new Date().toISOString()
  const veTodo = personal.rol === 'direccion' || personal.rol === 'coordinacion' || personal.rol === 'asistencia'
  const { solicitudes: alcance } = await alcancesDe(personal)

  // Tareas propias. Asistencia nunca recibe actividades jurídicas.
  let qTareas = supabase
    .from('crm_actividades')
    .select('id,solicitud_id,descripcion,vence_at,es_plazo_juridico,plazo_verificado_at')
    .eq('responsable_id', personal.id)
    .eq('tipo', 'tarea')
    .eq('estado_tarea', 'pendiente')
    .order('vence_at', { ascending: true })
    .limit(50)
  if (personal.rol === 'asistencia') qTareas = qTareas.eq('es_juridica', false)

  const { data: tareas, error: errTareas } = await qTareas
  if (errTareas) {
    if (esTablaAusente(errTareas)) throw new CrmNoDisponibleError()
    console.error('[crm/tablero] tareas', errTareas.code)
  }
  const filas = (tareas ?? []) as {
    id: string
    solicitud_id: string | null
    descripcion: string
    vence_at: string
    es_plazo_juridico: boolean
    plazo_verificado_at: string | null
  }[]

  // R-42: un plazo jurídico verificado va antes que la urgencia comercial.
  const ordenadas = [...filas].sort((a, b) => {
    const va = a.plazo_verificado_at ? 0 : 1
    const vb = b.plazo_verificado_at ? 0 : 1
    return va - vb || a.vence_at.localeCompare(b.vence_at)
  })

  let avisos = 0
  if (personal.user_id) {
    const { count, error } = await supabase
      .from('crm_notificaciones')
      .select('id', { count: 'exact', head: true })
      .eq('destinatario_id', personal.user_id)
      .eq('canal', 'panel')
      .is('leida_at', null)
    if (error && !esTablaAusente(error)) console.error('[crm/tablero] avisos', error.code)
    avisos = count ?? 0
  }

  const [nuevas, porValidar, activos] = await Promise.all([
    veTodo ? contarSolicitudes(alcance, { estados: ['nueva'] }) : Promise.resolve(null),
    veTodo ? contarSolicitudes(alcance, { porValidar: true }) : Promise.resolve(null),
    contarSolicitudes(alcance, { estados: ['asignada', 'en_curso', 'en_espera'] }),
  ])

  return {
    contadores: {
      nuevas,
      por_validar: porValidar,
      casos_activos: activos,
      tareas_pendientes: filas.length,
      tareas_vencidas: filas.filter((t) => t.vence_at < ahora).length,
      avisos_sin_leer: avisos,
    },
    pendientes: ordenadas.slice(0, 8).map((t) => ({
      id: t.id,
      solicitud_id: t.solicitud_id,
      descripcion: t.descripcion,
      vence_at: t.vence_at,
      es_plazo_juridico: t.es_plazo_juridico,
      plazo_verificado: t.plazo_verificado_at !== null,
    })),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTREGA 5 — Tablero completo
//   · Dirección y Coordinación: casos por estado, vencimientos, objetivos de primer contacto incumplidos
//     (R-43) y carga por persona contra su capacidad.
//   · Asociado: lo mismo, solo lo suyo (incluida su propia carga).
//   · Asistencia y externo conservan el tablero básico (obtenerTablero).
// El alcance de visibilidad se aplica EN cada consulta: Coordinación nunca cuenta casos reservados ajenos.
// ═══════════════════════════════════════════════════════════════════════════

export type FilaVencimiento = {
  id: string
  solicitud_id: string | null
  codigo: string | null
  descripcion: string
  responsable: string | null
  vence_at: string | null
  es_plazo_juridico: boolean
  plazo_verificado: boolean
}

export type FilaObjetivo = { id: string; codigo: string; urgencia: string; fecha_recepcion: string; vence_at: string }

export type FilaCarga = {
  personal_id: string
  nombre: string
  rol: string
  capacidad_maxima: number | null
  carga_titular: number
  casos_apoyo: number
  tareas_vencidas: number
  tareas_7_dias: number
}

export type TableroCompleto = {
  nivel: 'completo' | 'propio'
  casos_por_estado: { estado: string; total: number }[]
  vencimientos: { vencidas: number; proximas_7_dias: number; lista: FilaVencimiento[] }
  objetivos: {
    /** Solicitudes sin primera respuesta evaluadas (máx. TOPE_OBJETIVOS_TABLERO). */
    evaluadas: number
    /** Había más que el tope: el número exacto no se conoce («500 o más»). */
    tope: boolean
    incumplidos: number
    en_curso: number
    lista: FilaObjetivo[]
  }
  carga: FilaCarga[]
  basico: Tablero
}

async function casosPorEstado(alcance: Alcance): Promise<{ estado: string; total: number }[]> {
  const totales = await Promise.all(ESTADOS_SOLICITUD.map((estado) => contarSolicitudes(alcance, { estados: [estado] })))
  return ESTADOS_SOLICITUD.map((estado, i) => ({ estado, total: totales[i] }))
}

async function objetivosIncumplidos(alcance: Alcance): Promise<TableroCompleto['objetivos']> {
  const q = aplicarAlcance(
    supabase
      .from('crm_solicitudes')
      .select('id,codigo,urgencia,fecha_recepcion')
      .is('primera_respuesta_at', null)
      .neq('estado', 'descartada')
      .order('fecha_recepcion', { ascending: true })
      .limit(TOPE_OBJETIVOS_TABLERO + 1),
    alcance,
  )
  const { data, error } = await q
  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    console.error('[crm/tablero] objetivos', error.code)
    return { evaluadas: 0, tope: false, incumplidos: 0, en_curso: 0, lista: [] }
  }
  const filas = (data ?? []) as { id: string; codigo: string; urgencia: string; fecha_recepcion: string }[]
  const tope = filas.length > TOPE_OBJETIVOS_TABLERO
  const evaluadas = filas.slice(0, TOPE_OBJETIVOS_TABLERO)

  const fer = await feriados()
  const ahora = Date.now()
  const lista: FilaObjetivo[] = []
  let incumplidos = 0
  let enCurso = 0
  for (const f of evaluadas) {
    const ev = evaluarObjetivo({ recepcion: Date.parse(f.fecha_recepcion), primeraRespuesta: null, urgencia: f.urgencia }, ahora, fer)
    if (!ev) continue
    if (ev.estado === 'incumplido') {
      incumplidos++
      if (lista.length < 10) lista.push({ id: f.id, codigo: f.codigo, urgencia: f.urgencia, fecha_recepcion: f.fecha_recepcion, vence_at: ev.vence.toISOString() })
    } else {
      enCurso++
    }
  }
  return { evaluadas: evaluadas.length, tope, incumplidos, en_curso: enCurso, lista }
}

/**
 * Carga desde crm_v_carga_personal tal cual (como en Personal): es solo un número y debe ser la real
 * para que las propuestas de asignación respeten la capacidad. No se muestran ni enlazan los casos que
 * la componen.
 */
async function cargaPorPersona(personal: Personal, nivel: 'completo' | 'propio'): Promise<FilaCarga[]> {
  let q = supabase
    .from('crm_v_carga_personal')
    .select('personal_id,nombre,rol,capacidad_maxima,carga_titular,casos_apoyo,tareas_vencidas,tareas_7_dias')
    .limit(500)
  if (nivel === 'propio') q = q.eq('personal_id', personal.id)
  const { data, error } = await q
  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    console.error('[crm/tablero] carga', error.code)
    return []
  }
  const filas = (data ?? []) as FilaCarga[]
  // Solo quien tiene algo que mostrar: capacidad definida, casos o tareas.
  const utiles = nivel === 'propio'
    ? filas
    : filas.filter((f) => f.capacidad_maxima !== null || f.carga_titular > 0 || f.casos_apoyo > 0 || f.tareas_vencidas > 0 || f.tareas_7_dias > 0)
  const uso = (f: FilaCarga) => (f.capacidad_maxima ? f.carga_titular / f.capacidad_maxima : f.carga_titular > 0 ? 0.001 : 0)
  return utiles.sort((a, b) => uso(b) - uso(a) || b.carga_titular - a.carga_titular || a.nombre.localeCompare(b.nombre))
}

/** Tablero de Dirección y Coordinación (`completo`) o del asociado (`propio`). */
export async function obtenerTableroCompleto(personal: Personal, nivel: 'completo' | 'propio'): Promise<TableroCompleto> {
  const { solicitudes: alcance } = await alcancesDe(personal)

  const [porEstado, venc, bandeja, objetivos, carga, basico] = await Promise.all([
    casosPorEstado(alcance),
    contarVencimientos(personal, 'todas'),
    bandejaTareas(personal, { modo: 'todas', estado: 'pendiente', limite: 10 }),
    objetivosIncumplidos(alcance),
    cargaPorPersona(personal, nivel),
    obtenerTablero(personal),
  ])

  const lista: FilaVencimiento[] = bandeja === 'cursor_invalido' ? [] : bandeja.items.map((t) => ({
    id: t.id,
    solicitud_id: t.solicitud_id,
    codigo: t.codigo,
    descripcion: t.descripcion,
    responsable: t.responsable,
    vence_at: t.vence_at,
    es_plazo_juridico: t.es_plazo_juridico,
    plazo_verificado: t.plazo_verificado_at !== null,
  }))

  return {
    nivel,
    casos_por_estado: porEstado,
    vencimientos: { vencidas: venc.vencidas, proximas_7_dias: venc.proximas_7_dias, lista },
    objetivos,
    carga,
    basico,
  }
}

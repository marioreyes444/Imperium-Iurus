import { supabase } from '@/lib/supabase'
import { esTablaAusente } from '@/lib/crm/errores'
import { CrmNoDisponibleError, type Personal } from '@/lib/crm/permisos'
import { alcancesDe, aplicarAlcance, type Alcance } from '@/lib/crm/visibilidad'

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

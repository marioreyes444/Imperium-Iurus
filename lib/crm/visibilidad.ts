// Visibilidad de solicitudes y contactos (sección 4.2 + decisiones de la Entrega 2).
// Los filtros se aplican EN LA CONSULTA (nunca filtrando después de traer los datos), para que la
// carga progresiva, los conteos, los buscadores y los avisos sean correctos.
import { supabase } from '@/lib/supabase'
import { esTablaAusente } from '@/lib/crm/errores'
import { CrmNoDisponibleError, type Personal } from '@/lib/crm/permisos'

/** UUID que nunca existe: sirve para pedir «ninguna fila» sin romper la sintaxis de `in.()`. */
const UUID_NULO = '00000000-0000-0000-0000-000000000000'

export type Alcance =
  | { modo: 'todo' }
  /** Todo lo no reservado, más lo reservado cuyos ids se indican (el equipo propio). */
  | { modo: 'sin_reservados'; incluir: string[] }
  | { modo: 'solo'; ids: string[] }
  | { modo: 'ninguno' }

// Interfaz mínima de los constructores de consultas de Supabase. Se tipa de forma laxa a propósito:
// los tipos genéricos de postgrest-js son muy profundos y TypeScript se rinde al instanciarlos.
type Filtrable = {
  in: (columna: string, valores: readonly string[]) => any
  eq: (columna: string, valor: boolean) => any
  or: (filtros: string) => any
}

/**
 * Aplica un alcance a una consulta de Supabase. `colId` es la columna que identifica la fila.
 * `extraOr` admite otras condiciones OR (p. ej. el cursor de la paginación): todas se combinan con
 * AND dentro de un único filtro lógico, sin depender de cómo trate PostgREST un `or` repetido.
 */
export function aplicarAlcance<Q>(consulta: Q, alcance: Alcance, colId = 'id', extraOr: string[] = []): Q {
  let q = consulta as unknown as Filtrable
  const ors = [...extraOr]
  switch (alcance.modo) {
    case 'todo':
      break
    case 'sin_reservados':
      if (alcance.incluir.length > 0) ors.push(`reserva_reforzada.eq.false,${colId}.in.(${alcance.incluir.join(',')})`)
      else q = q.eq('reserva_reforzada', false)
      break
    case 'solo':
      q = q.in(colId, alcance.ids.length > 0 ? alcance.ids : [UUID_NULO])
      break
    case 'ninguno':
      q = q.in(colId, [UUID_NULO])
      break
  }
  if (ors.length === 1) q = q.or(ors[0])
  else if (ors.length > 1) q = q.or(`and(${ors.map((e) => `or(${e})`).join(',')})`)
  return q as unknown as Q
}

// ─── Pertenencia al equipo ──────────────────────────────────────────────────

type FilaEquipo = {
  solicitud_id: string
  rol: string
  estado: string
  crm_solicitudes: { estado: string; contacto_id: string; empresa_id: string | null } | null
}

async function membresias(personalId: string): Promise<FilaEquipo[]> {
  const { data, error } = await supabase
    .from('crm_solicitud_equipo')
    .select('solicitud_id,rol,estado,crm_solicitudes(estado,contacto_id,empresa_id)')
    .eq('personal_id', personalId)
    .in('estado', ['activo', 'finalizado'])
  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    console.error('[crm/visibilidad] equipo', error.code)
    return []
  }
  return ((data ?? []) as unknown as (Omit<FilaEquipo, 'crm_solicitudes'> & {
    crm_solicitudes: FilaEquipo['crm_solicitudes'] | NonNullable<FilaEquipo['crm_solicitudes']>[]
  })[]).map((f) => ({
    ...f,
    crm_solicitudes: Array.isArray(f.crm_solicitudes) ? (f.crm_solicitudes[0] ?? null) : f.crm_solicitudes,
  }))
}

export type Alcances = {
  solicitudes: Alcance
  contactos: Alcance
  /** Casos en los que la persona está ACTIVA en el equipo (ids). */
  solicitudesActivas: string[]
  /** Contactos (y empresas) de los casos en los que está activa. */
  contactosActivos: string[]
}

/**
 * Alcances de una persona sobre solicitudes y contactos:
 *   · Dirección: todo.
 *   · Coordinación y asistencia: todo lo no reservado, más lo reservado donde estén ACTIVAS en el equipo.
 *   · Asociado y externo: solo sus casos. Un caso cerrado solo lo ve el titular.
 *   · Contactos: igual, salvo que el externo no accede a ninguno.
 */
export async function alcancesDe(personal: Personal): Promise<Alcances> {
  if (personal.rol === 'direccion') {
    // Se calculan igualmente los casos activos: sirven para decidir si «ver_reservado» aplica.
    const filas = await membresias(personal.id)
    const activas = filas.filter((f) => f.estado === 'activo')
    return {
      solicitudes: { modo: 'todo' },
      contactos: { modo: 'todo' },
      solicitudesActivas: activas.map((f) => f.solicitud_id),
      contactosActivos: contactosDe(activas),
    }
  }

  const filas = await membresias(personal.id)
  const activas = filas.filter((f) => f.estado === 'activo')
  const solicitudesActivas = [...new Set(activas.map((f) => f.solicitud_id))]
  const contactosActivos = contactosDe(activas)

  if (personal.rol === 'coordinacion' || personal.rol === 'asistencia') {
    return {
      solicitudes: { modo: 'sin_reservados', incluir: solicitudesActivas },
      contactos: { modo: 'sin_reservados', incluir: contactosActivos },
      solicitudesActivas,
      contactosActivos,
    }
  }

  // Asociado y externo: casos abiertos donde están activos + casos cerrados donde fueron titulares.
  const visibles = new Set<string>()
  for (const f of filas) {
    const cerrado = f.crm_solicitudes?.estado === 'cerrada'
    if (cerrado) {
      if (f.rol === 'titular') visibles.add(f.solicitud_id)
    } else if (f.estado === 'activo') {
      visibles.add(f.solicitud_id)
    }
  }
  return {
    solicitudes: { modo: 'solo', ids: [...visibles] },
    contactos: personal.rol === 'externo' ? { modo: 'ninguno' } : { modo: 'solo', ids: contactosActivos },
    solicitudesActivas,
    contactosActivos,
  }
}

function contactosDe(filas: FilaEquipo[]): string[] {
  const ids = new Set<string>()
  for (const f of filas) {
    if (f.crm_solicitudes?.contacto_id) ids.add(f.crm_solicitudes.contacto_id)
    if (f.crm_solicitudes?.empresa_id) ids.add(f.crm_solicitudes.empresa_id)
  }
  return [...ids]
}

/**
 * De una lista de contactos, cuáles puede ver la persona (consulta con el alcance aplicado).
 * Sirve para mostrar «Contacto reservado» a quien ve una solicitud pero no su contacto.
 */
export async function contactosVisiblesEntre(ids: string[], alcance: Alcance): Promise<Set<string>> {
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return new Set()
  const consulta = aplicarAlcance(supabase.from('crm_contactos').select('id').in('id', unicos), alcance)
  const { data, error } = await consulta
  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    console.error('[crm/visibilidad] contactos visibles', error.code)
    return new Set()
  }
  return new Set((data ?? []).map((f) => (f as { id: string }).id))
}

/**
 * Contactos RESERVADOS que la persona no puede ver (para excluir los pares de «Duplicados» cuya ficha
 * no pueda ver). Con alcance «todo» no hay ninguno.
 */
export async function contactosBloqueados(alcance: Alcance): Promise<string[]> {
  if (alcance.modo !== 'sin_reservados') return []
  let consulta = supabase.from('crm_contactos').select('id').eq('reserva_reforzada', true).limit(1000)
  if (alcance.incluir.length > 0) consulta = consulta.not('id', 'in', `(${alcance.incluir.join(',')})`)
  const { data, error } = await consulta
  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    console.error('[crm/visibilidad] contactos bloqueados', error.code)
    return []
  }
  return (data ?? []).map((f) => (f as { id: string }).id)
}

// Turnos de abogados fuera de horario (crm_turnos). Entrega 5. R-16: la solicitud crítica avisa al abogado
// de turno vigente (lib/crm/avisos.ts).
//   · Solo personal ACTIVO que sea abogado (la base no lo exige: se valida aquí).
//   · desde < hasta (R-36, también en la base). El fin no puede estar en el pasado.
//   · Se permiten cruces entre PERSONAS distintas (dos abogados de guardia reciben ambos el aviso); se
//     rechaza que la MISMA persona tenga dos turnos que se crucen, de cualquier tipo. La base no lo
//     impone: dos peticiones simultáneas podrían colarse (pendiente: restricción de exclusión en la base).
//   · Solo se borran turnos que no han terminado: los pasados son el historial de a quién se avisó.
import type { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { esTablaAusente, jsonError, respuestaErrorBD } from '@/lib/crm/errores'
import { CrmNoDisponibleError, type Personal } from '@/lib/crm/permisos'
import { registrar } from '@/lib/crm/bitacora'
import { localAIso } from '@/lib/crm/fechas'
import { leerCursor } from '@/lib/crm/paginacion'
import type { z } from 'zod'
import type { turnoCrearSchema, turnosQuerySchema } from '@/lib/crm/schemas'

export const ETIQUETA_TURNO: Record<string, string> = {
  semana: 'Entre semana', fin_de_semana: 'Fin de semana', feriado: 'Feriado',
}

export type TurnoFila = { id: string; personal_id: string; desde: string; hasta: string; tipo: string; created_at: string }
export type TurnoVista = TurnoFila & { persona: string; terminado: boolean; vigente: boolean }

type Resultado<T> = { ok: true; datos: T } | { ok: false; respuesta: NextResponse }
const fallo = <T>(respuesta: NextResponse): Resultado<T> => ({ ok: false, respuesta })

function lanzar(contexto: string, error: { code?: string }): never {
  if (esTablaAusente(error)) throw new CrmNoDisponibleError()
  console.error(`[crm/turnos] ${contexto}`, error.code)
  throw new Error('CRM_ERROR')
}

const COLUMNAS_TURNO = 'id,personal_id,desde,hasta,tipo,created_at'

async function nombres(ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return new Map()
  const { data, error } = await supabase.from('crm_personal').select('id,nombres,apellidos').in('id', unicos)
  if (error) lanzar('nombres', error)
  return new Map(((data ?? []) as { id: string; nombres: string; apellidos: string }[]).map((p) => [p.id, `${p.nombres} ${p.apellidos}`]))
}

/** Listado con carga progresiva, más recientes primero (orden estable por inicio e id). */
export async function listarTurnos(f: z.infer<typeof turnosQuerySchema>): Promise<
  { items: TurnoVista[]; siguienteCursor: string | null; total: number } | 'cursor_invalido'
> {
  const cursor = leerCursor(f.cursor)
  if (cursor === null) return 'cursor_invalido'
  const ahora = new Date().toISOString()

  let q = supabase
    .from('crm_turnos')
    .select(COLUMNAS_TURNO, { count: 'exact' })
    .order('desde', { ascending: false })
    .order('id', { ascending: false })
    .limit(f.limite + 1)
  if (f.vigencia === 'vigentes') q = q.gte('hasta', ahora)
  if (f.vigencia === 'terminados') q = q.lt('hasta', ahora)
  if (f.tipo) q = q.eq('tipo', f.tipo)
  if (f.persona) q = q.eq('personal_id', f.persona)
  if (cursor) q = q.or(`desde.lt.${cursor.marca},and(desde.eq.${cursor.marca},id.lt.${cursor.id})`)

  const { data, error, count } = await q
  if (error) lanzar('listar', error)
  const filas = (data ?? []) as unknown as TurnoFila[]
  const pagina = filas.slice(0, f.limite)
  const ultimo = pagina[pagina.length - 1]
  const porId = await nombres(pagina.map((t) => t.personal_id))
  return {
    items: pagina.map((t) => ({
      ...t,
      persona: porId.get(t.personal_id) ?? '—',
      terminado: t.hasta < ahora,
      vigente: t.desde <= ahora && t.hasta >= ahora,
    })),
    siguienteCursor: filas.length > f.limite && ultimo ? `${ultimo.desde}|${ultimo.id}` : null,
    total: count ?? 0,
  }
}

export async function crearTurno(actor: Personal & { user_id: string | null }, d: z.infer<typeof turnoCrearSchema>): Promise<Resultado<{ id: string }>> {
  const desde = localAIso(d.desde)
  const hasta = localAIso(d.hasta)
  if (!desde || !hasta) return fallo(jsonError(400, 'Revisa los datos enviados.', { campos: { desde: 'Fecha y hora inválidas' } }))
  if (Date.parse(hasta) <= Date.now()) {
    return fallo(jsonError(400, 'Revisa los datos enviados.', { campos: { hasta: 'El turno ya terminó' } }))
  }

  const { data: ficha, error: errFicha } = await supabase
    .from('crm_personal').select('id,activo,es_abogado').eq('id', d.personal_id).maybeSingle()
  if (errFicha) lanzar('ficha', errFicha)
  const abogado = ficha as { id: string; activo: boolean; es_abogado: boolean } | null
  if (!abogado || !abogado.activo || !abogado.es_abogado) {
    return fallo(jsonError(400, 'Revisa los datos enviados.', { campos: { personal_id: 'Elige un abogado activo' } }))
  }

  // La misma persona no puede tener dos turnos que se crucen (los de personas distintas sí pueden).
  const { data: cruces, error: errCruce } = await supabase
    .from('crm_turnos')
    .select('id')
    .eq('personal_id', d.personal_id)
    .lt('desde', hasta)
    .gt('hasta', desde)
    .limit(1)
  if (errCruce) lanzar('cruces', errCruce)
  if ((cruces ?? []).length > 0) {
    return fallo(jsonError(422, 'Esa persona ya tiene un turno que se cruza con ese horario.', { campos: { desde: 'Se cruza con otro turno de la misma persona' } }))
  }

  const { data, error } = await supabase
    .from('crm_turnos')
    .insert({ personal_id: d.personal_id, desde, hasta, tipo: d.tipo, created_by: actor.user_id })
    .select('id')
    .single()
  if (error) return fallo(respuestaErrorBD('admin/crm/turnos POST', error))
  const id = (data as { id: string }).id

  await registrar({
    userId: actor.user_id,
    accion: 'crear',
    entidad: 'crm_turnos',
    entidadId: id,
    despues: { personal_id: d.personal_id, desde, hasta, tipo: d.tipo },
  })
  return { ok: true, datos: { id } }
}

/** Quita un turno que no ha terminado. En la bitácora queda como `actualizar` con `{ eliminado: true }`. */
export async function borrarTurno(actor: Personal & { user_id: string | null }, turnoId: string): Promise<Resultado<{ ok: true }>> {
  const { data, error: errLectura } = await supabase.from('crm_turnos').select(COLUMNAS_TURNO).eq('id', turnoId).maybeSingle()
  if (errLectura) lanzar('lectura', errLectura)
  const turno = data as TurnoFila | null
  if (!turno) return fallo(jsonError(404, 'No encontrado'))
  if (Date.parse(turno.hasta) <= Date.now()) {
    return fallo(jsonError(422, 'Un turno que ya terminó no se borra: queda como historial.'))
  }

  const { error } = await supabase.from('crm_turnos').delete().eq('id', turnoId)
  if (error) return fallo(respuestaErrorBD('admin/crm/turnos DELETE', error))

  await registrar({
    userId: actor.user_id,
    accion: 'actualizar',
    entidad: 'crm_turnos',
    entidadId: turnoId,
    antes: { personal_id: turno.personal_id, desde: turno.desde, hasta: turno.hasta, tipo: turno.tipo },
    detalle: { eliminado: true },
  })
  return { ok: true, datos: { ok: true } }
}

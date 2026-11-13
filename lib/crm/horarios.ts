// Horario semanal (crm_horarios) y bloqueos (crm_bloqueos) de un abogado.
// R-45: un horario o bloqueo que deja citas activas fuera no las cancela: se guarda y se devuelve la lista.
import { supabase } from '@/lib/supabase'
import { esTablaAusente } from '@/lib/crm/errores'
import { CrmNoDisponibleError } from '@/lib/crm/permisos'
import { DURACION_CITA_MIN } from '@/lib/crm/config'
import { diaSemanaIso, fechaYMinutosGuayaquil, instanteGuayaquil, minutosDe } from '@/lib/crm/fechas'
import { ESTADOS_CITA_ACTIVA } from '@/lib/crm/disponibilidad'
import type { FranjaEntrada } from '@/lib/crm/schemas'

export type Franja = { id: string; dia_semana: number; hora_inicio: string; hora_fin: string }
export type Bloqueo = { id: string; desde: string; hasta: string; tipo: string; motivo: string | null; created_at: string }
export type CitaAfectada = { id: string; fecha: string; hora: string; solicitud_id: string | null; codigo: string | null }

export const ETIQUETA_DIA: Record<number, string> = {
  1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo',
}
export const ETIQUETA_BLOQUEO: Record<string, string> = {
  vacaciones: 'Vacaciones', audiencia: 'Audiencia', permiso: 'Permiso', otro: 'Otro',
}

function falla(contexto: string, error: { code?: string }): never {
  if (esTablaAusente(error)) throw new CrmNoDisponibleError()
  console.error(`[crm/horarios] ${contexto}`, error.code)
  throw new Error('CRM_ERROR')
}

export async function franjasDe(personalId: string): Promise<Franja[]> {
  const { data, error } = await supabase
    .from('crm_horarios')
    .select('id,dia_semana,hora_inicio,hora_fin')
    .eq('personal_id', personalId)
    .order('dia_semana', { ascending: true })
    .order('hora_inicio', { ascending: true })
  if (error) falla('franjas', error)
  return ((data ?? []) as Franja[]).map((f) => ({ ...f, hora_inicio: f.hora_inicio.slice(0, 5), hora_fin: f.hora_fin.slice(0, 5) }))
}

export type ResultadoReemplazo =
  | { ok: true; antes: Franja[] }
  | { ok: false; error: { code?: string; message?: string; details?: string | null }; restaurado: boolean }

/**
 * Reemplaza las franjas de la semana. La base no ofrece una función atómica para esto: se borran las
 * franjas y se insertan las nuevas; si la inserción falla, se intenta restaurar las anteriores
 * (best-effort). Pendiente: pedir una función en la base que lo haga en una transacción.
 */
export async function reemplazarFranjas(personalId: string, nuevas: FranjaEntrada[]): Promise<ResultadoReemplazo> {
  const antes = await franjasDe(personalId)

  const { error: errBorrar } = await supabase.from('crm_horarios').delete().eq('personal_id', personalId)
  if (errBorrar) return { ok: false, error: errBorrar, restaurado: true }

  if (nuevas.length > 0) {
    const { error: errInsertar } = await supabase
      .from('crm_horarios')
      .insert(nuevas.map((f) => ({ personal_id: personalId, dia_semana: f.dia_semana, hora_inicio: f.hora_inicio, hora_fin: f.hora_fin })))
    if (errInsertar) {
      let restaurado = antes.length === 0
      if (antes.length > 0) {
        const { error: errRestaurar } = await supabase
          .from('crm_horarios')
          .insert(antes.map((f) => ({ personal_id: personalId, dia_semana: f.dia_semana, hora_inicio: f.hora_inicio, hora_fin: f.hora_fin })))
        restaurado = !errRestaurar
        if (errRestaurar) console.error('[crm/horarios] NO se pudo restaurar el horario anterior', errRestaurar.code)
      }
      return { ok: false, error: errInsertar, restaurado }
    }
  }
  return { ok: true, antes }
}

type CitaActiva = { id: string; fecha: string; hora: string; duracion_min: number | null; solicitud_id: string | null }

/** Citas activas FUTURAS de un abogado (desde ahora). */
async function citasActivasFuturas(personalId: string): Promise<CitaActiva[]> {
  const ahora = fechaYMinutosGuayaquil(new Date())
  const { data, error } = await supabase
    .from('citas')
    .select('id,fecha,hora,duracion_min,solicitud_id')
    .eq('abogado_id', personalId)
    .in('estado', ESTADOS_CITA_ACTIVA)
    .gte('fecha', ahora.fecha)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true })
    .limit(500)
  if (error) falla('citas activas', error)
  return ((data ?? []) as CitaActiva[]).filter((c) => c.fecha > ahora.fecha || minutosDe(c.hora) >= ahora.minutos)
}

async function conCodigos(citas: CitaActiva[]): Promise<CitaAfectada[]> {
  const ids = [...new Set(citas.map((c) => c.solicitud_id).filter((x): x is string => !!x))]
  const codigos = new Map<string, string>()
  if (ids.length > 0) {
    const { data } = await supabase.from('crm_solicitudes').select('id,codigo').in('id', ids)
    for (const s of (data ?? []) as { id: string; codigo: string }[]) codigos.set(s.id, s.codigo)
  }
  return citas.map((c) => ({
    id: c.id, fecha: c.fecha, hora: c.hora.slice(0, 5), solicitud_id: c.solicitud_id,
    codigo: c.solicitud_id ? (codigos.get(c.solicitud_id) ?? null) : null,
  }))
}

/** Citas activas futuras que no caben entero en ninguna franja de su día. */
export async function citasFueraDeHorario(personalId: string, franjas: { dia_semana: number; hora_inicio: string; hora_fin: string }[]): Promise<CitaAfectada[]> {
  const citas = await citasActivasFuturas(personalId)
  const fuera = citas.filter((c) => {
    const ini = minutosDe(c.hora)
    const fin = ini + (c.duracion_min ?? DURACION_CITA_MIN)
    const dia = diaSemanaIso(c.fecha)
    return !franjas.some((f) => f.dia_semana === dia && minutosDe(f.hora_inicio) <= ini && fin <= minutosDe(f.hora_fin))
  })
  return conCodigos(fuera)
}

/** Citas activas del abogado que se cruzan con el período [desde, hasta) (ISO). */
export async function citasEnPeriodo(personalId: string, desdeIso: string, hastaIso: string): Promise<CitaAfectada[]> {
  const desde = Date.parse(desdeIso)
  const hasta = Date.parse(hastaIso)
  const fechaDesde = fechaYMinutosGuayaquil(new Date(desde)).fecha
  const fechaHasta = fechaYMinutosGuayaquil(new Date(hasta)).fecha
  const { data, error } = await supabase
    .from('citas')
    .select('id,fecha,hora,duracion_min,solicitud_id')
    .eq('abogado_id', personalId)
    .in('estado', ESTADOS_CITA_ACTIVA)
    .gte('fecha', fechaDesde)
    .lte('fecha', fechaHasta)
    .order('fecha', { ascending: true })
    .order('hora', { ascending: true })
    .limit(500)
  if (error) falla('citas del período', error)
  const cruzan = ((data ?? []) as CitaActiva[]).filter((c) => {
    const ini = instanteGuayaquil(c.fecha, c.hora).getTime()
    const fin = ini + (c.duracion_min ?? DURACION_CITA_MIN) * 60_000
    return ini < hasta && fin > desde
  })
  return conCodigos(cruzan)
}

/** Bloqueos que se cruzan con [desde, hasta) (ISO), para la vista de agenda. */
export async function bloqueosEnRango(personalId: string, desdeIso: string, hastaIso: string): Promise<Bloqueo[]> {
  const { data, error } = await supabase
    .from('crm_bloqueos')
    .select('id,desde,hasta,tipo,motivo,created_at')
    .eq('personal_id', personalId)
    .lt('desde', hastaIso)
    .gt('hasta', desdeIso)
    .order('desde', { ascending: true })
    .limit(200)
  if (error) falla('bloqueos del rango', error)
  return (data ?? []) as Bloqueo[]
}

/** Abogados activos (para elegir en la agenda y al agendar). */
export async function abogadosActivos(): Promise<{ id: string; nombre: string }[]> {
  const { data, error } = await supabase
    .from('crm_personal')
    .select('id,nombres,apellidos')
    .eq('activo', true)
    .eq('es_abogado', true)
    .order('nombres', { ascending: true })
    .limit(500)
  if (error) falla('abogados', error)
  return ((data ?? []) as { id: string; nombres: string; apellidos: string }[]).map((p) => ({ id: p.id, nombre: `${p.nombres} ${p.apellidos}` }))
}

/** Bloqueos vigentes o futuros (los terminados no se muestran). */
export async function bloqueosDe(personalId: string): Promise<Bloqueo[]> {
  const { data, error } = await supabase
    .from('crm_bloqueos')
    .select('id,desde,hasta,tipo,motivo,created_at')
    .eq('personal_id', personalId)
    .gt('hasta', new Date().toISOString())
    .order('desde', { ascending: true })
    .limit(200)
  if (error) falla('bloqueos', error)
  return (data ?? []) as Bloqueo[]
}

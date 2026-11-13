// Horas libres de un abogado (sección 11.1). Todo en America/Guayaquil (lib/crm/fechas.ts).
//   1. Franjas de crm_horarios de cada día (dia_semana ISO: 1 = lunes … 7 = domingo).
//   2. Inicios cada PASO_DISPONIBILIDAD_MIN cuyo intervalo [inicio, inicio + duración) quepa entero en una franja.
//   3. Se descartan los que se cruzan con un bloqueo o con una cita activa de ese abogado.
//   4. Se descartan los que empiezan antes de ahora + ANTELACION_MINIMA_MIN.
//   5. Por día: { fecha, horas }. Un día con horas vacías se muestra deshabilitado.
//   6. Sin ninguna franja → `configurado: false` (la pantalla lo explica; no muestra un calendario vacío).
// Además (decisión del responsable): los feriados de `configuracion.festivos` se leen —sin modificarla—
// y el día aparece deshabilitado como «Feriado».
// POST citas y el reagendado repiten esta comprobación al guardar; la restricción de la base
// (citas_sin_cruce_abogado) cubre la carrera entre dos personas.
import { supabase } from '@/lib/supabase'
import { esTablaAusente } from '@/lib/crm/errores'
import { CrmNoDisponibleError } from '@/lib/crm/permisos'
import { ANTELACION_MINIMA_MIN, DURACION_CITA_MIN, PASO_DISPONIBILIDAD_MIN } from '@/lib/crm/config'
import {
  diaSemanaIso, esFechaValida, horaDeMinutos, instanteGuayaquil, minutosDe, sumarDias,
} from '@/lib/crm/fechas'

export type MotivoDia = 'feriado' | 'sin_horario' | 'sin_cupo'
export type DiaDisponible = { fecha: string; horas: string[]; motivo?: MotivoDia }
export type Disponibilidad = { configurado: boolean; dias: DiaDisponible[] }

type Franja = { dia_semana: number; hora_inicio: string; hora_fin: string }
type Intervalo = { inicio: number; fin: number } // milisegundos

export const ESTADOS_CITA_ACTIVA = ['pendiente', 'confirmada'] as const

export type ConsultaDisponibilidad = {
  abogadoId: string
  desde: string
  hasta: string
  duracion?: number
  /** Cita que se está reagendando: no cuenta como ocupada. */
  excluirCitaId?: string | null
  /** Para pruebas; por defecto, ahora. */
  ahora?: Date
}

/** Feriados del sitio (`configuracion.festivos = { fechas: ["YYYY-MM-DD"] }`). Solo lectura. Nunca lanza. */
export async function feriados(): Promise<Set<string>> {
  const { data, error } = await supabase.from('configuracion').select('valor').eq('clave', 'festivos').maybeSingle()
  if (error) {
    console.error('[crm/disponibilidad] feriados', error.code)
    return new Set()
  }
  const fechas = (data?.valor as { fechas?: unknown } | null | undefined)?.fechas
  return new Set(Array.isArray(fechas) ? fechas.filter((f): f is string => typeof f === 'string' && esFechaValida(f)) : [])
}

async function franjasDe(abogadoId: string): Promise<Franja[]> {
  const { data, error } = await supabase
    .from('crm_horarios')
    .select('dia_semana,hora_inicio,hora_fin')
    .eq('personal_id', abogadoId)
  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    console.error('[crm/disponibilidad] horarios', error.code)
    throw new Error('CRM_ERROR')
  }
  return (data ?? []) as Franja[]
}

/** Bloqueos y citas activas del abogado en el rango, como intervalos de tiempo. */
async function ocupado(abogadoId: string, desde: string, hasta: string, excluir?: string | null): Promise<Intervalo[]> {
  const inicioRango = instanteGuayaquil(desde, '00:00').toISOString()
  const finRango = instanteGuayaquil(sumarDias(hasta, 1), '00:00').toISOString()

  let qCitas = supabase
    .from('citas')
    .select('id,fecha,hora,duracion_min')
    .eq('abogado_id', abogadoId)
    .in('estado', ESTADOS_CITA_ACTIVA)
    .gte('fecha', desde)
    .lte('fecha', hasta)
  if (excluir) qCitas = qCitas.neq('id', excluir)

  const [bloqueos, citas] = await Promise.all([
    supabase.from('crm_bloqueos').select('desde,hasta').eq('personal_id', abogadoId).lt('desde', finRango).gt('hasta', inicioRango),
    qCitas,
  ])
  for (const r of [bloqueos, citas]) {
    if (r.error) {
      if (esTablaAusente(r.error) || r.error.code === '42703') throw new CrmNoDisponibleError()
      console.error('[crm/disponibilidad] ocupación', r.error.code)
      throw new Error('CRM_ERROR')
    }
  }

  const salida: Intervalo[] = []
  for (const b of (bloqueos.data ?? []) as { desde: string; hasta: string }[]) {
    salida.push({ inicio: Date.parse(b.desde), fin: Date.parse(b.hasta) })
  }
  for (const c of (citas.data ?? []) as { fecha: string; hora: string; duracion_min: number | null }[]) {
    const inicio = instanteGuayaquil(c.fecha, c.hora).getTime()
    salida.push({ inicio, fin: inicio + (c.duracion_min ?? DURACION_CITA_MIN) * 60_000 })
  }
  return salida
}

type Contexto = { franjas: Franja[]; ocupado: Intervalo[]; feriados: Set<string>; limite: number; duracion: number }

/** ¿El intervalo [fecha hora, + duración) es libre? (no exige que la hora caiga en la rejilla de 30 min). */
function evaluar(ctx: Contexto, fecha: string, hora: string): 'ok' | 'feriado' | 'fuera_de_horario' | 'ocupada' | 'antelacion' {
  if (ctx.feriados.has(fecha)) return 'feriado'
  const ini = minutosDe(hora)
  const fin = ini + ctx.duracion
  const dia = diaSemanaIso(fecha)
  const cabe = ctx.franjas.some((f) => f.dia_semana === dia && minutosDe(f.hora_inicio) <= ini && fin <= minutosDe(f.hora_fin))
  if (!cabe) return 'fuera_de_horario'
  const inicio = instanteGuayaquil(fecha, horaDeMinutos(ini)).getTime()
  if (inicio < ctx.limite) return 'antelacion'
  const final = inicio + ctx.duracion * 60_000
  if (ctx.ocupado.some((o) => inicio < o.fin && final > o.inicio)) return 'ocupada'
  return 'ok'
}

function horasDelDia(ctx: Contexto, fecha: string): DiaDisponible {
  if (ctx.feriados.has(fecha)) return { fecha, horas: [], motivo: 'feriado' }
  const dia = diaSemanaIso(fecha)
  const franjas = ctx.franjas.filter((f) => f.dia_semana === dia)
  if (franjas.length === 0) return { fecha, horas: [], motivo: 'sin_horario' }
  const horas = new Set<string>()
  for (const f of franjas) {
    const fin = minutosDe(f.hora_fin)
    for (let t = minutosDe(f.hora_inicio); t + ctx.duracion <= fin; t += PASO_DISPONIBILIDAD_MIN) {
      const hora = horaDeMinutos(t)
      if (evaluar(ctx, fecha, hora) === 'ok') horas.add(hora)
    }
  }
  const lista = [...horas].sort()
  return lista.length > 0 ? { fecha, horas: lista } : { fecha, horas: [], motivo: 'sin_cupo' }
}

async function contexto(c: ConsultaDisponibilidad): Promise<Contexto> {
  const [franjas, ocup, fer] = await Promise.all([
    franjasDe(c.abogadoId),
    ocupado(c.abogadoId, c.desde, c.hasta, c.excluirCitaId),
    feriados(),
  ])
  return {
    franjas,
    ocupado: ocup,
    feriados: fer,
    limite: (c.ahora ?? new Date()).getTime() + ANTELACION_MINIMA_MIN * 60_000,
    duracion: c.duracion ?? DURACION_CITA_MIN,
  }
}

/** Horas libres por día en el rango [desde, hasta]. */
export async function horasLibres(c: ConsultaDisponibilidad): Promise<Disponibilidad> {
  const ctx = await contexto(c)
  if (ctx.franjas.length === 0) return { configurado: false, dias: [] }
  const dias: DiaDisponible[] = []
  for (let f = c.desde; f <= c.hasta; f = sumarDias(f, 1)) dias.push(horasDelDia(ctx, f))
  return { configurado: true, dias }
}

export type Comprobacion =
  | { ok: true }
  | { ok: false; motivo: 'sin_horario' | 'feriado' | 'fuera_de_horario' | 'ocupada' | 'antelacion'; mensaje: string; disponibilidad: Disponibilidad }

const MENSAJE: Record<Exclude<Comprobacion, { ok: true }>['motivo'], string> = {
  sin_horario: 'Este abogado aún no tiene horario configurado',
  feriado: 'Ese día es feriado',
  fuera_de_horario: 'Esa hora está fuera del horario del abogado',
  ocupada: 'Esa hora acaba de ocuparse',
  antelacion: 'Esa hora ya no se puede agendar (se necesita al menos una hora de antelación)',
}

/**
 * Repite la comprobación al guardar. `enRejilla = true` (agendar y reagendar desde el selector) exige
 * además que la hora sea una de las que ofrece el selector; `false` (asignar abogado a una cita que ya
 * tiene fecha y hora, p. ej. una reserva web) solo exige que el intervalo sea libre y esté en horario.
 * Si no es válida, devuelve también las horas libres actualizadas de ese día.
 */
export async function comprobarHora(
  c: Omit<ConsultaDisponibilidad, 'desde' | 'hasta'> & { fecha: string; hora: string; enRejilla: boolean },
): Promise<Comprobacion> {
  const ctx = await contexto({ ...c, desde: c.fecha, hasta: c.fecha })
  const dia = ctx.franjas.length > 0 ? horasDelDia(ctx, c.fecha) : null
  const disponibilidad: Disponibilidad = { configurado: ctx.franjas.length > 0, dias: dia ? [dia] : [] }
  if (!dia) return { ok: false, motivo: 'sin_horario', mensaje: MENSAJE.sin_horario, disponibilidad }

  const r = evaluar(ctx, c.fecha, c.hora)
  if (r !== 'ok') return { ok: false, motivo: r, mensaje: MENSAJE[r], disponibilidad }
  if (c.enRejilla && !dia.horas.includes(c.hora.slice(0, 5))) {
    return { ok: false, motivo: 'fuera_de_horario', mensaje: 'Elige una de las horas disponibles', disponibilidad }
  }
  return { ok: true }
}

/** Horas libres de un día (para el 409 de un cruce detectado por la base). Nunca lanza. */
export async function horasLibresDelDia(abogadoId: string, fecha: string, excluirCitaId?: string | null): Promise<Disponibilidad | null> {
  try {
    return await horasLibres({ abogadoId, desde: fecha, hasta: fecha, excluirCitaId })
  } catch {
    return null
  }
}

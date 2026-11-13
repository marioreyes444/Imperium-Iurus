// Objetivos de primer contacto (R-43). FUNCIONES PURAS: no tocan la base ni leen el reloj por su cuenta,
// para poder probarlas sin Supabase (los feriados y «ahora» llegan como parámetros).
//
//   · Crítica: 60 minutos naturales (corridos; no esperan al horario hábil ni a los feriados).
//   · Alta, media y ordinaria: minutos hábiles dentro de HORARIO_HABIL (supuesto: lunes a viernes
//     09:00–18:00), sin contar los feriados de `configuracion.festivos`.
//   · Una solicitud recibida fuera de horario empieza a contar en el siguiente momento hábil.
//   · Sin `primera_respuesta_at`: incumplida si el plazo ya venció; «en curso» si todavía no.
// Guayaquil no tiene cambio de horario: siempre UTC-5.
import { HORARIO_HABIL, OBJETIVOS_PRIMER_CONTACTO } from '@/lib/crm/config'
import { diaSemanaIso, minutosDe } from '@/lib/crm/fechas'

export type UrgenciaObjetivo = keyof typeof OBJETIVOS_PRIMER_CONTACTO
export type EstadoObjetivo = 'cumplido' | 'incumplido' | 'en_curso'
export type Feriados = ReadonlySet<string>

const MS_MIN = 60_000
const MS_DIA = 86_400_000
const OFFSET_MS = 5 * 60 * MS_MIN
/** Tope de días que recorre el cálculo (protege contra un bucle si la configuración fuera absurda). */
const MAX_DIAS_CALCULO = 1200

const INICIO_HABIL = minutosDe(HORARIO_HABIL.inicio)
const FIN_HABIL = minutosDe(HORARIO_HABIL.fin)

/** Inicio (UTC, ms) del día local de Guayaquil que contiene el instante, y minutos transcurridos en él. */
function dia(ms: number): { inicioMs: number; fecha: string; minutos: number } {
  const local = ms - OFFSET_MS
  const base = Math.floor(local / MS_DIA) * MS_DIA
  return {
    inicioMs: base + OFFSET_MS,
    fecha: new Date(base).toISOString().slice(0, 10),
    minutos: (local - base) / MS_MIN,
  }
}

const siguiente = (inicioMs: number) => inicioMs + MS_DIA

export function esDiaHabil(fecha: string, feriados: Feriados): boolean {
  return (HORARIO_HABIL.dias as readonly number[]).includes(diaSemanaIso(fecha)) && !feriados.has(fecha)
}

/** Minutos hábiles transcurridos entre dos instantes (0 si fin ≤ inicio). */
export function minutosHabilesEntre(inicio: Date | number, fin: Date | number, feriados: Feriados): number {
  const a = +inicio
  const b = +fin
  if (!(b > a)) return 0
  const dFin = dia(b)
  let cursor = dia(a)
  let total = 0
  for (let i = 0; i < MAX_DIAS_CALCULO; i++) {
    if (esDiaHabil(cursor.fecha, feriados)) {
      const desde = cursor.inicioMs === dia(a).inicioMs ? cursor.minutos : 0
      const hasta = cursor.fecha === dFin.fecha ? dFin.minutos : 24 * 60
      total += Math.max(0, Math.min(hasta, FIN_HABIL) - Math.max(desde, INICIO_HABIL))
    }
    if (cursor.fecha === dFin.fecha) break
    cursor = dia(siguiente(cursor.inicioMs))
  }
  return total
}

/** Instante en que se cumplen `minutos` hábiles a partir de `inicio`; null si no se alcanza en MAX_DIAS_CALCULO días. */
export function sumarMinutosHabiles(inicio: Date | number, minutos: number, feriados: Feriados): Date | null {
  const a = +inicio
  if (minutos <= 0) return new Date(a)
  const primero = dia(a)
  let cursor = primero
  let falta = minutos
  for (let i = 0; i < MAX_DIAS_CALCULO; i++) {
    if (esDiaHabil(cursor.fecha, feriados)) {
      const desde = Math.max(INICIO_HABIL, cursor.inicioMs === primero.inicioMs ? cursor.minutos : 0)
      const disponible = Math.max(0, FIN_HABIL - desde)
      if (falta <= disponible) return new Date(cursor.inicioMs + (desde + falta) * MS_MIN)
      falta -= disponible
    }
    cursor = dia(siguiente(cursor.inicioMs))
  }
  return null
}

/** Momento límite del primer contacto para una solicitud recibida en `recepcion`. */
export function venceObjetivo(recepcion: Date | number, urgencia: string, feriados: Feriados): Date | null {
  const objetivo = OBJETIVOS_PRIMER_CONTACTO[urgencia as UrgenciaObjetivo]
  if (!objetivo) return null
  return objetivo.tipo === 'naturales'
    ? new Date(+recepcion + objetivo.minutos * MS_MIN)
    : sumarMinutosHabiles(recepcion, objetivo.minutos, feriados)
}

export type EvaluacionObjetivo = { estado: EstadoObjetivo; vence: Date }

/**
 * Cumplido, incumplido o en curso. Una urgencia desconocida (no debería ocurrir: la base la limita) o un
 * plazo no calculable devuelven null y el llamador no la cuenta.
 */
export function evaluarObjetivo(
  s: { recepcion: Date | number; primeraRespuesta: Date | number | null; urgencia: string },
  ahora: Date | number,
  feriados: Feriados,
): EvaluacionObjetivo | null {
  const vence = venceObjetivo(s.recepcion, s.urgencia, feriados)
  if (!vence) return null
  if (s.primeraRespuesta !== null) {
    return { estado: +s.primeraRespuesta <= +vence ? 'cumplido' : 'incumplido', vence }
  }
  return { estado: +ahora > +vence ? 'incumplido' : 'en_curso', vence }
}

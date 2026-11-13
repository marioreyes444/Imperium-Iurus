import { DESFASE_GUAYAQUIL, ZONA_HORARIA } from '@/lib/crm/config'

/** Componentes de una fecha en America/Guayaquil (siempre con formatToParts). */
export function partesGuayaquil(fecha: Date = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(fecha)
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? ''
  return { anio: get('year'), mes: get('month'), dia: get('day'), hora: get('hour'), minuto: get('minute') }
}

/** Fecha de hoy en Guayaquil como YYYY-MM-DD. */
export function hoyGuayaquil(): string {
  const p = partesGuayaquil()
  return `${p.anio}-${p.mes}-${p.dia}`
}

// ─── Utilidades de la agenda (Entrega 4) ────────────────────────────────────
// Las fechas de calendario (YYYY-MM-DD) y las horas (HH:MM) son siempre hora local de Guayaquil,
// igual que `citas.fecha`/`citas.hora` y `crm_horarios`.

/** Fecha y minutos del día de un instante, en Guayaquil. */
export function fechaYMinutosGuayaquil(instante: Date): { fecha: string; minutos: number } {
  const p = partesGuayaquil(instante)
  return { fecha: `${p.anio}-${p.mes}-${p.dia}`, minutos: Number(p.hora) * 60 + Number(p.minuto) }
}

/** Instante (Date) de una fecha y hora locales de Guayaquil. */
export function instanteGuayaquil(fecha: string, hora: string): Date {
  return new Date(`${fecha}T${hora.slice(0, 5)}:00${DESFASE_GUAYAQUIL}`)
}

/** `YYYY-MM-DDTHH:MM` (campo datetime-local, hora de Guayaquil) → ISO; null si no es válido. */
export function localAIso(valor: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(valor)
  if (!m) return null
  const d = instanteGuayaquil(m[1], m[2])
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** ISO → `YYYY-MM-DDTHH:MM` en Guayaquil (para rellenar un campo datetime-local). */
export function isoALocal(iso: string): string {
  const p = partesGuayaquil(new Date(iso))
  return `${p.anio}-${p.mes}-${p.dia}T${p.hora}:${p.minuto}`
}

/** Día ISO de la semana de una fecha de calendario: 1 = lunes … 7 = domingo. */
export function diaSemanaIso(fecha: string): number {
  const d = new Date(`${fecha}T12:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

/** Suma días a una fecha de calendario. */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Días entre dos fechas de calendario (hasta − desde). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000)
}

/** Lunes de la semana de una fecha. */
export function lunesDe(fecha: string): string {
  return sumarDias(fecha, 1 - diaSemanaIso(fecha))
}

/** `HH:MM[:SS]` → minutos desde las 00:00. */
export function minutosDe(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

/** Minutos desde las 00:00 → `HH:MM`. */
export function horaDeMinutos(minutos: number): string {
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function esFechaValida(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false
  const d = new Date(`${fecha}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha
}

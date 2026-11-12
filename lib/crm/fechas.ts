import { ZONA_HORARIA } from '@/lib/crm/config'

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

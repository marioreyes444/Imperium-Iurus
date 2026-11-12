// Formato de fechas para el CRM. Toda fecha mostrada usa America/Guayaquil.
const ZONA = 'America/Guayaquil'

const fechaHora = new Intl.DateTimeFormat('es-EC', { timeZone: ZONA, dateStyle: 'medium', timeStyle: 'short' })
const soloFecha = new Intl.DateTimeFormat('es-EC', { timeZone: ZONA, dateStyle: 'medium' })

export function formatoFechaHora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : fechaHora.format(d)
}

export function formatoFecha(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : soloFecha.format(d)
}

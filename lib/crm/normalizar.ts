/** Teléfono a E.164. `09XXXXXXXX` → `+5939XXXXXXXX`; fijo `0[2-7]XXXXXXX` → `+593…`. null si no se puede. */
export function normalizarTelefono(entrada: string): string | null {
  const limpio = entrada.replace(/[\s().-]/g, '')
  if (/^09\d{8}$/.test(limpio) || /^0[2-7]\d{7}$/.test(limpio)) return `+593${limpio.slice(1)}`
  if (/^\+[1-9]\d{7,14}$/.test(limpio)) return limpio
  return null
}

export function normalizarCorreo(entrada: string): string {
  return entrada.trim().toLowerCase()
}

/** Minúsculas y sin tildes (igual que la columna `busqueda` del CRM). */
export function normalizarBusqueda(entrada: string): string {
  return entrada.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Prepara texto del usuario para usarlo dentro de un filtro `.or(...)` de PostgREST:
 * quita los caracteres con significado especial (comas, paréntesis, comodines, comillas…).
 */
export function textoParaFiltro(entrada: string): string {
  return normalizarBusqueda(entrada).replace(/[%_,()\\"*:;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

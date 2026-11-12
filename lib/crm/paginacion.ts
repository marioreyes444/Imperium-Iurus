// Carga progresiva: cursor por (fecha de alta, id), orden estable «fecha descendente, id descendente».
const FORMATO = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\|([0-9a-f-]{36})$/i

export type CursorFechaId = { marca: string; id: string }

/** `null` si el cursor no tiene el formato esperado (la ruta responde 400). */
export function leerCursor(cursor: string | undefined): CursorFechaId | null | undefined {
  if (!cursor) return undefined
  const m = FORMATO.exec(cursor)
  return m ? { marca: m[1], id: m[2] } : null
}

/** Condición OR de PostgREST: filas posteriores al cursor en el orden (created_at desc, id desc). */
export function condicionCursor(c: CursorFechaId, columnaFecha = 'created_at'): string {
  return `${columnaFecha}.lt.${c.marca},and(${columnaFecha}.eq.${c.marca},id.lt.${c.id})`
}

export function cursorDe(fila: { created_at: string; id: string }): string {
  return `${fila.created_at}|${fila.id}`
}

/** Respuesta estándar de un listado paginado a partir de `limite + 1` filas pedidas. */
export function paginar<T extends { created_at: string; id: string }>(filas: T[], limite: number, total: number) {
  const hayMas = filas.length > limite
  const items = filas.slice(0, limite)
  const ultimo = items[items.length - 1]
  return { items, siguienteCursor: hayMas && ultimo ? cursorDe(ultimo) : null, total }
}

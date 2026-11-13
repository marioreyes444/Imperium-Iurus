// Constantes del módulo CRM (E6).
export const ZONA_HORARIA = 'America/Guayaquil'
/** Guayaquil no tiene cambio de horario: siempre UTC-5. */
export const DESFASE_GUAYAQUIL = '-05:00'

/** Carga progresiva de listados. */
export const LIMITE_LISTADO = 30
export const LIMITE_LISTADO_MAX = 50

/** Cuenta bloqueada en Auth al desactivar a una persona (≈100 años). */
export const BAN_DESACTIVADO = '876000h'

// ─── Agenda (Entrega 4) ─────────────────────────────────────────────────────

/** R-34: la consulta dura 60 min. El formulario no deja cambiarla por ahora (la base admite 15–480). */
export const DURACION_CITA_MIN = 60
/** 11.1 paso 2: inicios posibles cada 30 min dentro de cada franja. */
export const PASO_DISPONIBILIDAD_MIN = 30
/** 11.1 paso 4: no se ofrece una hora que empiece antes de ahora + 60 min. */
export const ANTELACION_MINIMA_MIN = 60
/** Rango máximo de una consulta de disponibilidad. */
export const MAX_DIAS_DISPONIBILIDAD = 31

/**
 * R-43: horas hábiles para medir los objetivos de atención (supuesto: lunes a viernes 09:00–18:00).
 * No dependen del horario de ningún abogado.
 */
export const HORARIO_HABIL = { dias: [1, 2, 3, 4, 5], inicio: '09:00', fin: '18:00' } as const

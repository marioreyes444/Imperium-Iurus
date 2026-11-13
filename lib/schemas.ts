import { z } from 'zod'

// ─── Formulario de contacto ───────────────────────────────────────────────────

export const contactSchema = z.object({
  nombre: z.string().min(3, 'Nombre requerido (mínimo 3 caracteres)'),
  correo: z.string().email('Correo electrónico inválido'),
  telefono: z.string().min(10, 'Teléfono requerido (mínimo 10 dígitos)'),
  tipoConsulta: z.enum(['personal', 'empresarial', 'funcionario', 'urgencia', 'otro']),
  mensaje: z.string().min(20, 'Describa brevemente su situación (mínimo 20 caracteres)').max(500),
  confidencial: z.boolean(),
})

export type ContactFormData = z.infer<typeof contactSchema>

// ─── Agenda de citas ──────────────────────────────────────────────────────────

export const appointmentSchema = z.object({
  nombre:       z.string().min(3, 'Nombre requerido'),
  correo:       z.string().email('Correo electrónico inválido'),
  telefono:     z.string().min(10, 'Teléfono requerido (mínimo 10 dígitos)'),
  tipoConsulta: z.enum(['personal', 'empresarial', 'urgencia']),
  fecha:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  hora:         z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida'),
  mensaje:      z.string().max(500).optional(),
})

export type AppointmentFormData = z.infer<typeof appointmentSchema>

/**
 * PATCH de estado desde el panel admin: solo `pendiente ↔ confirmada`.
 * Cancelar va por DELETE con motivo y origen (crm_cancelar_cita, R-37); una cita cancelada,
 * atendida o no asistida no vuelve a estar activa (R-38).
 */
export const citaEstadoSchema = z.object({
  estado: z.enum(['pendiente', 'confirmada']),
})

export type CitaEstado = z.infer<typeof citaEstadoSchema>['estado']

/** Cancelación desde el panel admin: motivo (≥ 5 caracteres) y quién cancela (R-37). */
export const citaCancelarSchema = z.object({
  motivo: z.string({ required_error: 'Indica el motivo' }).trim().min(5, 'Mínimo 5 caracteres').max(500, 'Máximo 500 caracteres'),
  origen: z.enum(['cliente', 'estudio', 'abogado'], { errorMap: () => ({ message: 'Indica quién cancela' }) }),
})

// ─── Respuestas de API ────────────────────────────────────────────────────────

export type ApiSuccess<T = null> = { success: true; data: T }
export type ApiError = { success: false; error: string; issues?: Record<string, string[]> }
export type ApiResponse<T = null> = ApiSuccess<T> | ApiError

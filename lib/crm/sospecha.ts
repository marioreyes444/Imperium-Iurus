// Criterios para marcar un envío como «sospechoso» (requiere validación).
//
// Están AQUÍ, aparte de lib/crm/ingesta.ts, para poder cambiarlos sin tocar el resto.
//
// IMPORTANTE: marcar un envío solo pone `requiere_validacion = true` en la solicitud. Nunca bloquea,
// rechaza ni retrasa el envío, y el visitante ve siempre la misma respuesta de siempre.
import { normalizarTelefono } from '@/lib/crm/normalizar'

/** Con este número de enlaces (o más) el envío se marca. */
export const ENLACES_PARA_SOSPECHA = 2

const ENLACE = /(?:https?:\/\/|www\.)\S+/gi

export function contarEnlaces(texto: string): number {
  return (texto.match(ENLACE) ?? []).length
}

export type DatosEnvio = {
  /** Texto libre del visitante (mensaje, descripción…). */
  texto: string
  /** Teléfono tal como lo escribió el visitante, si lo dio. */
  telefono?: string | null
}

/**
 * Reglas vigentes:
 *   1. El texto tiene 2 o más enlaces.
 *   2. El visitante dio un teléfono y no se puede normalizar a E.164.
 */
export function esEnvioSospechoso(envio: DatosEnvio): boolean {
  if (contarEnlaces(envio.texto) >= ENLACES_PARA_SOSPECHA) return true
  const telefono = envio.telefono?.trim()
  if (telefono && normalizarTelefono(telefono) === null) return true
  return false
}

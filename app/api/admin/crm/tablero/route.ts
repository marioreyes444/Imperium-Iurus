import { NextResponse } from 'next/server'
import { autorizarApi, CrmNoDisponibleError, nivelTablero } from '@/lib/crm/permisos'
import { obtenerTablero, obtenerTableroCompleto } from '@/lib/crm/tablero'
import { jsonError } from '@/lib/crm/errores'

/**
 * Tablero. Dirección y Coordinación: completo. Asociado: lo suyo. Asistencia y externo: el básico de la
 * Entrega 1 (pendientes propios y contadores). El nivel lo decide `nivelTablero` (lib/crm/permisos.ts).
 */
export async function GET() {
  const a = await autorizarApi()
  if ('status' in a) return a

  try {
    const nivel = nivelTablero(a.personal.rol)
    if (nivel === 'basico') return NextResponse.json({ nivel, ...(await obtenerTablero(a.personal)) })
    return NextResponse.json(await obtenerTableroCompleto(a.personal, nivel))
  } catch (e) {
    if (e instanceof CrmNoDisponibleError) {
      return jsonError(503, 'El módulo CRM aún no está disponible en este entorno.', { codigo: 'CRM_NO_DISPONIBLE' })
    }
    console.error('[admin/crm/tablero GET]', e instanceof Error ? e.message : 'error')
    return jsonError(502, 'Ocurrió un error inesperado. Inténtalo de nuevo.')
  }
}

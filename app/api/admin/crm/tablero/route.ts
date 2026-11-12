import { NextResponse } from 'next/server'
import { autorizarApi, CrmNoDisponibleError } from '@/lib/crm/permisos'
import { obtenerTablero } from '@/lib/crm/tablero'
import { jsonError } from '@/lib/crm/errores'

/** Tablero básico: pendientes propios y contadores (cada quien lo suyo). */
export async function GET() {
  const a = await autorizarApi()
  if ('status' in a) return a

  try {
    return NextResponse.json(await obtenerTablero(a.personal))
  } catch (e) {
    if (e instanceof CrmNoDisponibleError) {
      return jsonError(503, 'El módulo CRM aún no está disponible en este entorno.', { codigo: 'CRM_NO_DISPONIBLE' })
    }
    console.error('[admin/crm/tablero GET]', e instanceof Error ? e.message : 'error')
    return jsonError(502, 'Ocurrió un error inesperado. Inténtalo de nuevo.')
  }
}

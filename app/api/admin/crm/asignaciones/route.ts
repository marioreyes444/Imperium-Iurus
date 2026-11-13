import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/crm/permisos'
import { respuestaExcepcion } from '@/lib/crm/errores'
import { asignacionesPendientes } from '@/lib/crm/asignacion'

/**
 * Las asignaciones por confirmar DE LA CUENTA que llama (cualquier rol del personal: la fila es suya),
 * con el resumen del caso y SIN datos del contacto.
 */
export async function GET() {
  const a = await autorizarApi()
  if ('status' in a) return a
  try {
    const items = await asignacionesPendientes(a.personal)
    return NextResponse.json({ items, siguienteCursor: null, total: items.length })
  } catch (e) {
    return respuestaExcepcion('admin/crm/asignaciones GET', e)
  }
}

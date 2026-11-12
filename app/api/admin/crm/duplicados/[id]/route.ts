import { type NextRequest, NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaExcepcion } from '@/lib/crm/errores'
import { uuidSchema } from '@/lib/crm/schemas'
import { detalleDuplicado } from '@/lib/crm/detalles'

type Ctx = { params: Promise<{ id: string }> }

const ROLES = ['direccion', 'coordinacion', 'asistencia'] as const

/** Las dos fichas lado a lado, para elegir cuál se conserva. */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(ROLES)
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  try {
    const detalle = await detalleDuplicado(a.personal, id)
    return detalle ? NextResponse.json(detalle) : jsonError(404, 'No encontrado')
  } catch (e) {
    return respuestaExcepcion('admin/crm/duplicados/[id] GET', e)
  }
}

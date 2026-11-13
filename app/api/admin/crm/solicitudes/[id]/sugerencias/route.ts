import { type NextRequest, NextResponse } from 'next/server'
import { autorizarApi, puedeVerSolicitud } from '@/lib/crm/permisos'
import { jsonError, respuestaExcepcion } from '@/lib/crm/errores'
import { uuidSchema } from '@/lib/crm/schemas'
import { sugerenciasPara } from '@/lib/crm/sugerencias'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion', 'coordinacion'])
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  try {
    const nivel = await puedeVerSolicitud(a.personal, id)
    if (!nivel) return jsonError(404, 'No encontrado')
    if (nivel !== 'completo') return jsonError(403, 'No tienes permiso para esta acción')
    return NextResponse.json(await sugerenciasPara(id))
  } catch (e) {
    return respuestaExcepcion('admin/crm/solicitudes/[id]/sugerencias GET', e)
  }
}

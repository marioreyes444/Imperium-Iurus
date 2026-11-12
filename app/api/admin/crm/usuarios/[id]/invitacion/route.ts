import { type NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD } from '@/lib/crm/errores'
import { uuidSchema } from '@/lib/crm/schemas'

type Ctx = { params: Promise<{ id: string }> }

/**
 * PENDIENTE: reenvío de la invitación por correo (ver lib/crm/invitaciones.ts).
 * Por ahora solo valida permisos y existencia, y responde 501.
 */
export async function POST(_request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion'])
  if ('status' in a) return a

  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const { data, error } = await supabase.from('crm_personal').select('id').eq('id', id).maybeSingle()
  if (error) return respuestaErrorBD('admin/crm/usuarios/invitacion POST', error)
  if (!data) return jsonError(404, 'No encontrado')

  return jsonError(501, 'El envío de invitaciones por correo aún no está disponible.', { codigo: 'INVITACION_PENDIENTE' })
}

import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion } from '@/lib/crm/errores'
import { uuidSchema } from '@/lib/crm/schemas'

type Ctx = { params: Promise<{ id: string }> }

/** Marca como leído un aviso propio del panel. Idempotente. */
export async function POST(_request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi()
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  try {
    const { data, error } = await supabase
      .from('crm_notificaciones')
      .select('id,leida_at')
      .eq('id', id)
      .eq('destinatario_id', a.user.id)
      .eq('canal', 'panel')
      .maybeSingle()
    if (error) return respuestaErrorBD('admin/crm/notificaciones/[id]/leida POST', error)
    if (!data) return jsonError(404, 'No encontrado')
    if (!data.leida_at) {
      const { error: errUpd } = await supabase
        .from('crm_notificaciones').update({ leida_at: new Date().toISOString() }).eq('id', id).eq('destinatario_id', a.user.id).is('leida_at', null)
      if (errUpd) return respuestaErrorBD('admin/crm/notificaciones/[id]/leida POST', errUpd)
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return respuestaExcepcion('admin/crm/notificaciones/[id]/leida POST', e)
  }
}

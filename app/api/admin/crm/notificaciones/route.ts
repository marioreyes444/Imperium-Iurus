import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { notificacionesQuerySchema, queryComoObjeto } from '@/lib/crm/schemas'
import { condicionCursor, leerCursor, paginar } from '@/lib/crm/paginacion'

/** Avisos del PANEL de la persona (cada quien, los suyos). */
export async function GET(request: NextRequest) {
  const a = await autorizarApi()
  if ('status' in a) return a

  const parsed = notificacionesQuerySchema.safeParse(queryComoObjeto(request.nextUrl.searchParams))
  if (!parsed.success) return respuestaZod(parsed.error)
  const { leidas, cursor, limite } = parsed.data
  const desde = leerCursor(cursor)
  if (desde === null) return jsonError(400, 'Cursor inválido')

  try {
    let q = supabase
      .from('crm_notificaciones')
      .select('id,tipo,titulo,url,solicitud_id,cita_id,leida_at,created_at', { count: 'exact' })
      .eq('destinatario_id', a.user.id)
      .eq('canal', 'panel')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limite + 1)
    if (leidas === 'false') q = q.is('leida_at', null)
    if (leidas === 'true') q = q.not('leida_at', 'is', null)
    if (desde) q = q.or(condicionCursor(desde))

    const { data, error, count } = await q
    if (error) return respuestaErrorBD('admin/crm/notificaciones GET', error)
    type Fila = { id: string; tipo: string; titulo: string; url: string | null; solicitud_id: string | null; cita_id: string | null; leida_at: string | null; created_at: string }
    return NextResponse.json(paginar((data ?? []) as Fila[], limite, count ?? 0))
  } catch (e) {
    return respuestaExcepcion('admin/crm/notificaciones GET', e)
  }
}

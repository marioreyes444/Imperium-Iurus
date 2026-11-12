import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { duplicadoDescartarSchema, uuidSchema } from '@/lib/crm/schemas'
import { alcancesDe, contactosVisiblesEntre } from '@/lib/crm/visibilidad'
import { obtenerPar } from '@/lib/crm/duplicados'
import { registrar } from '@/lib/crm/bitacora'

type Ctx = { params: Promise<{ id: string }> }

/** Descarta un posible duplicado: las dos fichas son personas distintas (Dirección y coordinación). */
export async function POST(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion', 'coordinacion'])
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = duplicadoDescartarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)

  try {
    const { par, error } = await obtenerPar(id)
    if (error) return respuestaErrorBD('admin/crm/duplicados/[id]/descartar (lectura)', error)
    if (!par) return jsonError(404, 'No encontrado')

    const al = await alcancesDe(a.personal)
    const visibles = await contactosVisiblesEntre([par.contacto_a, par.contacto_b], al.contactos)
    if (visibles.size !== 2) return jsonError(404, 'No encontrado')

    // Solo si sigue pendiente (otra persona pudo resolverlo).
    const { data, error: errUpd } = await supabase
      .from('crm_posibles_duplicados')
      .update({ estado: 'descartado', resuelto_por: a.user.id, resuelto_at: new Date().toISOString() })
      .eq('id', id)
      .eq('estado', 'pendiente')
      .select('id')
    if (errUpd) return respuestaErrorBD('admin/crm/duplicados/[id]/descartar', errUpd)
    if (!data || data.length === 0) return jsonError(409, 'Este par ya fue resuelto; recarga.')

    await registrar({
      userId: a.user.id, accion: 'descartar_duplicado', entidad: 'crm_posibles_duplicados', entidadId: id,
      motivo: parsed.data.motivo, detalle: { contacto_a: par.contacto_a, contacto_b: par.contacto_b },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return respuestaExcepcion('admin/crm/duplicados/[id]/descartar', e)
  }
}

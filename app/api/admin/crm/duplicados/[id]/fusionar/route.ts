import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { duplicadoFusionarSchema, uuidSchema } from '@/lib/crm/schemas'
import { alcancesDe, contactosVisiblesEntre } from '@/lib/crm/visibilidad'
import { obtenerPar } from '@/lib/crm/duplicados'
import { recalcularEtapa } from '@/lib/crm/etapas'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Fusiona las dos fichas de un par (Dirección y coordinación). Recibe cuál se conserva. Nunca es
 * automático (R-05). La función de la base mueve solicitudes y actividades, deja la otra ficha como
 * fusionada y escribe su propio registro en la bitácora: no se duplica aquí.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion', 'coordinacion'])
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = duplicadoFusionarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const { conserva, motivo } = parsed.data

  try {
    const { par, error } = await obtenerPar(id)
    if (error) return respuestaErrorBD('admin/crm/duplicados/[id]/fusionar (lectura)', error)
    if (!par) return jsonError(404, 'No encontrado')

    const al = await alcancesDe(a.personal)
    const visibles = await contactosVisiblesEntre([par.contacto_a, par.contacto_b], al.contactos)
    if (visibles.size !== 2) return jsonError(404, 'No encontrado')

    if (par.estado !== 'pendiente') return jsonError(409, 'Este par ya fue resuelto; recarga.')
    if (conserva !== par.contacto_a && conserva !== par.contacto_b) {
      return jsonError(400, 'Revisa los datos enviados.', { campos: { conserva: 'Elige una de las dos fichas del par' } })
    }
    const fusionada = conserva === par.contacto_a ? par.contacto_b : par.contacto_a

    const { error: errRpc } = await supabase.rpc('crm_fusionar_contactos', {
      p_conserva: conserva,
      p_fusionada: fusionada,
      p_usuario: a.user.id,
      p_motivo: motivo ?? null,
    })
    if (errRpc) return respuestaErrorBD('admin/crm/duplicados/[id]/fusionar', errRpc)

    // La ficha que sobrevive pudo recibir solicitudes: se recalcula su etapa (best-effort).
    await recalcularEtapa(conserva)

    return NextResponse.json({ ok: true, conserva, fusionada })
  } catch (e) {
    return respuestaExcepcion('admin/crm/duplicados/[id]/fusionar', e)
  }
}

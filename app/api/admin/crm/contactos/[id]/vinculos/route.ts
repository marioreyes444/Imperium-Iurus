import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { uuidSchema, vinculoBorrarSchema, vinculoSchema } from '@/lib/crm/schemas'
import { alcancesDe, contactosVisiblesEntre } from '@/lib/crm/visibilidad'
import { registrar } from '@/lib/crm/bitacora'

type Ctx = { params: Promise<{ id: string }> }

const ROLES = ['direccion', 'coordinacion', 'asistencia'] as const

/** Ambas fichas deben existir, ser vigentes y ser visibles para quien actúa. */
async function fichasVisibles(personal: Parameters<typeof alcancesDe>[0], empresaId: string, personaId: string) {
  const al = await alcancesDe(personal)
  const visibles = await contactosVisiblesEntre([empresaId, personaId], al.contactos)
  return visibles.has(empresaId) && visibles.has(personaId)
}

/** R-07: vincula una persona de contacto con una empresa. `[id]` es una de las dos fichas. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(ROLES)
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = vinculoSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data
  if (id !== d.empresa_id && id !== d.persona_id) return jsonError(400, 'La ficha no forma parte del vínculo.')

  try {
    if (!(await fichasVisibles(a.personal, d.empresa_id, d.persona_id))) return jsonError(404, 'No encontrado')

    const { error } = await supabase.from('crm_contacto_vinculos').insert({
      empresa_id: d.empresa_id,
      persona_id: d.persona_id,
      cargo: d.cargo ?? null,
      es_representante_legal: d.es_representante_legal ?? false,
      documento_representacion: d.documento_representacion ?? null,
    })
    if (error) {
      if (error.code === '23505') return jsonError(409, 'Esa persona ya está vinculada con la empresa.')
      return respuestaErrorBD('admin/crm/contactos/[id]/vinculos POST', error)
    }
    await registrar({
      userId: a.user.id, accion: 'actualizar', entidad: 'crm_contactos', entidadId: d.empresa_id,
      despues: { vinculo_persona: d.persona_id, es_representante_legal: d.es_representante_legal ?? false },
    })
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (e) {
    return respuestaExcepcion('admin/crm/contactos/[id]/vinculos POST', e)
  }
}

/** Quita un vínculo (no se borra ninguna ficha). El cuerpo lleva `empresa_id` y `persona_id`. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(ROLES)
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = vinculoBorrarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data
  if (id !== d.empresa_id && id !== d.persona_id) return jsonError(400, 'La ficha no forma parte del vínculo.')

  try {
    if (!(await fichasVisibles(a.personal, d.empresa_id, d.persona_id))) return jsonError(404, 'No encontrado')

    const { data, error } = await supabase
      .from('crm_contacto_vinculos')
      .delete()
      .eq('empresa_id', d.empresa_id)
      .eq('persona_id', d.persona_id)
      .select('empresa_id')
    if (error) return respuestaErrorBD('admin/crm/contactos/[id]/vinculos DELETE', error)
    if (!data || data.length === 0) return jsonError(404, 'No encontrado')

    await registrar({
      userId: a.user.id, accion: 'actualizar', entidad: 'crm_contactos', entidadId: d.empresa_id,
      antes: { vinculo_persona: d.persona_id },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return respuestaExcepcion('admin/crm/contactos/[id]/vinculos DELETE', e)
  }
}

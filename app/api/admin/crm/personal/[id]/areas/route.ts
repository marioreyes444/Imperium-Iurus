import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { personalAreasSchema, uuidSchema } from '@/lib/crm/schemas'
import { registrar } from '@/lib/crm/bitacora'
import { areasDe, obtenerFicha, type AreaReferencia } from '@/lib/crm/personal'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Reemplaza las áreas de referencia de una persona (R-28). PostgREST no ofrece transacciones y no se
 * crean funciones nuevas en la base, así que NO es atómico: se valida todo antes, se quitan primero las
 * áreas que salen, se degrada lo que deja de ser titular o suplente antes de ascender a otra persona, y
 * se devuelve siempre el estado real final (también en caso de error, para que la pantalla se corrija).
 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion', 'coordinacion'])
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = personalAreasSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const deseadas = parsed.data.areas

  try {
    const ficha = await obtenerFicha(id)
    if (!ficha) return jsonError(404, 'No encontrado')
    if (!ficha.activo || !ficha.es_abogado) {
      return jsonError(422, 'Solo un abogado activo puede vincularse a un área.', { codigo: 'R-28' })
    }

    // Las áreas deben existir y estar activas en el catálogo E5.
    if (deseadas.length > 0) {
      const { data: validas, error: errCat } = await supabase
        .from('areas_practica').select('id').eq('activo', true).in('id', deseadas.map((x) => x.area_id))
      if (errCat) return respuestaErrorBD('admin/crm/personal/[id]/areas PUT (catálogo)', errCat)
      const ok = new Set(((validas ?? []) as { id: string }[]).map((v) => v.id))
      const mala = deseadas.find((x) => !ok.has(x.area_id))
      if (mala) return jsonError(422, 'Hay un área que no existe o no está activa.', { campos: { areas: 'Área no válida' } })
    }

    const previas = await areasDe(id)
    const deseadasPorArea = new Map(deseadas.map((x) => [x.area_id, x]))

    // 1) Quita las áreas que ya no están.
    const aQuitar = previas.filter((p) => !deseadasPorArea.has(p.area_id)).map((p) => p.area_id)
    if (aQuitar.length > 0) {
      const { error } = await supabase.from('crm_personal_areas').delete().eq('personal_id', id).in('area_id', aQuitar)
      if (error) return await conEstado(id, respuestaErrorBD('admin/crm/personal/[id]/areas PUT (quitar)', error))
    }

    // 2) Primero lo que se degrada (titular o suplente → miembro), para liberar el cupo de referencia.
    const previasPorArea = new Map(previas.map((p) => [p.area_id, p]))
    const orden = [...deseadas].sort((x, y) => {
      const rango = (v: typeof x) => (v.rol_referencia === 'miembro' ? 0 : 1)
      return rango(x) - rango(y)
    })
    for (const d of orden) {
      const previa = previasPorArea.get(d.area_id)
      const competencia = d.competencia_acreditada ?? previa?.competencia_acreditada ?? false
      if (previa && previa.rol_referencia === d.rol_referencia && previa.competencia_acreditada === competencia) continue
      const fila = { personal_id: id, area_id: d.area_id, rol_referencia: d.rol_referencia, competencia_acreditada: competencia }
      const { error } = previa
        ? await supabase.from('crm_personal_areas').update(fila).eq('personal_id', id).eq('area_id', d.area_id)
        : await supabase.from('crm_personal_areas').insert(fila)
      if (error) return await conEstado(id, respuestaErrorBD('admin/crm/personal/[id]/areas PUT (guardar)', error))
    }

    const finales = await areasDe(id)
    await registrar({
      userId: a.user.id, accion: 'actualizar', entidad: 'crm_personal', entidadId: id,
      antes: { areas: previas }, despues: { areas: finales }, detalle: { campo: 'areas_referencia' },
    })
    return NextResponse.json({ areas: finales })
  } catch (e) {
    return respuestaExcepcion('admin/crm/personal/[id]/areas PUT', e)
  }
}

/** Añade el estado real de las áreas a una respuesta de error, para que la pantalla se corrija. */
async function conEstado(id: string, respuesta: NextResponse): Promise<NextResponse> {
  const cuerpo = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>
  const areas: AreaReferencia[] = await areasDe(id)
  return NextResponse.json({ ...cuerpo, datos: { areas } }, { status: respuesta.status })
}

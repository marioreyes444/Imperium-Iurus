import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi, puedeEditarHorario } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { disponibilidadQuerySchema, queryComoObjeto } from '@/lib/crm/schemas'
import { horasLibres } from '@/lib/crm/disponibilidad'
import { diasEntre, esFechaValida } from '@/lib/crm/fechas'
import { MAX_DIAS_DISPONIBILIDAD } from '@/lib/crm/config'

/** Horas libres de un abogado (sección 11.1). Para quien puede agendar. */
export async function GET(request: NextRequest) {
  const a = await autorizarApi(['direccion', 'coordinacion', 'asistencia', 'asociado'])
  if ('status' in a) return a

  const parsed = disponibilidadQuerySchema.safeParse(queryComoObjeto(request.nextUrl.searchParams))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data
  if (!esFechaValida(d.desde) || !esFechaValida(d.hasta)) return jsonError(400, 'Revisa los datos enviados.', { campos: { desde: 'Fecha inválida' } })
  if (diasEntre(d.desde, d.hasta) + 1 > MAX_DIAS_DISPONIBILIDAD) {
    return jsonError(400, 'Revisa los datos enviados.', { campos: { hasta: `Máximo ${MAX_DIAS_DISPONIBILIDAD} días` } })
  }

  try {
    const { data: abogado, error } = await supabase
      .from('crm_personal').select('id').eq('id', d.abogado_id).eq('activo', true).eq('es_abogado', true).maybeSingle()
    if (error) return respuestaErrorBD('admin/crm/disponibilidad GET', error)
    if (!abogado) return jsonError(404, 'No encontrado')

    const r = await horasLibres({ abogadoId: d.abogado_id, desde: d.desde, hasta: d.hasta, duracion: d.duracion, excluirCitaId: d.excluir })
    return NextResponse.json({
      ...r,
      // 11.1 paso 6: solo a Dirección se le ofrece el enlace a la pantalla de horario.
      horario_url: !r.configurado && puedeEditarHorario(a.personal) ? `/admin/crm/personal/${d.abogado_id}/horario` : null,
    })
  } catch (e) {
    return respuestaExcepcion('admin/crm/disponibilidad GET', e)
  }
}

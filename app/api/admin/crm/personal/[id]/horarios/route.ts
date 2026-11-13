import { type NextRequest, NextResponse } from 'next/server'
import { autorizarApi, puedeEditarHorario, puedeVerHorario } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { horariosSchema, uuidSchema } from '@/lib/crm/schemas'
import { obtenerFicha } from '@/lib/crm/personal'
import { citasFueraDeHorario, franjasDe, reemplazarFranjas } from '@/lib/crm/horarios'
import { registrar } from '@/lib/crm/bitacora'

type Ctx = { params: Promise<{ id: string }> }

/** Horario semanal de un abogado. Solo lectura para todos menos Dirección. */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi()
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success || !puedeVerHorario(a.personal, id)) return jsonError(404, 'No encontrado')

  try {
    const ficha = await obtenerFicha(id)
    if (!ficha) return jsonError(404, 'No encontrado')
    return NextResponse.json({
      es_abogado: ficha.es_abogado,
      editable: puedeEditarHorario(a.personal),
      franjas: ficha.es_abogado ? await franjasDe(id) : [],
    })
  } catch (e) {
    return respuestaExcepcion('admin/crm/personal/[id]/horarios GET', e)
  }
}

/**
 * Reemplaza las franjas de la semana (solo Dirección). Si el cambio deja citas activas fuera del horario,
 * se guarda igual y se devuelve la lista para reagendarlas (como R-45).
 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion'])
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = horariosSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const { franjas } = parsed.data

  try {
    const ficha = await obtenerFicha(id)
    if (!ficha) return jsonError(404, 'No encontrado')
    if (!ficha.es_abogado) return jsonError(422, 'Solo los abogados tienen horario de citas.')
    if (!ficha.activo) return jsonError(422, 'La persona está inactiva.')

    const r = await reemplazarFranjas(id, franjas)
    if (!r.ok) {
      if (!r.restaurado) console.error('[admin/crm/personal/[id]/horarios PUT] el horario anterior no pudo restaurarse')
      const base = respuestaErrorBD('admin/crm/personal/[id]/horarios PUT', r.error)
      if (r.restaurado) return base
      return jsonError(502, 'No se pudo guardar el horario y el anterior no pudo restaurarse. Vuelve a guardarlo.', { codigo: 'HORARIO_NO_RESTAURADO' })
    }

    const actuales = await franjasDe(id)
    const citasFuera = await citasFueraDeHorario(id, actuales)
    await registrar({
      userId: a.user.id,
      accion: 'actualizar',
      entidad: 'crm_horarios',
      entidadId: id,
      antes: { franjas: r.antes.map(({ dia_semana, hora_inicio, hora_fin }) => ({ dia_semana, hora_inicio, hora_fin })) },
      despues: { franjas: actuales.map(({ dia_semana, hora_inicio, hora_fin }) => ({ dia_semana, hora_inicio, hora_fin })) },
      detalle: citasFuera.length > 0 ? { citas_fuera_de_horario: citasFuera.length } : null,
    })
    return NextResponse.json({ franjas: actuales, citas_fuera: citasFuera })
  } catch (e) {
    return respuestaExcepcion('admin/crm/personal/[id]/horarios PUT', e)
  }
}

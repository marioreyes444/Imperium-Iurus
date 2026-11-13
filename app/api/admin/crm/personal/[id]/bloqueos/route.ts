import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import {
  autorizarApi, esDireccion, puedeGestionarBloqueos, puedeVerHorario, puedeVerSolicitud, type Personal,
} from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { bloqueoBorrarSchema, bloqueoCrearSchema, uuidSchema } from '@/lib/crm/schemas'
import { obtenerFicha } from '@/lib/crm/personal'
import { bloqueosDe, citasEnPeriodo, type CitaAfectada } from '@/lib/crm/horarios'
import { localAIso } from '@/lib/crm/fechas'
import { registrar } from '@/lib/crm/bitacora'
import { avisarBloqueoConCitas } from '@/lib/crm/avisos'

type Ctx = { params: Promise<{ id: string }> }

/** R-53: de las citas afectadas, quien no ve el caso no recibe su código. */
async function paraPersona(personal: Personal, citas: CitaAfectada[]) {
  if (esDireccion(personal.rol)) return citas.map((c) => ({ ...c, reservada: false }))
  return Promise.all(citas.map(async (c) => {
    if (!c.solicitud_id) return { ...c, reservada: false }
    const nivel = await puedeVerSolicitud(personal, c.solicitud_id)
    return nivel === 'completo' || nivel === 'sin_juridico'
      ? { ...c, reservada: false }
      : { ...c, solicitud_id: null, codigo: null, reservada: true }
  }))
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi()
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success || !puedeVerHorario(a.personal, id)) return jsonError(404, 'No encontrado')
  try {
    return NextResponse.json({ items: await bloqueosDe(id), editable: puedeGestionarBloqueos(a.personal, id) })
  } catch (e) {
    return respuestaExcepcion('admin/crm/personal/[id]/bloqueos GET', e)
  }
}

/**
 * Crea un bloqueo (ausencia). R-45: si hay citas activas en ese período no se cancelan solas: se guarda
 * y se devuelve la lista para reagendarlas o reasignarlas. Aviso a Dirección y Coordinación.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi()
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success || !puedeVerHorario(a.personal, id)) return jsonError(404, 'No encontrado')
  if (!puedeGestionarBloqueos(a.personal, id)) return jsonError(403, 'No tienes permiso para esta acción')

  const parsed = bloqueoCrearSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data
  const desde = localAIso(d.desde)
  const hasta = localAIso(d.hasta)
  if (!desde || !hasta) return jsonError(400, 'Revisa los datos enviados.', { campos: { desde: 'Fecha y hora inválidas' } })
  if (Date.parse(hasta) <= Date.now()) return jsonError(400, 'Revisa los datos enviados.', { campos: { hasta: 'El bloqueo ya terminó' } })

  try {
    const ficha = await obtenerFicha(id)
    if (!ficha) return jsonError(404, 'No encontrado')

    const { data, error } = await supabase
      .from('crm_bloqueos')
      .insert({ personal_id: id, desde, hasta, tipo: d.tipo, motivo: d.motivo ?? null, created_by: a.user.id })
      .select('id')
      .single()
    if (error) return respuestaErrorBD('admin/crm/personal/[id]/bloqueos POST', error)
    const bloqueoId = (data as { id: string }).id

    const afectadas = await citasEnPeriodo(id, desde, hasta)
    await registrar({
      userId: a.user.id,
      accion: 'crear',
      entidad: 'crm_bloqueos',
      entidadId: bloqueoId,
      despues: { personal_id: id, desde, hasta, tipo: d.tipo },
      detalle: afectadas.length > 0 ? { citas_afectadas: afectadas.length } : null,
    })
    await avisarBloqueoConCitas({ personalId: id, cantidad: afectadas.length })
    return NextResponse.json({ id: bloqueoId, citas_afectadas: await paraPersona(a.personal, afectadas) }, { status: 201 })
  } catch (e) {
    return respuestaExcepcion('admin/crm/personal/[id]/bloqueos POST', e)
  }
}

/** Quita un bloqueo. La bitácora no tiene «eliminar»: queda como `actualizar` con `{ eliminado: true }`. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi()
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success || !puedeVerHorario(a.personal, id)) return jsonError(404, 'No encontrado')
  if (!puedeGestionarBloqueos(a.personal, id)) return jsonError(403, 'No tienes permiso para esta acción')

  const parsed = bloqueoBorrarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)

  try {
    const { data: bloqueo, error: errLectura } = await supabase
      .from('crm_bloqueos').select('id,desde,hasta,tipo').eq('id', parsed.data.bloqueo_id).eq('personal_id', id).maybeSingle()
    if (errLectura) return respuestaErrorBD('admin/crm/personal/[id]/bloqueos DELETE (lectura)', errLectura)
    if (!bloqueo) return jsonError(404, 'No encontrado')

    const { error } = await supabase.from('crm_bloqueos').delete().eq('id', parsed.data.bloqueo_id).eq('personal_id', id)
    if (error) return respuestaErrorBD('admin/crm/personal/[id]/bloqueos DELETE', error)

    await registrar({
      userId: a.user.id,
      accion: 'actualizar',
      entidad: 'crm_bloqueos',
      entidadId: parsed.data.bloqueo_id,
      antes: bloqueo as Record<string, unknown>,
      detalle: { eliminado: true },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return respuestaExcepcion('admin/crm/personal/[id]/bloqueos DELETE', e)
  }
}

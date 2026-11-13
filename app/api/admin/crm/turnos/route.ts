import { type NextRequest, NextResponse } from 'next/server'
import { ACCIONES, autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { queryComoObjeto, turnoBorrarSchema, turnoCrearSchema, turnosQuerySchema } from '@/lib/crm/schemas'
import { borrarTurno, crearTurno, listarTurnos } from '@/lib/crm/turnos'

/** Turnos de abogados fuera de horario (R-16). Dirección y Coordinación. */

export async function GET(request: NextRequest) {
  const a = await autorizarApi(ACCIONES['turnos.gestionar'])
  if ('status' in a) return a

  const parsed = turnosQuerySchema.safeParse(queryComoObjeto(request.nextUrl.searchParams))
  if (!parsed.success) return respuestaZod(parsed.error)

  try {
    const r = await listarTurnos(parsed.data)
    if (r === 'cursor_invalido') return jsonError(400, 'Cursor inválido')
    return NextResponse.json(r)
  } catch (e) {
    return respuestaExcepcion('admin/crm/turnos GET', e)
  }
}

export async function POST(request: NextRequest) {
  const a = await autorizarApi(ACCIONES['turnos.gestionar'])
  if ('status' in a) return a

  const parsed = turnoCrearSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)

  try {
    const r = await crearTurno(a.personal, parsed.data)
    return r.ok ? NextResponse.json(r.datos, { status: 201 }) : r.respuesta
  } catch (e) {
    return respuestaExcepcion('admin/crm/turnos POST', e)
  }
}

/** Quita un turno que no ha terminado (cuerpo `{ turno_id }`, igual que los bloqueos). */
export async function DELETE(request: NextRequest) {
  const a = await autorizarApi(ACCIONES['turnos.gestionar'])
  if ('status' in a) return a

  const parsed = turnoBorrarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)

  try {
    const r = await borrarTurno(a.personal, parsed.data.turno_id)
    return r.ok ? NextResponse.json(r.datos) : r.respuesta
  } catch (e) {
    return respuestaExcepcion('admin/crm/turnos DELETE', e)
  }
}

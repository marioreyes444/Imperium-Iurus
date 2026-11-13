import { type NextRequest, NextResponse } from 'next/server'
import { citaCancelarSchema, citaEstadoSchema, type ApiResponse } from '@/lib/schemas'
import { supabase } from '@/lib/supabase'
import { getUser } from '@/lib/supabase-server'
import { isAdminUser } from '@/lib/admin-auth'
import { CrmNoDisponibleError, getPersonal } from '@/lib/crm/permisos'
import { cancelarCita, obtenerCita } from '@/lib/crm/citas'

type RouteParams = { params: Promise<{ id: string }> }

const ACTIVOS = ['pendiente', 'confirmada']

// GET — Detalle de una cita (admin only)
export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const user = await getUser()
  if (!isAdminUser(user)) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 })

  const { id } = await params
  const { data, error } = await supabase.from('citas').select('*').eq('id', id).maybeSingle()
  if (error || !data) {
    return NextResponse.json({ success: false, error: 'Cita no encontrada' }, { status: 404 })
  }
  return NextResponse.json({ success: true, data })
}

// PATCH — Cambiar estado (admin only): solo pendiente ↔ confirmada.
// Cancelar va por DELETE (con motivo). Una cita cancelada o concluida no se reactiva (R-38).
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<{ id: string } | null>>> {
  const user = await getUser()
  if (!isAdminUser(user)) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 })

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Body inválido' }, { status: 400 })
  }

  const parsed = citaEstadoSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Estado inválido. Para cancelar una cita usa «Cancelar» e indica el motivo.', issues: parsed.error.flatten().fieldErrors as Record<string, string[]> },
      { status: 422 },
    )
  }

  const { data: actual, error: errLectura } = await supabase.from('citas').select('estado').eq('id', id).maybeSingle()
  if (errLectura) {
    console.error('[appointments/id] Supabase error:', errLectura.code)
    return NextResponse.json({ success: false, error: 'Error al actualizar la cita.' }, { status: 502 })
  }
  if (!actual) return NextResponse.json({ success: false, error: 'Cita no encontrada' }, { status: 404 })
  if (!ACTIVOS.includes(actual.estado as string)) {
    return NextResponse.json({ success: false, error: 'Una cita cancelada o concluida no se reactiva; agenda una nueva.' }, { status: 409 })
  }

  const { error } = await supabase
    .from('citas')
    .update({ estado: parsed.data.estado })
    .eq('id', id)
    .in('estado', ACTIVOS)

  if (error) {
    console.error('[appointments/id] Supabase error:', error)
    return NextResponse.json({ success: false, error: 'Error al actualizar la cita.' }, { status: 502 })
  }

  return NextResponse.json({ success: true, data: { id } })
}

// DELETE — Cancelar cita (admin only, marca como cancelada, no borra).
// Exige motivo y origen y usa crm_cancelar_cita (R-37): libera la hora, devuelve el caso a calificación
// y crea la tarea de reagendar. Requiere las migraciones M4 y M5.
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse>> {
  const user = await getUser()
  if (!user || !isAdminUser(user)) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 })

  const { id } = await params

  const parsed = citaCancelarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Indica el motivo (mínimo 5 caracteres) y quién cancela.', issues: parsed.error.flatten().fieldErrors as Record<string, string[]> },
      { status: 422 },
    )
  }

  try {
    const cita = await obtenerCita(id)
    if (!cita) return NextResponse.json({ success: false, error: 'Cita no encontrada' }, { status: 404 })

    const personal = await getPersonal(user)
    const r = await cancelarCita({ personal, userId: user.id }, cita, parsed.data)
    if (!r.ok) {
      const cuerpo = await r.respuesta.json().catch(() => ({})) as { error?: string }
      return NextResponse.json({ success: false, error: cuerpo.error ?? 'Error al cancelar la cita.' }, { status: r.respuesta.status })
    }
    return NextResponse.json({ success: true, data: null })
  } catch (e) {
    if (e instanceof CrmNoDisponibleError || (e instanceof Error && e.message === 'CRM_NO_DISPONIBLE')) {
      return NextResponse.json({ success: false, error: 'La cancelación con motivo requiere las migraciones del CRM (M4/M5).' }, { status: 503 })
    }
    console.error('[appointments/id] cancelar:', e instanceof Error ? e.name : 'error')
    return NextResponse.json({ success: false, error: 'Error al cancelar la cita.' }, { status: 502 })
  }
}

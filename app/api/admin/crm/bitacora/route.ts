import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { ACCIONES, autorizarApi, CrmNoDisponibleError, puede, puedeVerSolicitud } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaZod } from '@/lib/crm/errores'
import { bitacoraQuerySchema, queryComoObjeto } from '@/lib/crm/schemas'

type FilaBitacora = {
  id: number
  user_id: string | null
  accion: string
  entidad: string
  entidad_id: string | null
  valores_antes: unknown
  valores_despues: unknown
  motivo: string | null
  detalle: unknown
  created_at: string
}

/**
 * Dirección ve todo. Coordinación y asociado solo la bitácora de UN caso que puedan ver
 * (entidad=crm_solicitudes&entidad_id=…).
 */
export async function GET(request: NextRequest) {
  const a = await autorizarApi(ACCIONES['bitacora.ver_caso'])
  if ('status' in a) return a

  const parsed = bitacoraQuerySchema.safeParse(queryComoObjeto(request.nextUrl.searchParams))
  if (!parsed.success) return respuestaZod(parsed.error)
  const { entidad, entidad_id, usuario, accion, desde, hasta, cursor, limite } = parsed.data

  if (!puede(a.personal.rol, 'bitacora.ver')) {
    if (entidad !== 'crm_solicitudes' || !entidad_id) return jsonError(403, 'No tienes permiso para esta acción')
    try {
      const nivel = await puedeVerSolicitud(a.personal, entidad_id)
      if (nivel !== 'completo') return jsonError(404, 'No encontrado')
    } catch (e) {
      if (e instanceof CrmNoDisponibleError) {
        return jsonError(503, 'El módulo CRM aún no está disponible en este entorno.', { codigo: 'CRM_NO_DISPONIBLE' })
      }
      return jsonError(502, 'Ocurrió un error inesperado. Inténtalo de nuevo.')
    }
  }

  let query = supabase
    .from('crm_bitacora')
    .select('id,user_id,accion,entidad,entidad_id,valores_antes,valores_despues,motivo,detalle,created_at', { count: 'exact' })
    .order('id', { ascending: false })
    .limit(limite + 1)

  if (entidad) query = query.eq('entidad', entidad)
  if (entidad_id) query = query.eq('entidad_id', entidad_id)
  if (usuario) query = query.eq('user_id', usuario)
  if (accion) query = query.eq('accion', accion)
  // Ecuador no tiene horario de verano: el desfase es fijo (UTC-5).
  if (desde) query = query.gte('created_at', `${desde}T00:00:00-05:00`)
  if (hasta) query = query.lte('created_at', `${hasta}T23:59:59.999-05:00`)
  if (cursor) {
    if (!/^\d{1,18}$/.test(cursor)) return jsonError(400, 'Cursor inválido')
    query = query.lt('id', cursor)
  }

  const { data, error, count } = await query
  if (error) return respuestaErrorBD('admin/crm/bitacora GET', error)

  const filas = (data ?? []) as FilaBitacora[]
  const hayMas = filas.length > limite
  const pagina = filas.slice(0, limite)

  // Nombre de quien actuó (user_id es la cuenta; la ficha está en crm_personal).
  const ids = [...new Set(pagina.map((f) => f.user_id).filter((v): v is string => !!v))]
  const nombres = new Map<string, string>()
  if (ids.length > 0) {
    const { data: personal } = await supabase
      .from('crm_personal').select('user_id,nombres,apellidos').in('user_id', ids)
    for (const p of (personal ?? []) as { user_id: string; nombres: string; apellidos: string }[]) {
      nombres.set(p.user_id, `${p.nombres} ${p.apellidos}`)
    }
  }

  return NextResponse.json({
    items: pagina.map((f) => ({
      id: f.id,
      accion: f.accion,
      entidad: f.entidad,
      entidad_id: f.entidad_id,
      usuario: f.user_id ? (nombres.get(f.user_id) ?? 'Cuenta sin ficha') : null,
      motivo: f.motivo,
      valores_antes: f.valores_antes,
      valores_despues: f.valores_despues,
      detalle: f.detalle,
      created_at: f.created_at,
    })),
    siguienteCursor: hayMas && pagina.length > 0 ? String(pagina[pagina.length - 1].id) : null,
    total: count ?? pagina.length,
  })
}

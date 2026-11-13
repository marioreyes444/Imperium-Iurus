import { type NextRequest, NextResponse } from 'next/server'
import { ACCIONES, autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { queryComoObjeto, reportesQuerySchema } from '@/lib/crm/schemas'
import { ExcedeTopeError, generarReporte } from '@/lib/crm/reportes'

/**
 * Reportes por período (obligatorio, máx. 366 días), área, canal y responsable. Solo Dirección y
 * Coordinación; el asociado ve su carga en su tablero. Coordinación nunca recibe casos reservados.
 */
export async function GET(request: NextRequest) {
  const a = await autorizarApi(ACCIONES['reportes.ver'])
  if ('status' in a) return a

  const parsed = reportesQuerySchema.safeParse(queryComoObjeto(request.nextUrl.searchParams))
  if (!parsed.success) return respuestaZod(parsed.error)

  try {
    return NextResponse.json(await generarReporte(a.personal, parsed.data), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    if (e instanceof ExcedeTopeError) {
      return jsonError(422, `El período trae demasiados datos para el bloque «${e.bloque}» (más de ${e.tope} filas). Acorta el período o agrega filtros.`, {
        codigo: 'REPORTE_EXCEDE_TOPE',
        datos: { bloque: e.bloque, tope: e.tope },
      })
    }
    return respuestaExcepcion('admin/crm/reportes GET', e)
  }
}

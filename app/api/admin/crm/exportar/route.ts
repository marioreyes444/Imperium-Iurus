import { type NextRequest, NextResponse } from 'next/server'
import { ACCIONES, autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { queryComoObjeto, reportesQuerySchema } from '@/lib/crm/schemas'
import { ExcedeTopeError } from '@/lib/crm/reportes'
import { generarCsv } from '@/lib/crm/exportar'
import { registrar } from '@/lib/crm/bitacora'

/**
 * Exporta las solicitudes del período a CSV (UTF-8 con BOM, separador `;`). Período obligatorio y los
 * mismos filtros que los reportes. Dirección y Coordinación; Coordinación sin casos reservados (R-53).
 *
 * R-54: cada exportación queda en la bitácora (quién, cuándo, filtros y número de filas, NUNCA los datos).
 * Si no se puede registrar, el archivo no se entrega.
 */
export async function GET(request: NextRequest) {
  const a = await autorizarApi(ACCIONES['exportar.csv'])
  if ('status' in a) return a

  const parsed = reportesQuerySchema.safeParse(queryComoObjeto(request.nextUrl.searchParams))
  if (!parsed.success) return respuestaZod(parsed.error)
  const f = parsed.data

  try {
    const { csv, filas } = await generarCsv(a.personal, f)

    const registrada = await registrar({
      userId: a.user.id,
      accion: 'exportar',
      entidad: 'crm_solicitudes',
      detalle: {
        filtros: { desde: f.desde, hasta: f.hasta, area: f.area ?? null, canal: f.canal ?? null, responsable: f.responsable ?? null },
        filas,
        formato: 'csv',
      },
    })
    if (!registrada) {
      return jsonError(502, 'No se pudo registrar la exportación en el historial, así que no se entregó el archivo. Inténtalo de nuevo.')
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="solicitudes_${f.desde}_a_${f.hasta}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    if (e instanceof ExcedeTopeError) {
      return jsonError(422, `El período trae más de ${e.tope} solicitudes. Acorta el período o agrega filtros.`, {
        codigo: 'EXPORTACION_EXCEDE_TOPE',
        datos: { tope: e.tope },
      })
    }
    return respuestaExcepcion('admin/crm/exportar GET', e)
  }
}

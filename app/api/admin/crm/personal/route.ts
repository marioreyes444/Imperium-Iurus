import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaZod } from '@/lib/crm/errores'
import { personalQuerySchema, queryComoObjeto } from '@/lib/crm/schemas'
import { normalizarBusqueda } from '@/lib/crm/normalizar'
import { COLUMNAS_FICHA, fichaParaPantalla, type FichaFila } from '@/lib/crm/personal'

/** El personal es un conjunto pequeño: se trae, se filtra en memoria y se pagina con cursor por posición. */
const LIMITE_BUSQUEDA = 1000

export async function GET(request: NextRequest) {
  const a = await autorizarApi(['direccion', 'coordinacion'])
  if ('status' in a) return a

  const parsed = personalQuerySchema.safeParse(queryComoObjeto(request.nextUrl.searchParams))
  if (!parsed.success) return respuestaZod(parsed.error)
  const { q, rol, abogados, cursor, limite } = parsed.data

  let consulta = supabase
    .from('crm_personal')
    .select(COLUMNAS_FICHA)
    .eq('activo', true)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(LIMITE_BUSQUEDA)
  if (rol) consulta = consulta.eq('rol', rol)
  if (abogados) consulta = consulta.eq('es_abogado', true)

  const { data, error } = await consulta
  if (error) return respuestaErrorBD('admin/crm/personal GET', error)

  const texto = q ? normalizarBusqueda(q) : ''
  const filas = ((data ?? []) as unknown as FichaFila[]).filter(
    (f) => !texto || normalizarBusqueda(`${f.nombres} ${f.apellidos} ${f.correo ?? ''} ${f.matricula ?? ''}`).includes(texto),
  )

  let desde = 0
  if (cursor) {
    if (!/^[0-9a-f-]{36}$/i.test(cursor)) return jsonError(400, 'Cursor inválido')
    const i = filas.findIndex((f) => f.id === cursor)
    desde = i === -1 ? filas.length : i + 1
  }
  const pagina = filas.slice(desde, desde + limite)

  const { data: cargas } = await supabase
    .from('crm_v_carga_personal')
    .select('personal_id,carga_titular,casos_apoyo,tareas_vencidas')
    .in('personal_id', pagina.map((f) => f.id).concat('00000000-0000-0000-0000-000000000000'))
  const cargaDe = new Map(
    ((cargas ?? []) as { personal_id: string; carga_titular: number; casos_apoyo: number; tareas_vencidas: number }[]).map((c) => [c.personal_id, c]),
  )

  const ultimo = pagina[pagina.length - 1]
  return NextResponse.json({
    items: pagina.map((f) => ({
      ...fichaParaPantalla(f),
      carga_titular: cargaDe.get(f.id)?.carga_titular ?? 0,
      casos_apoyo: cargaDe.get(f.id)?.casos_apoyo ?? 0,
      tareas_vencidas: cargaDe.get(f.id)?.tareas_vencidas ?? 0,
    })),
    siguienteCursor: ultimo && desde + limite < filas.length ? ultimo.id : null,
    total: filas.length,
  })
}

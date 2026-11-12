import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaZod } from '@/lib/crm/errores'
import { queryComoObjeto, usuarioCrearSchema, usuariosQuerySchema } from '@/lib/crm/schemas'
import { normalizarBusqueda } from '@/lib/crm/normalizar'
import { registrar } from '@/lib/crm/bitacora'
import { invitarUsuario } from '@/lib/crm/invitaciones'
import { COLUMNAS_USUARIO, paraPantalla, type UsuarioFila } from '@/lib/crm/usuarios'

/** Tope de filas que se traen para buscar en memoria (el personal es un conjunto pequeño). */
const LIMITE_BUSQUEDA = 1000

const FORMATO_CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\|([0-9a-f-]{36})$/i

export async function GET(request: NextRequest) {
  const a = await autorizarApi(['direccion'])
  if ('status' in a) return a

  const parsed = usuariosQuerySchema.safeParse(queryComoObjeto(request.nextUrl.searchParams))
  if (!parsed.success) return respuestaZod(parsed.error)
  const { q, rol, activo, cursor, limite } = parsed.data

  const consultaBase = () => {
    let b = supabase
      .from('crm_personal')
      .select(COLUMNAS_USUARIO, { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
    if (rol) b = b.eq('rol', rol)
    if (activo) b = b.eq('activo', activo === 'true')
    return b
  }

  let desdeCursor: { marca: string; id: string } | null = null
  if (cursor) {
    const m = FORMATO_CURSOR.exec(cursor)
    if (!m) return jsonError(400, 'Cursor inválido')
    desdeCursor = { marca: m[1], id: m[2] }
  }
  const cursorDe = (f: UsuarioFila) => `${f.created_at}|${f.id}`

  // Con búsqueda: crm_personal no tiene columna normalizada y el esquema no se toca, así que
  // el texto se normaliza AQUÍ (minúsculas, sin tildes) y se filtra sobre el personal ya
  // permitido (esta ruta es solo de Dirección). El personal es un conjunto pequeño.
  const textoBuscado = q ? normalizarBusqueda(q) : ''
  if (textoBuscado) {
    const { data, error } = await consultaBase().limit(LIMITE_BUSQUEDA)
    if (error) return respuestaErrorBD('admin/crm/usuarios GET (búsqueda)', error)

    const coinciden = ((data ?? []) as UsuarioFila[]).filter((f) =>
      normalizarBusqueda(`${f.nombres} ${f.apellidos} ${f.correo ?? ''}`).includes(textoBuscado),
    )
    let desde = 0
    if (desdeCursor) {
      const i = coinciden.findIndex((f) => f.id === desdeCursor.id)
      desde = i === -1 ? coinciden.length : i + 1
    }
    const pagina = coinciden.slice(desde, desde + limite)
    const ultimo = pagina[pagina.length - 1]
    return NextResponse.json({
      items: pagina.map(paraPantalla),
      siguienteCursor: ultimo && desde + limite < coinciden.length ? cursorDe(ultimo) : null,
      total: coinciden.length,
    })
  }

  // Sin búsqueda: paginación en la base con cursor (fecha, id).
  let query = consultaBase().limit(limite + 1)
  if (desdeCursor) {
    query = query.or(
      `created_at.lt.${desdeCursor.marca},and(created_at.eq.${desdeCursor.marca},id.lt.${desdeCursor.id})`,
    )
  }
  const { data, error, count } = await query
  if (error) return respuestaErrorBD('admin/crm/usuarios GET', error)

  const filas = (data ?? []) as UsuarioFila[]
  const hayMas = filas.length > limite
  const items = filas.slice(0, limite)
  const ultimo = items[items.length - 1]

  return NextResponse.json({
    items: items.map(paraPantalla),
    siguienteCursor: hayMas && ultimo ? cursorDe(ultimo) : null,
    total: count ?? items.length,
  })
}

export async function POST(request: NextRequest) {
  const a = await autorizarApi(['direccion'])
  if ('status' in a) return a

  const parsed = usuarioCrearSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data

  // Correo ya registrado en el personal.
  const { data: existente, error: errDup } = await supabase
    .from('crm_personal').select('id').eq('correo', d.correo).limit(1)
  if (errDup) return respuestaErrorBD('admin/crm/usuarios POST (duplicado)', errDup)
  if ((existente ?? []).length > 0) {
    return jsonError(409, 'Ya existe una persona con ese correo.', { campos: { correo: 'Ya existe una persona con ese correo' } })
  }

  // Un asociado es siempre abogado; un externo nunca (restricciones de la base).
  const esAbogado = d.rol === 'asociado' ? true : d.rol === 'externo' ? false : (d.es_abogado ?? false)

  const { data, error } = await supabase
    .from('crm_personal')
    .insert({
      rol: d.rol,
      nombres: d.nombres,
      apellidos: d.apellidos,
      correo: d.correo,
      telefono: d.telefono ?? null,
      ciudad: d.ciudad ?? null,
      es_abogado: esAbogado,
      matricula: esAbogado ? (d.matricula ?? null) : null,
      created_by: a.user.id,
    })
    .select(COLUMNAS_USUARIO)
    .single()
  if (error) return respuestaErrorBD('admin/crm/usuarios POST', error)

  const ficha = data as UsuarioFila
  await registrar({
    userId: a.user.id,
    accion: 'crear_usuario',
    entidad: 'crm_personal',
    entidadId: ficha.id,
    despues: { rol: ficha.rol, es_abogado: ficha.es_abogado, correo: ficha.correo },
  })

  // PENDIENTE: invitación por correo (ver lib/crm/invitaciones.ts).
  const invitacion = await invitarUsuario({ personalId: ficha.id, correo: d.correo, rol: d.rol })

  return NextResponse.json({ usuario: paraPantalla(ficha), invitacion }, { status: 201 })
}

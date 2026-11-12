import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { duplicadoCrearSchema, duplicadosQuerySchema, queryComoObjeto } from '@/lib/crm/schemas'
import { alcancesDe, contactosBloqueados, contactosVisiblesEntre } from '@/lib/crm/visibilidad'
import { condicionCursor, leerCursor, paginar } from '@/lib/crm/paginacion'
import { registrar } from '@/lib/crm/bitacora'
import { COLUMNAS_PAR, type ParDuplicado } from '@/lib/crm/duplicados'
import { nombreContacto, type ContactoFila } from '@/lib/crm/contactos'

const ROLES = ['direccion', 'coordinacion', 'asistencia'] as const

type Resumen = Pick<ContactoFila, 'id' | 'tipo' | 'nombres' | 'apellidos' | 'razon_social' | 'correo' | 'telefono' | 'identificacion' | 'etapa_relacion'>

export async function GET(request: NextRequest) {
  const a = await autorizarApi(ROLES)
  if ('status' in a) return a

  const parsed = duplicadosQuerySchema.safeParse(queryComoObjeto(request.nextUrl.searchParams))
  if (!parsed.success) return respuestaZod(parsed.error)
  const { estado, cursor, limite } = parsed.data
  const desde = leerCursor(cursor)
  if (desde === null) return jsonError(400, 'Cursor inválido')

  try {
    const { contactos: alcance } = await alcancesDe(a.personal)

    // Un par solo aparece si la persona puede ver AMBAS fichas: se excluyen en la consulta las
    // fichas reservadas a las que no tiene acceso.
    const bloqueados = await contactosBloqueados(alcance)

    let query = supabase
      .from('crm_posibles_duplicados')
      .select(COLUMNAS_PAR, { count: 'exact' })
      .eq('estado', estado)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limite + 1)
    if (bloqueados.length > 0) {
      const lista = `(${bloqueados.join(',')})`
      query = query.not('contacto_a', 'in', lista).not('contacto_b', 'in', lista)
    }
    if (desde) query = query.or(condicionCursor(desde))

    const { data, error, count } = await query
    if (error) return respuestaErrorBD('admin/crm/duplicados GET', error)

    const pagina = paginar((data ?? []) as ParDuplicado[], limite, count ?? 0)

    const ids = [...new Set(pagina.items.flatMap((p) => [p.contacto_a, p.contacto_b]))]
    const resumenes = new Map<string, Resumen>()
    if (ids.length > 0) {
      const { data: fichas } = await supabase
        .from('crm_contactos')
        .select('id,tipo,nombres,apellidos,razon_social,correo,telefono,identificacion,etapa_relacion')
        .in('id', ids)
      for (const f of (fichas ?? []) as unknown as Resumen[]) resumenes.set(f.id, f)
    }
    const ficha = (id: string) => {
      const f = resumenes.get(id)
      return f ? { id, nombre: nombreContacto(f), correo: f.correo, telefono: f.telefono, identificacion: f.identificacion, etapa_relacion: f.etapa_relacion } : { id, nombre: '—' }
    }

    return NextResponse.json({
      ...pagina,
      items: pagina.items.map((p) => ({
        id: p.id, coincidencia: p.coincidencia, estado: p.estado, created_at: p.created_at,
        a: ficha(p.contacto_a), b: ficha(p.contacto_b),
      })),
    })
  } catch (e) {
    return respuestaExcepcion('admin/crm/duplicados GET', e)
  }
}

/** Marca a mano un posible duplicado. */
export async function POST(request: NextRequest) {
  const a = await autorizarApi(ROLES)
  if ('status' in a) return a

  const parsed = duplicadoCrearSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data

  try {
    const { contactos: alcance } = await alcancesDe(a.personal)
    const visibles = await contactosVisiblesEntre([d.contacto_a, d.contacto_b], alcance)
    if (!visibles.has(d.contacto_a) || !visibles.has(d.contacto_b)) return jsonError(404, 'No encontrado')

    // Deben ser fichas vigentes.
    const { data: fichas, error: errFichas } = await supabase
      .from('crm_contactos').select('id,fusionado_en').in('id', [d.contacto_a, d.contacto_b])
    if (errFichas) return respuestaErrorBD('admin/crm/duplicados POST (fichas)', errFichas)
    if ((fichas ?? []).some((f) => (f as { fusionado_en: string | null }).fusionado_en)) {
      return jsonError(422, 'Una de las fichas ya fue fusionada.', { codigo: 'R-05' })
    }

    // La base exige contacto_a < contacto_b.
    const x = d.contacto_a.toLowerCase() < d.contacto_b.toLowerCase() ? d.contacto_a : d.contacto_b
    const y = x === d.contacto_a ? d.contacto_b : d.contacto_a
    const { data, error } = await supabase
      .from('crm_posibles_duplicados')
      .insert({ contacto_a: x, contacto_b: y, coincidencia: d.coincidencia })
      .select('id')
      .single()
    if (error) {
      if (error.code === '23505') return jsonError(409, 'Esas dos fichas ya están marcadas como posible duplicado.')
      return respuestaErrorBD('admin/crm/duplicados POST', error)
    }

    await registrar({
      userId: a.user.id, accion: 'crear', entidad: 'crm_posibles_duplicados',
      entidadId: (data as { id: string }).id, despues: { coincidencia: d.coincidencia },
    })
    return NextResponse.json({ id: (data as { id: string }).id }, { status: 201 })
  } catch (e) {
    return respuestaExcepcion('admin/crm/duplicados POST', e)
  }
}

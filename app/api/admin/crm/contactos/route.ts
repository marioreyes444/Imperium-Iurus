import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { contactoCrearSchema, contactosQuerySchema, queryComoObjeto } from '@/lib/crm/schemas'
import { alcancesDe, aplicarAlcance } from '@/lib/crm/visibilidad'
import { condicionCursor, leerCursor, paginar } from '@/lib/crm/paginacion'
import { textoParaFiltro } from '@/lib/crm/normalizar'
import { registrar } from '@/lib/crm/bitacora'
import {
  buscarCoincidencias, COLUMNAS_CONTACTO, COLUMNAS_LISTA_CONTACTO, filaParaPantalla, nombreContacto,
  type ContactoFila,
} from '@/lib/crm/contactos'
import { registrarCoincidencias } from '@/lib/crm/duplicados'

/** D, C, A ven y crean; el asociado solo ve los de sus casos; el externo no accede a contactos. */
const ROLES_LECTURA = ['direccion', 'coordinacion', 'asistencia', 'asociado'] as const
const ROLES_ESCRITURA = ['direccion', 'coordinacion', 'asistencia'] as const

export async function GET(request: NextRequest) {
  const a = await autorizarApi(ROLES_LECTURA)
  if ('status' in a) return a

  const parsed = contactosQuerySchema.safeParse(queryComoObjeto(request.nextUrl.searchParams))
  if (!parsed.success) return respuestaZod(parsed.error)
  const { q, tipo, etapa, incluir_fusionados, cursor, limite } = parsed.data

  const desde = leerCursor(cursor)
  if (desde === null) return jsonError(400, 'Cursor inválido')

  try {
    const { contactos: alcance } = await alcancesDe(a.personal)

    let query = supabase
      .from('crm_contactos')
      .select(COLUMNAS_LISTA_CONTACTO, { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limite + 1)

    if (!incluir_fusionados) query = query.is('fusionado_en', null)
    if (tipo) query = query.eq('tipo', tipo)
    if (etapa) query = query.eq('etapa_relacion', etapa)
    if (q) {
      // `busqueda` ya viene en minúsculas y sin tildes; el texto se normaliza igual.
      const t = textoParaFiltro(q)
      if (t) query = query.ilike('busqueda', `%${t}%`)
    }
    // Visibilidad EN la consulta (y el cursor, combinados con AND).
    query = aplicarAlcance(query, alcance, 'id', desde ? [condicionCursor(desde)] : [])

    const { data, error, count } = await query
    if (error) return respuestaErrorBD('admin/crm/contactos GET', error)

    const pagina = paginar((data ?? []) as unknown as ContactoFila[], limite, count ?? 0)
    return NextResponse.json({ ...pagina, items: pagina.items.map(filaParaPantalla) })
  } catch (e) {
    return respuestaExcepcion('admin/crm/contactos GET', e)
  }
}

export async function POST(request: NextRequest) {
  const a = await autorizarApi(ROLES_ESCRITURA)
  if ('status' in a) return a

  const parsed = contactoCrearSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data
  const soloVerificar = request.nextUrl.searchParams.get('verificar') === '1'

  try {
    const { contactos: alcance } = await alcancesDe(a.personal)

    // R-04: coincidencias por identificación, teléfono y correo (solo se muestran las que esta persona puede ver).
    const crudas = await buscarCoincidencias({
      tipoIdentificacion: d.tipo_identificacion,
      identificacion: d.identificacion,
      telefonoNormalizado: d.telefono_normalizado,
      correoNormalizado: d.correo,
    })
    let visibles: Awaited<ReturnType<typeof listarVisibles>> = []
    if (crudas.length > 0) visibles = await listarVisibles(crudas, alcance)

    if (soloVerificar) {
      // Solo devuelve coincidencias, no guarda nada.
      return NextResponse.json({ coincidencias: visibles })
    }

    // R-02: la identificación es única entre fichas vigentes.
    const colision = crudas.find((c) => c.coincidencia === 'identificacion')
    if (colision) {
      const visible = visibles.find((v) => v.id === colision.id)
      return jsonError(409, 'Ya existe una ficha con esa identificación', {
        campos: { identificacion: 'Ya existe una ficha con esa identificación' },
        datos: visible ? { id: visible.id } : undefined,
      })
    }

    const { data, error } = await supabase
      .from('crm_contactos')
      .insert({
        tipo: d.tipo,
        nombres: d.nombres ?? null,
        apellidos: d.apellidos ?? null,
        ocupacion: d.ocupacion ?? null,
        razon_social: d.razon_social ?? null,
        nombre_comercial: d.nombre_comercial ?? null,
        sector: d.sector ?? null,
        tipo_identificacion: d.tipo_identificacion ?? null,
        identificacion: d.identificacion ?? null,
        identificacion_validada: d.identificacion_validada ?? false,
        telefono: d.telefono ?? null,
        telefono_normalizado: d.telefono_normalizado ?? null,
        correo: d.correo ?? null,
        ciudad: d.ciudad ?? null,
        direccion: d.direccion ?? null,
        preferencia_comunicacion: d.preferencia_comunicacion ?? null,
        canal_primer_contacto: d.canal_primer_contacto ?? null,
        como_nos_conocio: d.como_nos_conocio ?? null,
        notas_internas: d.notas_internas ?? null,
        created_by: a.user.id,
      })
      .select(COLUMNAS_CONTACTO)
      .single()
    if (error) return respuestaErrorBD('admin/crm/contactos POST', error)

    const ficha = data as unknown as ContactoFila
    // R-04: teléfono o correo repetidos no bloquean; quedan para revisar en Duplicados.
    await registrarCoincidencias(ficha.id, crudas)
    await registrar({
      userId: a.user.id,
      accion: 'crear',
      entidad: 'crm_contactos',
      entidadId: ficha.id,
      despues: { tipo: ficha.tipo, etapa_relacion: ficha.etapa_relacion },
    })

    return NextResponse.json(
      { contacto: filaParaPantalla(ficha), duplicados_marcados: crudas.filter((c) => c.coincidencia !== 'identificacion').length },
      { status: 201 },
    )
  } catch (e) {
    return respuestaExcepcion('admin/crm/contactos POST', e)
  }
}

/** Resumen de las coincidencias que la persona puede ver (las reservadas ajenas no se revelan). */
async function listarVisibles(
  crudas: { id: string; coincidencia: 'identificacion' | 'telefono' | 'correo' }[],
  alcance: Awaited<ReturnType<typeof alcancesDe>>['contactos'],
) {
  const consulta = aplicarAlcance(
    supabase
      .from('crm_contactos')
      .select('id,tipo,nombres,apellidos,razon_social,etapa_relacion')
      .in('id', crudas.map((c) => c.id)),
    alcance,
  )
  const { data, error } = await consulta
  if (error) {
    console.error('[admin/crm/contactos] coincidencias visibles', error.code)
    return []
  }
  return ((data ?? []) as unknown as Pick<ContactoFila, 'id' | 'tipo' | 'nombres' | 'apellidos' | 'razon_social' | 'etapa_relacion'>[]).map((f) => ({
    id: f.id,
    nombre: nombreContacto(f),
    etapa_relacion: f.etapa_relacion,
    coincidencia: crudas.find((c) => c.id === f.id)?.coincidencia ?? 'correo',
  }))
}

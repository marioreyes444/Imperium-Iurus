import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi, puedeFiltrarPorTitular, puedeMarcarReserva, tieneVistaReducida } from '@/lib/crm/permisos'
import { idsDeUltimoTitular, TOPE_IDS_FILTRO_TITULAR } from '@/lib/crm/titulares'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { queryComoObjeto, solicitudCrearSchema, solicitudesQuerySchema } from '@/lib/crm/schemas'
import { alcancesDe, aplicarAlcance, contactosVisiblesEntre } from '@/lib/crm/visibilidad'
import { condicionCursor, leerCursor, paginar } from '@/lib/crm/paginacion'
import { textoParaFiltro } from '@/lib/crm/normalizar'
import { registrar } from '@/lib/crm/bitacora'
import { recalcularEtapa } from '@/lib/crm/etapas'
import { avisarSolicitudCritica } from '@/lib/crm/avisos'
import { obtenerCatalogo } from '@/lib/crm/catalogo'
import { nombreContacto, type ContactoFila } from '@/lib/crm/contactos'
import { ETIQUETA_ESTADO, FASE_ESTADO, type Estado } from '@/lib/crm/estados'

const ROLES_LECTURA = ['direccion', 'coordinacion', 'asistencia', 'asociado', 'externo'] as const
const ROLES_ESCRITURA = ['direccion', 'coordinacion', 'asistencia'] as const

const COLUMNAS_LISTA =
  'id,codigo,contacto_id,empresa_id,canal_origen,estado,urgencia,area_principal_id,requiere_validacion,reserva_reforzada,fecha_recepcion,created_at,updated_at'

type FilaLista = {
  id: string; codigo: string; contacto_id: string; empresa_id: string | null; canal_origen: string; estado: string
  urgencia: string; area_principal_id: string | null; requiere_validacion: boolean; reserva_reforzada: boolean
  fecha_recepcion: string; created_at: string; updated_at: string
}

export async function GET(request: NextRequest) {
  const a = await autorizarApi(ROLES_LECTURA)
  if ('status' in a) return a

  const parsed = solicitudesQuerySchema.safeParse(queryComoObjeto(request.nextUrl.searchParams))
  if (!parsed.success) return respuestaZod(parsed.error)
  const { q, estado, urgencia, area, validacion, contacto, titular, cursor, limite } = parsed.data
  const desde = leerCursor(cursor)
  if (desde === null) return jsonError(400, 'Cursor inválido')
  if (titular && !puedeFiltrarPorTitular(a.personal.rol)) return jsonError(403, 'No tienes permiso para esta acción')

  try {
    const al = await alcancesDe(a.personal)

    let query = supabase
      .from('crm_solicitudes')
      .select(COLUMNAS_LISTA, { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limite + 1)

    if (estado) query = query.eq('estado', estado)
    if (urgencia) query = query.eq('urgencia', urgencia)
    if (area) query = query.eq('area_principal_id', area)
    if (validacion) query = query.eq('estado', 'nueva').eq('requiere_validacion', true)
    // Último titular: los ids se aplican EN la consulta, junto con la visibilidad (un caso reservado
    // que la persona no ve no aparece aunque el titular sea el elegido).
    if (titular) {
      const idsTitular = await idsDeUltimoTitular(titular)
      if (idsTitular.length > TOPE_IDS_FILTRO_TITULAR) {
        return jsonError(422, 'Esa persona tiene demasiados casos para filtrar por titular. Agrega otro filtro o usa los reportes.', { codigo: 'FILTRO_TITULAR_EXCEDE' })
      }
      query = query.in('id', idsTitular.length > 0 ? idsTitular : ['00000000-0000-0000-0000-000000000000'])
    }

    const extraOr: string[] = []
    if (contacto) extraOr.push(`contacto_id.eq.${contacto},empresa_id.eq.${contacto}`)
    if (desde) extraOr.push(condicionCursor(desde))

    // Búsqueda por código o por datos del contacto. Los contactos que se buscan son SOLO los que la
    // persona puede ver: un caso cuyo contacto no ve no se encuentra por los datos de ese contacto.
    if (q) {
      const t = textoParaFiltro(q)
      if (t) {
        const partes = [`codigo.ilike.*${t}*`]
        const { data: coincidentes, error: errCont } = await aplicarAlcance(
          supabase.from('crm_contactos').select('id').ilike('busqueda', `%${t}%`).limit(200),
          al.contactos,
        )
        if (errCont) return respuestaErrorBD('admin/crm/solicitudes GET (búsqueda)', errCont)
        const ids = (coincidentes ?? []).map((f) => (f as { id: string }).id)
        if (ids.length > 0) partes.push(`contacto_id.in.(${ids.join(',')})`, `empresa_id.in.(${ids.join(',')})`)
        extraOr.push(partes.join(','))
      }
    }

    // Visibilidad (4.2) EN la consulta, junto con búsqueda y cursor.
    query = aplicarAlcance(query, al.solicitudes, 'id', extraOr)

    const { data, error, count } = await query
    if (error) return respuestaErrorBD('admin/crm/solicitudes GET', error)
    const pagina = paginar((data ?? []) as unknown as FilaLista[], limite, count ?? 0)

    // Contactos de la página: «Contacto reservado» si no puede ver la ficha; el externo no ve contactos.
    const nombres = new Map<string, string>()
    const vistaReducida = tieneVistaReducida(a.personal.rol)
    const visibles = vistaReducida
      ? new Set<string>()
      : await contactosVisiblesEntre(pagina.items.map((s) => s.contacto_id), al.contactos)
    if (visibles.size > 0) {
      const { data: fichas } = await supabase
        .from('crm_contactos').select('id,tipo,nombres,apellidos,razon_social').in('id', [...visibles])
      for (const f of (fichas ?? []) as unknown as Pick<ContactoFila, 'id' | 'tipo' | 'nombres' | 'apellidos' | 'razon_social'>[]) {
        nombres.set(f.id, nombreContacto(f))
      }
    }
    const catalogo = await obtenerCatalogo()

    return NextResponse.json({
      ...pagina,
      items: pagina.items.map((s) => ({
        id: s.id,
        codigo: s.codigo,
        estado: s.estado,
        estado_etiqueta: ETIQUETA_ESTADO[s.estado as Estado] ?? s.estado,
        fase: FASE_ESTADO[s.estado as Estado] ?? 'terminado',
        urgencia: s.urgencia,
        // Vista reducida (externo): solo código, estado, urgencia y área; sin canal ni marcas internas.
        canal_origen: vistaReducida ? undefined : s.canal_origen,
        area: catalogo.areas.find((x) => x.id === s.area_principal_id)?.nombre ?? null,
        requiere_validacion: vistaReducida ? false : s.requiere_validacion,
        reserva_reforzada: vistaReducida ? false : s.reserva_reforzada,
        contacto: vistaReducida ? null : visibles.has(s.contacto_id) ? (nombres.get(s.contacto_id) ?? '—') : 'Contacto reservado',
        fecha_recepcion: s.fecha_recepcion,
        created_at: s.created_at,
        updated_at: s.updated_at,
      })),
    })
  } catch (e) {
    return respuestaExcepcion('admin/crm/solicitudes GET', e)
  }
}

/** Registra una solicitud a mano. Nace `nueva`; el código y el estado los pone la base (R-10, R-12). */
export async function POST(request: NextRequest) {
  const a = await autorizarApi(ROLES_ESCRITURA)
  if ('status' in a) return a

  const parsed = solicitudCrearSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data
  const rol = a.personal.rol

  try {
    const al = await alcancesDe(a.personal)
    const idsFichas = [d.contacto_id, ...(d.empresa_id ? [d.empresa_id] : [])]
    const visibles = await contactosVisiblesEntre(idsFichas, al.contactos)
    if (idsFichas.some((id) => !visibles.has(id))) return jsonError(404, 'No encontrado')

    const { data: fichas, error: errFichas } = await supabase
      .from('crm_contactos').select('id,fusionado_en,archivado_at,reserva_reforzada').in('id', idsFichas)
    if (errFichas) return respuestaErrorBD('admin/crm/solicitudes POST (fichas)', errFichas)
    const lista = (fichas ?? []) as { id: string; fusionado_en: string | null; archivado_at: string | null; reserva_reforzada: boolean }[]
    // R-05: una ficha fusionada no recibe solicitudes.
    if (lista.some((f) => f.fusionado_en || f.archivado_at)) {
      return jsonError(422, 'Una ficha fusionada o archivada no recibe solicitudes.', { codigo: 'R-05' })
    }

    // Marcar reserva a mano: Dirección y coordinación. Las solicitudes de un contacto reservado nacen reservadas.
    if (d.reserva_reforzada === true && !puedeMarcarReserva(rol)) {
      return jsonError(403, 'No tienes permiso para marcar la reserva reforzada')
    }
    const reservada = d.reserva_reforzada === true || lista.some((f) => f.reserva_reforzada)

    const { data, error } = await supabase
      .from('crm_solicitudes')
      .insert({
        contacto_id: d.contacto_id,
        empresa_id: d.empresa_id ?? null,
        canal_origen: d.canal_origen,
        descripcion: d.descripcion,
        objetivo_cliente: d.objetivo_cliente ?? null,
        modalidad: d.modalidad ?? null,
        urgencia: d.urgencia,
        area_principal_id: d.area_principal_id ?? null,
        servicio_id: d.servicio_id ?? null,
        reserva_reforzada: reservada,
        created_by: a.user.id,
      })
      .select('id,codigo,estado,urgencia,reserva_reforzada')
      .single()
    if (error) return respuestaErrorBD('admin/crm/solicitudes POST', error)
    const sol = data as { id: string; codigo: string; estado: string; urgencia: string; reserva_reforzada: boolean }

    // Efectos posteriores (best-effort, nunca deshacen la creación).
    await recalcularEtapa(d.contacto_id, { solicitudNueva: true })
    if (d.empresa_id) await recalcularEtapa(d.empresa_id, { solicitudNueva: true })
    await registrar({
      userId: a.user.id, accion: 'crear', entidad: 'crm_solicitudes', entidadId: sol.id,
      despues: { codigo: sol.codigo, canal_origen: d.canal_origen, urgencia: sol.urgencia, reserva_reforzada: sol.reserva_reforzada },
    })
    // R-16: urgencia crítica → aviso inmediato, sin esperar la calificación.
    if (sol.urgencia === 'critica') await avisarSolicitudCritica({ id: sol.id, codigo: sol.codigo, reservada: sol.reserva_reforzada })

    return NextResponse.json({ solicitud: sol }, { status: 201 })
  } catch (e) {
    return respuestaExcepcion('admin/crm/solicitudes POST', e)
  }
}

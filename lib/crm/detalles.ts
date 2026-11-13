// Lecturas de detalle compartidas por las rutas API y las páginas del servidor.
// Cada función aplica la visibilidad en la consulta y devuelve `null` si la persona no puede ver el
// registro (las rutas responden 404, nunca 403, para no revelar que existe).
import { supabase } from '@/lib/supabase'
import {
  esDireccion, puede, puedeCambiarEtapaContacto, puedeCrearSolicitudes, puedeEditarSolicitud, puedeMarcarDuplicado, puedeMarcarReserva,
  puedeMarcarReservaEnCaso, puedeQuitarReserva, puedeResolverDuplicados, puedeValidarEnvios, puedeVerSolicitud, puedeVincularContactos, type Personal,
} from '@/lib/crm/permisos'
import { alcancesDe, aplicarAlcance, contactosVisiblesEntre } from '@/lib/crm/visibilidad'
import { registrar } from '@/lib/crm/bitacora'
import { obtenerPar } from '@/lib/crm/duplicados'
import { COLUMNAS_CONTACTO, filaParaPantalla, nombreContacto, type ContactoFila } from '@/lib/crm/contactos'
import { COLUMNAS_SOLICITUD, type SolicitudFila } from '@/lib/crm/solicitudes'
import { obtenerCatalogo } from '@/lib/crm/catalogo'
import { ETIQUETA_ESTADO, estadosPermitidos, exigeMotivo, type ContextoEstado, type Estado } from '@/lib/crm/estados'

export type DetalleContacto = NonNullable<Awaited<ReturnType<typeof detalleContacto>>>

export async function detalleContacto(personal: Personal, id: string) {
  const al = await alcancesDe(personal)
  const { data, error } = await aplicarAlcance(
    supabase.from('crm_contactos').select(COLUMNAS_CONTACTO).eq('id', id), al.contactos,
  ).maybeSingle()
  if (error) {
    console.error('[crm/detalles] contacto', error.code)
    throw new Error('CRM_ERROR')
  }
  if (!data) return null
  const contacto = data as unknown as ContactoFila

  // Dirección siempre lo ve; si es reservado y no está en el equipo de ningún caso suyo, queda registrado.
  if (esDireccion(personal.rol) && contacto.reserva_reforzada && !al.contactosActivos.includes(id)) {
    await registrar({ userId: personal.user_id, accion: 'ver_reservado', entidad: 'crm_contactos', entidadId: id })
  }

  // Personas vinculadas (si es empresa) o empresas (si es persona): solo las visibles.
  const { data: vinculos } = await supabase
    .from('crm_contacto_vinculos')
    .select('empresa_id,persona_id,cargo,es_representante_legal')
    .or(`empresa_id.eq.${id},persona_id.eq.${id}`)
  const filasVinculo = (vinculos ?? []) as { empresa_id: string; persona_id: string; cargo: string | null; es_representante_legal: boolean }[]
  const otrosIds = filasVinculo.map((v) => (v.empresa_id === id ? v.persona_id : v.empresa_id))
  const visibles = await contactosVisiblesEntre(otrosIds, al.contactos)
  const nombres = new Map<string, string>()
  if (visibles.size > 0) {
    const { data: fichas } = await supabase
      .from('crm_contactos').select('id,tipo,nombres,apellidos,razon_social').in('id', [...visibles])
    for (const f of (fichas ?? []) as unknown as Pick<ContactoFila, 'id' | 'tipo' | 'nombres' | 'apellidos' | 'razon_social'>[]) {
      nombres.set(f.id, nombreContacto(f))
    }
  }
  const vinculados = filasVinculo
    .filter((v) => visibles.has(v.empresa_id === id ? v.persona_id : v.empresa_id))
    .map((v) => {
      const otro = v.empresa_id === id ? v.persona_id : v.empresa_id
      return { id: otro, nombre: nombres.get(otro) ?? '—', cargo: v.cargo, es_representante_legal: v.es_representante_legal, como: v.empresa_id === id ? ('persona' as const) : ('empresa' as const) }
    })

  // Solicitudes de este contacto que la persona puede ver (visibilidad EN la consulta).
  const { data: sols } = await aplicarAlcance(
    supabase
      .from('crm_solicitudes')
      .select('id,codigo,estado,urgencia,created_at')
      .order('created_at', { ascending: false })
      .limit(20),
    al.solicitudes, 'id', [`contacto_id.eq.${id},empresa_id.eq.${id}`],
  )

  // Posibles duplicados pendientes cuya otra ficha también puede ver.
  const { data: pares } = await supabase
    .from('crm_posibles_duplicados')
    .select('id,contacto_a,contacto_b,coincidencia')
    .eq('estado', 'pendiente')
    .or(`contacto_a.eq.${id},contacto_b.eq.${id}`)
    .limit(20)
  const filasPar = (pares ?? []) as { id: string; contacto_a: string; contacto_b: string; coincidencia: string }[]
  const otroDe = (p: { contacto_a: string; contacto_b: string }) => (p.contacto_a === id ? p.contacto_b : p.contacto_a)
  const visiblesPar = await contactosVisiblesEntre(filasPar.map(otroDe), al.contactos)

  const rol = personal.rol
  const editable = !contacto.fusionado_en && !contacto.archivado_at
  return {
    contacto: { ...filaParaPantalla(contacto), no_validado: contacto.tipo_identificacion === 'ruc' && !contacto.identificacion_validada },
    vinculados,
    solicitudes: (sols ?? []) as { id: string; codigo: string; estado: string; urgencia: string; created_at: string }[],
    duplicados: filasPar
      .filter((p) => visiblesPar.has(otroDe(p)))
      .map((p) => ({ id: p.id, otro_id: otroDe(p), coincidencia: p.coincidencia })),
    permisos: {
      editar: editable,
      marcar_reserva: editable && puedeMarcarReserva(rol),
      quitar_reserva: editable && puedeQuitarReserva(rol),
      etapa_manual: editable && puedeCambiarEtapaContacto(rol),
      vincular: editable && puedeVincularContactos(rol),
      marcar_duplicado: editable && puedeMarcarDuplicado(rol),
      crear_solicitud: editable && puedeCrearSolicitudes(rol),
    },
  }
}

export type DetalleDuplicado = NonNullable<Awaited<ReturnType<typeof detalleDuplicado>>>

/** Las dos fichas de un par, lado a lado. Si no puede ver las dos, el par no existe para esa persona. */
export async function detalleDuplicado(personal: Personal, id: string) {
  const { par, error } = await obtenerPar(id)
  if (error) {
    console.error('[crm/detalles] par', error.code)
    throw new Error('CRM_ERROR')
  }
  if (!par) return null

  const al = await alcancesDe(personal)
  const { data: fichas, error: errFichas } = await aplicarAlcance(
    supabase.from('crm_contactos').select(COLUMNAS_CONTACTO).in('id', [par.contacto_a, par.contacto_b]),
    al.contactos,
  )
  if (errFichas) {
    console.error('[crm/detalles] fichas del par', errFichas.code)
    throw new Error('CRM_ERROR')
  }
  const lista = (fichas ?? []) as unknown as ContactoFila[]
  if (lista.length !== 2) return null

  const contar = async (contactoId: string) => {
    const { count } = await aplicarAlcance(
      supabase.from('crm_solicitudes').select('id', { count: 'exact', head: true })
        .or(`contacto_id.eq.${contactoId},empresa_id.eq.${contactoId}`),
      al.solicitudes,
    )
    return count ?? 0
  }
  const ficha = async (contactoId: string) => {
    const f = lista.find((x) => x.id === contactoId) as ContactoFila
    return { ...filaParaPantalla(f), solicitudes: await contar(contactoId) }
  }

  return {
    par: { id: par.id, coincidencia: par.coincidencia, estado: par.estado, created_at: par.created_at },
    a: await ficha(par.contacto_a),
    b: await ficha(par.contacto_b),
    puede_resolver: par.estado === 'pendiente' && puedeResolverDuplicados(personal.rol),
  }
}

// ─── Solicitudes ────────────────────────────────────────────────────────────

export type DetalleSolicitud = NonNullable<Awaited<ReturnType<typeof detalleSolicitud>>>

/**
 * Nivel «resumen» (asignación por confirmar) y «reducido» (externo): SOLO código, área, servicio, urgencia
 * y descripción (sección 4). Todo lo demás —contacto, canal, origen, motivos, conflicto, reserva,
 * tiempos— se anula para que ni la API ni la pantalla lo reciban. `area_principal_id` y `servicio_id`
 * se conservan solo para resolver sus nombres en el servidor.
 */
function resumirSolicitud(s: SolicitudFila): SolicitudFila {
  return {
    id: s.id,
    codigo: s.codigo,
    contacto_id: '',
    empresa_id: null,
    canal_origen: '',
    origen_tabla: null,
    origen_id: null,
    area_principal_id: s.area_principal_id,
    servicio_id: s.servicio_id,
    descripcion: s.descripcion,
    objetivo_cliente: null,
    modalidad: null,
    urgencia: s.urgencia,
    estado: s.estado,
    motivo_estado: null,
    estado_at: '',
    conflicto_revision: 'pendiente',
    requiere_validacion: false,
    reserva_reforzada: false,
    resultado_cierre: null,
    pendientes_cierre: null,
    fecha_recepcion: '',
    primera_respuesta_at: null,
    asignada_at: null,
    cerrada_at: null,
    created_by: null,
    created_at: '',
    updated_at: '',
  }
}

type ResumenContacto = Pick<ContactoFila, 'id' | 'tipo' | 'nombres' | 'apellidos' | 'razon_social' | 'correo' | 'telefono' | 'etapa_relacion' | 'reserva_reforzada'>

/**
 * Detalle de una solicitud con lo que la persona puede ver según su nivel de acceso (4.2):
 *   · completo / sin_juridico: datos y contacto (o «Contacto reservado» si no puede ver la ficha).
 *   · resumen / reducido: código, área, servicio, urgencia y descripción, SIN datos del contacto.
 * Devuelve `null` si no puede verla (las rutas responden 404).
 */
export async function detalleSolicitud(personal: Personal, id: string) {
  const nivel = await puedeVerSolicitud(personal, id)
  if (!nivel) return null

  const { data, error } = await supabase.from('crm_solicitudes').select(COLUMNAS_SOLICITUD).eq('id', id).maybeSingle()
  if (error) {
    console.error('[crm/detalles] solicitud', error.code)
    throw new Error('CRM_ERROR')
  }
  if (!data) return null
  const s = data as unknown as SolicitudFila
  const completa = nivel === 'completo' || nivel === 'sin_juridico'

  // Contacto y empresa: solo si el nivel lo permite Y puede ver la ficha.
  let contacto: (ResumenContacto & { nombre: string; completar_apellidos: boolean }) | { reservado: true } | null = null
  let empresa: { id: string; nombre: string } | { reservado: true } | null = null
  if (completa) {
    const al = await alcancesDe(personal)
    const ids = [s.contacto_id, ...(s.empresa_id ? [s.empresa_id] : [])]
    const visibles = await contactosVisiblesEntre(ids, al.contactos)
    if (visibles.size > 0) {
      const { data: fichas } = await supabase
        .from('crm_contactos')
        .select('id,tipo,nombres,apellidos,razon_social,correo,telefono,etapa_relacion,reserva_reforzada')
        .in('id', [...visibles])
      const lista = (fichas ?? []) as unknown as ResumenContacto[]
      const principal = lista.find((f) => f.id === s.contacto_id)
      contacto = principal ? filaParaPantalla(principal) : { reservado: true }
      if (s.empresa_id) {
        const e = lista.find((f) => f.id === s.empresa_id)
        empresa = e ? { id: e.id, nombre: nombreContacto(e) } : { reservado: true }
      }
    } else {
      contacto = { reservado: true }
      if (s.empresa_id) empresa = { reservado: true }
    }
  }

  // Área y servicio (catálogo E5; vacío si aún no existe).
  const catalogo = await obtenerCatalogo()
  const area = catalogo.areas.find((a) => a.id === s.area_principal_id)?.nombre ?? null
  const servicio = catalogo.servicios.find((x) => x.id === s.servicio_id)?.nombre ?? null

  // Historial de estados y registro de acciones (solo con acceso completo).
  const nombres = new Map<string, string>()
  const nombreDe = async (userIds: string[]) => {
    const faltan = [...new Set(userIds)].filter((u) => !nombres.has(u))
    if (faltan.length === 0) return
    const { data: p } = await supabase.from('crm_personal').select('user_id,nombres,apellidos').in('user_id', faltan)
    for (const f of (p ?? []) as { user_id: string; nombres: string; apellidos: string }[]) nombres.set(f.user_id, `${f.nombres} ${f.apellidos}`)
  }
  let historial: { id: number; estado_anterior: string | null; estado_nuevo: string; motivo: string | null; usuario: string | null; created_at: string }[] = []
  let registro: { id: number; accion: string; usuario: string | null; motivo: string | null; created_at: string }[] = []
  if (completa) {
    const { data: est } = await supabase
      .from('crm_solicitud_estados')
      .select('id,estado_anterior,estado_nuevo,motivo,user_id,created_at')
      .eq('solicitud_id', id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100)
    const filasEstado = (est ?? []) as { id: number; estado_anterior: string | null; estado_nuevo: string; motivo: string | null; user_id: string | null; created_at: string }[]

    let filasRegistro: { id: number; accion: string; user_id: string | null; motivo: string | null; created_at: string }[] = []
    if (puede(personal.rol, 'bitacora.ver_caso')) {
      const { data: reg } = await supabase
        .from('crm_bitacora')
        .select('id,accion,user_id,motivo,created_at')
        .eq('entidad', 'crm_solicitudes').eq('entidad_id', id)
        .order('id', { ascending: false }).limit(50)
      filasRegistro = (reg ?? []) as typeof filasRegistro
    }
    await nombreDe([...filasEstado, ...filasRegistro].map((f) => f.user_id).filter((u): u is string => !!u))
    historial = filasEstado.map((f) => ({ id: f.id, estado_anterior: f.estado_anterior, estado_nuevo: f.estado_nuevo, motivo: f.motivo, usuario: f.user_id ? (nombres.get(f.user_id) ?? null) : null, created_at: f.created_at }))
    registro = filasRegistro.map((f) => ({ id: f.id, accion: f.accion, usuario: f.user_id ? (nombres.get(f.user_id) ?? null) : null, motivo: f.motivo, created_at: f.created_at }))
  }

  // Qué puede hacer esta persona ahora.
  const estado = s.estado as Estado
  const { data: titular } = await supabase
    .from('crm_solicitud_equipo').select('id')
    .eq('solicitud_id', id).eq('personal_id', personal.id).eq('rol', 'titular').eq('estado', 'activo').limit(1)
  const ctx: ContextoEstado = { estado, requiereValidacion: s.requiere_validacion, esTitularActivo: (titular ?? []).length > 0, conflicto: s.conflicto_revision }
  const rol = personal.rol
  const cerrada = estado === 'cerrada'
  const abierta = completa && !cerrada
  const permitidos = completa ? estadosPermitidos(rol, ctx) : []

  return {
    nivel,
    solicitud: {
      ...(completa ? s : resumirSolicitud(s)),
      area,
      servicio,
      estado_etiqueta: ETIQUETA_ESTADO[estado] ?? s.estado,
    },
    contacto,
    empresa,
    historial,
    registro,
    estados_permitidos: permitidos.map((e) => ({
      valor: e,
      etiqueta: ETIQUETA_ESTADO[e],
      exige_motivo: exigeMotivo(estado, e),
      pide_cierre: e === 'cerrada',
    })),
    permisos: {
      editar: abierta && puedeEditarSolicitud(rol, nivel),
      marcar_reserva: abierta && puedeMarcarReservaEnCaso(rol, nivel),
      quitar_reserva: abierta && puedeQuitarReserva(rol),
      validar: completa && estado === 'nueva' && s.requiere_validacion && puedeValidarEnvios(rol),
    },
    solo_lectura: cerrada,
  }
}

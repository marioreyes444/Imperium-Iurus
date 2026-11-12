// Ingreso automático de entradas al CRM (sección 10). Contrato para el formulario web, las citas,
// y más adelante E1 y E3.
//
//   · NUNCA lanza excepciones: devuelve `{ ok: false }` y deja el error en el log del servidor SIN
//     datos personales.
//   · Si las tablas del CRM no existen (migraciones sin aplicar), devuelve `{ ok: false }` y listo.
//   · Los llamadores públicos (/api/contact, /api/appointments) lo usan DESPUÉS de guardar, a través de
//     `registrarEntradaSegura`, para que el CRM jamás haga fallar una reserva ni un mensaje del sitio.
import { supabase } from '@/lib/supabase'
import { esTablaAusente } from '@/lib/crm/errores'
import { normalizarCorreo, normalizarTelefono } from '@/lib/crm/normalizar'
import { validarIdentificacion, type TipoIdentificacion } from '@/lib/crm/identificacion'
import { registrarPosibleDuplicado } from '@/lib/crm/duplicados'
import { recalcularEtapa } from '@/lib/crm/etapas'
import { registrar } from '@/lib/crm/bitacora'
import { avisarSolicitudCritica } from '@/lib/crm/avisos'
import { esEnvioSospechoso } from '@/lib/crm/sospecha'

export type Entrada = {
  canal: 'web' | 'cita' | 'chat' | 'correo' | 'whatsapp' | 'llamada' | 'presencial' | 'referido'
  origen?: { tabla: 'consultas' | 'citas' | 'mensajes' | 'ia'; id: string }
  contacto: {
    nombres: string
    apellidos?: string
    correo?: string
    telefono?: string
    tipoIdentificacion?: string
    identificacion?: string
  }
  descripcion: string
  areaId?: string
  servicioId?: string
  urgencia?: 'critica' | 'alta' | 'media' | 'ordinaria'
  /** Fuerza `requiere_validacion = true` (además de los criterios de lib/crm/sospecha.ts). */
  sospechoso?: boolean
  /**
   * La solicitud nace con reserva reforzada (p. ej. el visitante marcó su consulta como confidencial).
   * NO marca la ficha del contacto como reservada: eso lo decide el personal.
   */
  reservaReforzada?: boolean
}

export type Resultado =
  | { ok: true; contactoId: string; solicitudId: string; codigo: string }
  | { ok: false; motivo: string }

const CORREO_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const falla = (motivo: string): Resultado => ({ ok: false, motivo })

type FichaMinima = { id: string; reserva_reforzada: boolean }

class TablasAusentes extends Error {}

/** Ejecuta una consulta y lanza `TablasAusentes` si el CRM no está instalado; otros errores se propagan como `Error` sin detalles. */
function verificar<T>(resultado: { data: T; error: { code?: string } | null }, etapa: string): T {
  if (resultado.error) {
    if (esTablaAusente(resultado.error)) throw new TablasAusentes()
    console.error(`[crm/ingesta] ${etapa}:`, resultado.error.code)
    throw new Error(`consulta fallida (${etapa})`)
  }
  return resultado.data
}

/**
 * Registra una entrada: busca o crea el contacto, crea la solicitud en `nueva` (o devuelve la que ya
 * existe para el mismo origen), vincula la cita, recalcula la etapa, deja bitácora automática
 * (`user_id = null`) y aplica R-16 si es crítica.
 */
export async function registrarEntrada(entrada: Entrada): Promise<Resultado> {
  try {
    const nombres = entrada.contacto.nombres?.trim().slice(0, 120)
    const descripcion = entrada.descripcion?.trim().slice(0, 5000)
    if (!nombres || !descripcion) return falla('datos_incompletos')

    // ── Idempotencia: la misma consulta o cita no genera dos solicitudes (R-11) ──
    if (entrada.origen) {
      const existente = await buscarPorOrigen(entrada.origen)
      if (existente) return existente
    }

    // ── Contacto ───────────────────────────────────────────────────────────
    const telefono = entrada.contacto.telefono?.trim().slice(0, 30) || null
    const telefonoNormalizado = telefono ? normalizarTelefono(telefono) : null
    const correoBruto = entrada.contacto.correo?.trim() || ''
    const correo = CORREO_VALIDO.test(correoBruto) && correoBruto.length <= 254 ? normalizarCorreo(correoBruto) : null
    const apellidos = entrada.contacto.apellidos?.trim().slice(0, 120) || null

    const ficha = await buscarOCrearContacto({
      nombres, apellidos, telefono, telefonoNormalizado, correo,
      tipoIdentificacion: entrada.contacto.tipoIdentificacion, identificacion: entrada.contacto.identificacion,
      canal: entrada.canal,
    })

    // ── Solicitud ──────────────────────────────────────────────────────────
    const requiereValidacion = entrada.sospechoso === true || esEnvioSospechoso({ texto: `${nombres} ${descripcion}`, telefono })
    const base = {
      contacto_id: ficha.id,
      canal_origen: entrada.canal,
      origen_tabla: entrada.origen?.tabla ?? null,
      origen_id: entrada.origen?.id ?? null,
      descripcion,
      urgencia: entrada.urgencia ?? 'ordinaria',
      requiere_validacion: requiereValidacion,
      // Nace reservada si la entrada lo pide O si el contacto ya es reservado.
      reserva_reforzada: entrada.reservaReforzada === true || ficha.reserva_reforzada,
    }
    const conArea = { ...base, area_principal_id: entrada.areaId ?? null, servicio_id: entrada.servicioId ?? null }

    let { data, error } = await supabase.from('crm_solicitudes').insert(conArea).select('id,codigo,urgencia,reserva_reforzada').single()
    // R-15: si el área o el servicio no están activos, se registra igual, sin calificar.
    if (error?.code === 'P0001' && /CRM-R15/.test(error.message ?? '') && (entrada.areaId || entrada.servicioId)) {
      ;({ data, error } = await supabase.from('crm_solicitudes').insert(base).select('id,codigo,urgencia,reserva_reforzada').single())
    }
    if (error) {
      // Carrera con otro reintento: ya existe la solicitud de este origen.
      if (error.code === '23505' && entrada.origen) {
        const existente = await buscarPorOrigen(entrada.origen)
        if (existente) return existente
      }
      if (esTablaAusente(error)) throw new TablasAusentes()
      console.error('[crm/ingesta] crear solicitud:', error.code)
      return falla('no_se_pudo_crear_la_solicitud')
    }
    const sol = data as { id: string; codigo: string; urgencia: string; reserva_reforzada: boolean }

    // ── Efectos posteriores (cada uno protegido: ninguno deshace la solicitud) ──
    await protegido('vincular cita', async () => {
      if (entrada.origen?.tabla !== 'citas') return
      const { error: errCita } = await supabase
        .from('citas').update({ solicitud_id: sol.id }).eq('id', entrada.origen.id).is('solicitud_id', null)
      // 42703: la columna aún no existe (M5 sin aplicar).
      if (errCita && errCita.code !== '42703') console.error('[crm/ingesta] vincular cita:', errCita.code)
    })
    await protegido('etapa', () => recalcularEtapa(ficha.id, { solicitudNueva: true }))
    await protegido('bitácora', async () => {
      await registrar({
        userId: null, accion: 'crear', entidad: 'crm_solicitudes', entidadId: sol.id,
        despues: { codigo: sol.codigo, canal_origen: entrada.canal, urgencia: sol.urgencia, requiere_validacion: requiereValidacion },
      })
    })
    if (sol.urgencia === 'critica') {
      await protegido('aviso', () => avisarSolicitudCritica({ id: sol.id, codigo: sol.codigo, reservada: sol.reserva_reforzada }))
    }

    return { ok: true, contactoId: ficha.id, solicitudId: sol.id, codigo: sol.codigo }
  } catch (e) {
    if (e instanceof TablasAusentes) {
      console.error('[crm/ingesta] el CRM no está disponible en este entorno (¿migraciones M4/M5 sin aplicar?)')
      return falla('crm_no_disponible')
    }
    // Solo el nombre del error: nunca su mensaje (podría llevar datos del visitante).
    console.error('[crm/ingesta] error inesperado:', e instanceof Error ? e.name : 'error')
    return falla('error_inesperado')
  }
}

async function protegido(etapa: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    console.error(`[crm/ingesta] ${etapa}:`, e instanceof Error ? e.name : 'error')
  }
}

async function buscarPorOrigen(origen: NonNullable<Entrada['origen']>): Promise<Resultado | null> {
  const data = verificar(
    await supabase.from('crm_solicitudes').select('id,codigo,contacto_id')
      .eq('origen_tabla', origen.tabla).eq('origen_id', origen.id).limit(1),
    'buscar origen',
  )
  const f = (data ?? [])[0] as { id: string; codigo: string; contacto_id: string } | undefined
  return f ? { ok: true, contactoId: f.contacto_id, solicitudId: f.id, codigo: f.codigo } : null
}

/**
 * Con identificación: busca la ficha vigente por tipo y número. Sin ella: si teléfono Y correo
 * normalizados coinciden con UNA única ficha vigente, la reutiliza; si coincide solo uno o hay varias,
 * crea una ficha nueva y registra el posible duplicado (R-04). Nunca sobrescribe datos existentes.
 */
async function buscarOCrearContacto(d: {
  nombres: string; apellidos: string | null; telefono: string | null; telefonoNormalizado: string | null
  correo: string | null; tipoIdentificacion?: string; identificacion?: string; canal: Entrada['canal']
}): Promise<FichaMinima> {
  // 1) Identificación válida → ficha vigente con ese tipo y número.
  let ident: { tipo: TipoIdentificacion; numero: string; validada: boolean } | null = null
  if (d.tipoIdentificacion && d.identificacion) {
    const r = validarIdentificacion(d.tipoIdentificacion as TipoIdentificacion, d.identificacion)
    if (r.ok) ident = { tipo: d.tipoIdentificacion as TipoIdentificacion, numero: r.identificacion, validada: r.validada }
  }
  if (ident) {
    const data = verificar(
      await supabase.from('crm_contactos').select('id,reserva_reforzada')
        .eq('tipo_identificacion', ident.tipo).eq('identificacion', ident.numero).is('fusionado_en', null).limit(1),
      'buscar por identificación',
    )
    const f = (data ?? [])[0] as FichaMinima | undefined
    if (f) return f
  }

  // 2) Sin identificación: coincidencias por teléfono y correo normalizados.
  const porTelefono = d.telefonoNormalizado ? await fichasPor('telefono_normalizado', d.telefonoNormalizado) : []
  const porCorreo = d.correo ? await fichasPor('correo_normalizado', d.correo) : []
  if (!ident && d.telefonoNormalizado && d.correo) {
    const ambos = porTelefono.filter((t) => porCorreo.some((c) => c.id === t.id))
    if (ambos.length === 1) return ambos[0]
  }

  // 3) Ficha nueva (con identificación solo si es válida y no existía).
  const { data: creada, error } = await supabase
    .from('crm_contactos')
    .insert({
      tipo: 'persona',
      nombres: d.nombres,
      apellidos: d.apellidos,
      telefono: d.telefono,
      telefono_normalizado: d.telefonoNormalizado,
      correo: d.correo,
      canal_primer_contacto: d.canal,
      ...(ident ? { tipo_identificacion: ident.tipo, identificacion: ident.numero, identificacion_validada: ident.validada } : {}),
    })
    .select('id,reserva_reforzada')
    .single()
  if (error) {
    if (esTablaAusente(error)) throw new TablasAusentes()
    console.error('[crm/ingesta] crear contacto:', error.code)
    throw new Error('no se pudo crear el contacto')
  }
  const nueva = creada as FichaMinima

  // R-04: cada coincidencia por teléfono o correo queda como posible duplicado a revisar.
  await protegido('posibles duplicados', async () => {
    for (const t of porTelefono) await registrarPosibleDuplicado(nueva.id, t.id, 'telefono')
    for (const c of porCorreo) await registrarPosibleDuplicado(nueva.id, c.id, 'correo')
  })
  return nueva
}

async function fichasPor(columna: 'telefono_normalizado' | 'correo_normalizado', valor: string): Promise<FichaMinima[]> {
  const data = verificar(
    await supabase.from('crm_contactos').select('id,reserva_reforzada').eq(columna, valor).is('fusionado_en', null).limit(20),
    'buscar coincidencias',
  )
  return (data ?? []) as FichaMinima[]
}

/**
 * Llamada desde las rutas públicas. Construye la entrada y la registra dentro de un try/catch: cualquier
 * fallo (incluido un error al armar la entrada) queda en el log con SOLO el nombre del error, sin datos
 * personales, y el formulario público sigue funcionando exactamente igual.
 */
export async function registrarEntradaSegura(contexto: string, construir: () => Entrada): Promise<void> {
  try {
    const r = await registrarEntrada(construir())
    if (!r.ok) console.error(`[${contexto}] CRM no registró la entrada: ${r.motivo}`)
  } catch (e) {
    console.error(`[${contexto}] CRM no registró la entrada:`, e instanceof Error ? e.name : 'error')
  }
}

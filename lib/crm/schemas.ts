// Esquemas Zod del CRM. Valida en el servidor; el navegador no importa este archivo.
import { z } from 'zod'
import { ROLES } from '@/lib/crm/roles'
import { ACCIONES_BITACORA } from '@/lib/crm/bitacora'
import { LIMITE_LISTADO, LIMITE_LISTADO_MAX } from '@/lib/crm/config'
import { normalizarCorreo, normalizarTelefono } from '@/lib/crm/normalizar'
import { TIPOS_IDENTIFICACION, validarIdentificacion } from '@/lib/crm/identificacion'

/** Texto: trim y cadena vacía → null. */
const vacioANull = (v: unknown) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v)

const textoOpcional = (max: number) =>
  z.preprocess(vacioANull, z.string().max(max, `Máximo ${max} caracteres`).nullable().optional())

const nombre = z
  .string({ required_error: 'Obligatorio', invalid_type_error: 'Texto no válido' })
  .trim()
  .min(2, 'Mínimo 2 caracteres')
  .max(120, 'Máximo 120 caracteres')

/** Teléfono opcional normalizado a E.164. undefined se conserva (útil en PATCH). */
const telefonoOpcional = z
  .preprocess(vacioANull, z.string().nullable().optional())
  .transform((valor, ctx) => {
    if (valor === undefined) return undefined
    if (valor === null) return null
    const e164 = normalizarTelefono(valor)
    if (!e164) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Teléfono no válido (ej. 0991234567)' })
      return z.NEVER
    }
    return e164
  })

const correo = z
  .string({ required_error: 'Obligatorio' })
  .trim()
  .max(254, 'Máximo 254 caracteres')
  .email('Correo no válido')
  .transform(normalizarCorreo)

export const uuidSchema = z.string().uuid('Identificador inválido')

const motivo = z.preprocess(
  vacioANull,
  z.string().min(5, 'Mínimo 5 caracteres').max(500, 'Máximo 500 caracteres').nullable().optional(),
)

// ─── Usuarios (crm_personal) ────────────────────────────────────────────────

export const usuarioCrearSchema = z.object({
  nombres: nombre,
  apellidos: nombre,
  correo,
  rol: z.enum(ROLES, { errorMap: () => ({ message: 'Rol no válido' }) }),
  telefono: telefonoOpcional,
  ciudad: textoOpcional(80),
  matricula: textoOpcional(40),
  es_abogado: z.boolean().optional(),
})
export type UsuarioCrear = z.infer<typeof usuarioCrearSchema>

export const usuarioEditarSchema = z
  .object({
    /** updated_at que tenía el cliente: control de edición simultánea. */
    updated_at: z.string().min(1, 'Falta la versión del registro').max(64),
    nombres: nombre.optional(),
    apellidos: nombre.optional(),
    telefono: telefonoOpcional,
    ciudad: textoOpcional(80),
    matricula: textoOpcional(40),
    rol: z.enum(ROLES, { errorMap: () => ({ message: 'Rol no válido' }) }).optional(),
    activo: z.boolean().optional(),
    motivo,
  })
  .refine(
    (d) => ['nombres', 'apellidos', 'telefono', 'ciudad', 'matricula', 'rol', 'activo'].some(
      (k) => (d as Record<string, unknown>)[k] !== undefined,
    ),
    { message: 'No hay cambios que guardar', path: ['_'] },
  )
export type UsuarioEditar = z.infer<typeof usuarioEditarSchema>

// ─── Parámetros de listados ─────────────────────────────────────────────────

/** URLSearchParams → objeto, descartando parámetros vacíos. */
export function queryComoObjeto(params: URLSearchParams): Record<string, string> {
  const salida: Record<string, string> = {}
  params.forEach((valor, clave) => {
    if (valor.trim() !== '') salida[clave] = valor
  })
  return salida
}

const paginacion = z.object({
  cursor: z.string().max(200).optional(),
  limite: z.coerce.number().int().min(1).max(LIMITE_LISTADO_MAX).default(LIMITE_LISTADO),
})

const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)')

export const usuariosQuerySchema = paginacion.extend({
  q: z.string().max(80).optional(),
  rol: z.enum(ROLES).optional(),
  activo: z.enum(['true', 'false']).optional(),
})

export const bitacoraQuerySchema = paginacion.extend({
  entidad: z.string().regex(/^[a-z_]{1,40}$/, 'Entidad inválida').optional(),
  entidad_id: uuidSchema.optional(),
  usuario: uuidSchema.optional(),
  accion: z.enum(ACCIONES_BITACORA).optional(),
  desde: fechaISO.optional(),
  hasta: fechaISO.optional(),
})

// ═══════════════════════════════════════════════════════════════════════════
// ENTREGA 2 — Captación: contactos, duplicados y solicitudes
// ═══════════════════════════════════════════════════════════════════════════

export const CANALES = ['web', 'cita', 'chat', 'correo', 'whatsapp', 'llamada', 'presencial', 'referido'] as const
/** Canales que el personal puede elegir al registrar una solicitud a mano (web y cita son automáticos). */
export const CANALES_MANUALES = ['llamada', 'presencial', 'whatsapp', 'correo', 'chat', 'referido'] as const
export const URGENCIAS = ['critica', 'alta', 'media', 'ordinaria'] as const
export const MODALIDADES = ['judicial', 'administrativa', 'extrajudicial', 'notarial'] as const
export const PREFERENCIAS = ['whatsapp', 'correo', 'llamada'] as const

const enumOpcional = <T extends readonly [string, ...string[]]>(valores: T) =>
  z.preprocess(vacioANull, z.enum(valores).nullable().optional())

const uuidOpcional = z.preprocess(vacioANull, uuidSchema.nullable().optional())

const correoOpcional = z.preprocess(
  vacioANull,
  z.string().max(254, 'Máximo 254 caracteres').email('Correo no válido').transform(normalizarCorreo).nullable().optional(),
)

/** Motivo obligatorio (5 a 500) donde la regla lo exige. */
export const motivoObligatorio = z
  .string({ required_error: 'Indica el motivo' })
  .trim()
  .min(5, 'Mínimo 5 caracteres')
  .max(500, 'Máximo 500 caracteres')

// ─── Contactos ──────────────────────────────────────────────────────────────

const camposContacto = {
  nombres: textoOpcional(120),
  apellidos: textoOpcional(120),
  ocupacion: textoOpcional(120),
  razon_social: textoOpcional(120),
  nombre_comercial: textoOpcional(120),
  sector: textoOpcional(120),
  tipo_identificacion: enumOpcional(TIPOS_IDENTIFICACION),
  identificacion: textoOpcional(30),
  telefono: textoOpcional(30),
  correo: correoOpcional,
  ciudad: textoOpcional(80),
  direccion: textoOpcional(200),
  preferencia_comunicacion: enumOpcional(PREFERENCIAS),
  canal_primer_contacto: enumOpcional(CANALES),
  como_nos_conocio: textoOpcional(200),
  notas_internas: textoOpcional(2000),
}

type CamposContacto = {
  tipo_identificacion?: (typeof TIPOS_IDENTIFICACION)[number] | null
  identificacion?: string | null
  telefono?: string | null
}

/**
 * Normaliza teléfono e identificación de un contacto. Cédula inválida y teléfono imposible → error de
 * campo (400). RUC con dígito verificador que no cuadra → se acepta con `identificacion_validada = false`.
 */
function normalizarCamposContacto<T extends CamposContacto>(d: T, ctx: z.RefinementCtx) {
  const extra: { telefono_normalizado?: string | null; identificacion_validada?: boolean } = {}
  let identificacion = d.identificacion

  if (d.telefono !== undefined) {
    if (d.telefono === null) extra.telefono_normalizado = null
    else {
      const e164 = normalizarTelefono(d.telefono)
      if (!e164) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['telefono'], message: 'Teléfono no válido (ej. 0991234567)' })
      else extra.telefono_normalizado = e164
    }
  }

  if (d.tipo_identificacion !== undefined || d.identificacion !== undefined) {
    if ((d.tipo_identificacion == null) !== (d.identificacion == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [d.tipo_identificacion == null ? 'tipo_identificacion' : 'identificacion'],
        message: 'Indica el tipo y el número de identificación',
      })
    } else if (d.tipo_identificacion != null && d.identificacion != null) {
      const r = validarIdentificacion(d.tipo_identificacion, d.identificacion)
      if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['identificacion'], message: r.mensaje })
      else {
        identificacion = r.identificacion
        extra.identificacion_validada = r.validada
      }
    } else {
      extra.identificacion_validada = false // identificación quitada
    }
  }
  return { ...d, identificacion, ...extra }
}

export const contactoCrearSchema = z
  .object({ tipo: z.enum(['persona', 'empresa']).default('persona'), ...camposContacto })
  .transform((d, ctx) => {
    if (d.tipo === 'persona' && (!d.nombres || d.nombres.length < 2)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nombres'], message: 'Los nombres son obligatorios (mínimo 2 caracteres)' })
    }
    if (d.tipo === 'empresa' && (!d.razon_social || d.razon_social.length < 2)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['razon_social'], message: 'La razón social es obligatoria (mínimo 2 caracteres)' })
    }
    if (d.tipo === 'empresa' && d.tipo_identificacion && !['ruc', 'extranjera'].includes(d.tipo_identificacion)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tipo_identificacion'], message: 'Una empresa se identifica con RUC o identificación extranjera' })
    }
    return normalizarCamposContacto(d, ctx)
  })
export type ContactoCrear = z.infer<typeof contactoCrearSchema>

export const contactoEditarSchema = z
  .object({
    updated_at: z.string().min(1, 'Falta la versión del registro').max(64),
    ...camposContacto,
    /** Marcar: Dirección y coordinación. Quitar: solo Dirección. */
    reserva_reforzada: z.boolean().optional(),
    /** `no_continua` exige motivo (R-06). `reanudar` recalcula la etapa. */
    etapa_manual: z.enum(['no_continua', 'reanudar']).optional(),
    motivo_no_continua: motivo,
  })
  .transform((d, ctx) => {
    if (d.etapa_manual === 'no_continua' && !d.motivo_no_continua) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['motivo_no_continua'], message: 'Indica el motivo (mínimo 5 caracteres)' })
    }
    return normalizarCamposContacto(d, ctx)
  })
export type ContactoEditar = z.infer<typeof contactoEditarSchema>

export const contactosQuerySchema = paginacion.extend({
  q: z.string().max(80).optional(),
  tipo: z.enum(['persona', 'empresa']).optional(),
  etapa: z.string().regex(/^[a-z_]{1,30}$/).optional(),
  incluir_fusionados: z.enum(['true']).optional(),
})

export const vinculoSchema = z.object({
  empresa_id: uuidSchema,
  persona_id: uuidSchema,
  cargo: textoOpcional(120),
  es_representante_legal: z.boolean().optional(),
  documento_representacion: textoOpcional(200),
})

export const vinculoBorrarSchema = z.object({ empresa_id: uuidSchema, persona_id: uuidSchema })

// ─── Duplicados ─────────────────────────────────────────────────────────────

export const duplicadoCrearSchema = z
  .object({
    contacto_a: uuidSchema,
    contacto_b: uuidSchema,
    coincidencia: z.enum(['telefono', 'correo', 'nombre']),
  })
  .refine((d) => d.contacto_a !== d.contacto_b, { message: 'Elige dos fichas distintas', path: ['contacto_b'] })

export const duplicadoFusionarSchema = z.object({
  /** Ficha que se conserva; la otra queda como fusionada. */
  conserva: uuidSchema,
  /** Acción delicada: motivo obligatorio (9.4). */
  motivo: motivoObligatorio,
})

export const duplicadoDescartarSchema = z.object({ motivo: motivoObligatorio })

export const duplicadosQuerySchema = paginacion.extend({
  estado: z.enum(['pendiente', 'fusionado', 'descartado']).default('pendiente'),
})

// ─── Solicitudes ────────────────────────────────────────────────────────────

const camposCalificacion = {
  descripcion: z.string({ required_error: 'Obligatoria' }).trim().min(10, 'Mínimo 10 caracteres').max(5000, 'Máximo 5000 caracteres'),
  objetivo_cliente: textoOpcional(2000),
  modalidad: enumOpcional(MODALIDADES),
  urgencia: z.enum(URGENCIAS, { errorMap: () => ({ message: 'Urgencia no válida' }) }),
  area_principal_id: uuidOpcional,
  servicio_id: uuidOpcional,
  empresa_id: uuidOpcional,
}

export const solicitudCrearSchema = z.object({
  contacto_id: uuidSchema,
  canal_origen: z.enum(CANALES_MANUALES, { errorMap: () => ({ message: 'Canal no válido' }) }),
  ...camposCalificacion,
  urgencia: camposCalificacion.urgencia.default('ordinaria'),
  reserva_reforzada: z.boolean().optional(),
})
export type SolicitudCrear = z.infer<typeof solicitudCrearSchema>

/** Solo datos de calificación; NUNCA el estado (eso es POST …/estado). */
export const solicitudEditarSchema = z
  .object({
    updated_at: z.string().min(1, 'Falta la versión del registro').max(64),
    descripcion: camposCalificacion.descripcion.optional(),
    objetivo_cliente: camposCalificacion.objetivo_cliente,
    modalidad: camposCalificacion.modalidad,
    urgencia: camposCalificacion.urgencia.optional(),
    area_principal_id: camposCalificacion.area_principal_id,
    servicio_id: camposCalificacion.servicio_id,
    empresa_id: camposCalificacion.empresa_id,
    reserva_reforzada: z.boolean().optional(),
  })
  .refine(
    (d) => Object.entries(d).some(([k, v]) => k !== 'updated_at' && v !== undefined),
    { message: 'No hay cambios que guardar', path: ['_'] },
  )

export const ESTADOS_SOLICITUD = [
  'nueva', 'en_calificacion', 'pendiente_informacion', 'consulta_agendada', 'propuesta_enviada',
  'pendiente_aceptacion', 'aceptada_pendiente_asignacion', 'asignada', 'en_curso', 'en_espera',
  'cerrada', 'descartada',
] as const

export const estadoCambiarSchema = z.object({
  hacia: z.enum(ESTADOS_SOLICITUD, { errorMap: () => ({ message: 'Estado no válido' }) }),
  motivo,
  resultado_cierre: textoOpcional(2000),
  pendientes_cierre: textoOpcional(2000),
})

export const validarSolicitudSchema = z.object({
  accion: z.enum(['validar', 'descartar'], { errorMap: () => ({ message: 'Acción no válida' }) }),
  motivo,
})

export const solicitudesQuerySchema = paginacion.extend({
  q: z.string().max(80).optional(),
  estado: z.enum(ESTADOS_SOLICITUD).optional(),
  urgencia: z.enum(URGENCIAS).optional(),
  area: uuidSchema.optional(),
  validacion: z.enum(['true']).optional(),
  contacto: uuidSchema.optional(),
})

// ═══════════════════════════════════════════════════════════════════════════
// ENTREGA 3 — Asignación: personal, conflictos y equipo
// ═══════════════════════════════════════════════════════════════════════════

export const ROLES_EQUIPO = ['titular', 'suplente', 'coordinador', 'apoyo', 'perito'] as const
export const MOTIVOS_REASIGNACION = [
  'ausencia', 'vacaciones', 'exceso_carga', 'impedimento',
  'conflicto_interes', 'especialidad_complementaria', 'inactividad', 'otro',
] as const

export const personalQuerySchema = paginacion.extend({
  q: z.string().max(80).optional(),
  rol: z.enum(ROLES).optional(),
  abogados: z.enum(['true']).optional(),
})

const fechaOpcional = z.preprocess(
  vacioANull,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)').nullable().optional(),
)

/** Datos profesionales, habilitación y capacidad. El rol y `activo` se cambian en Usuarios (solo Dirección). */
export const personalEditarSchema = z
  .object({
    updated_at: z.string().min(1, 'Falta la versión del registro').max(64),
    es_abogado: z.boolean().optional(),
    matricula: textoOpcional(40),
    habilitacion_verificada: z.boolean().optional(),
    especialidad: textoOpcional(120),
    capacidad_maxima: z.preprocess(
      (v) => (v === '' ? null : v),
      z.number({ invalid_type_error: 'Número no válido' }).int('Debe ser un entero').positive('Debe ser mayor que cero').max(1000).nullable().optional(),
    ),
    fecha_vinculacion: fechaOpcional,
    acuerdo_confidencialidad: z.boolean().optional(),
    ciudad: textoOpcional(80),
  })
  .refine(
    (d) => Object.entries(d).some(([k, v]) => k !== 'updated_at' && v !== undefined),
    { message: 'No hay cambios que guardar', path: ['_'] },
  )

/** Reemplaza las áreas de referencia de una persona. */
export const personalAreasSchema = z.object({
  areas: z
    .array(z.object({
      area_id: uuidSchema,
      rol_referencia: z.enum(['titular', 'suplente', 'miembro'], { errorMap: () => ({ message: 'Rol de referencia no válido' }) }),
      competencia_acreditada: z.boolean().optional(),
    }))
    .max(100, 'Demasiadas áreas')
    .refine((a) => new Set(a.map((x) => x.area_id)).size === a.length, 'Un área no puede repetirse'),
})

export const conflictoSchema = z.object({
  resultado: z.enum(['sin_conflicto', 'con_conflicto'], { errorMap: () => ({ message: 'Resultado no válido' }) }),
  detalle: z.string({ required_error: 'Indica el detalle de la revisión' }).trim().min(5, 'Mínimo 5 caracteres').max(2000, 'Máximo 2000 caracteres'),
})

export const equipoProponerSchema = z.object({
  personal_id: uuidSchema,
  rol: z.enum(ROLES_EQUIPO, { errorMap: () => ({ message: 'Rol de equipo no válido' }) }),
  funciones: textoOpcional(500),
})

/** Capacidad: si la base responde R-26, la pantalla reintenta con `supera_capacidad` y su motivo. */
const capacidad = {
  supera_capacidad: z.boolean().optional(),
  motivo_capacidad: z.preprocess(vacioANull, z.string().min(5, 'Mínimo 5 caracteres').max(500, 'Máximo 500 caracteres').nullable().optional()),
}
const exigirMotivoCapacidad = (d: { supera_capacidad?: boolean; motivo_capacidad?: string | null }) =>
  !d.supera_capacidad || !!d.motivo_capacidad

export const equipoAprobarSchema = z
  .object(capacidad)
  .refine(exigirMotivoCapacidad, { message: 'Indica el motivo para superar la capacidad', path: ['motivo_capacidad'] })

export const equipoResponderSchema = z
  .object({ acepta: z.boolean({ required_error: 'Indica si aceptas', invalid_type_error: 'Valor no válido' }), motivo })
  .refine((d) => d.acepta || !!d.motivo, { message: 'Indica el motivo del rechazo (mínimo 5 caracteres)', path: ['motivo'] })

export const equipoFinalizarSchema = z.object({ motivo: motivoObligatorio })

export const reasignarSchema = z
  .object({
    nuevo_titular_id: uuidSchema,
    motivo: z.enum(MOTIVOS_REASIGNACION, { errorMap: () => ({ message: 'Motivo no válido' }) }),
    detalle: textoOpcional(1000),
    entrega_documentada: z.boolean().optional(),
    ...capacidad,
  })
  .refine(exigirMotivoCapacidad, { message: 'Indica el motivo para superar la capacidad', path: ['motivo_capacidad'] })

// ═══════════════════════════════════════════════════════════════════════════
// ENTREGA 4 — Agenda y seguimiento: horarios, bloqueos, citas, actividades, expediente, avisos
// ═══════════════════════════════════════════════════════════════════════════

const horaHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)')
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))

/** `YYYY-MM-DDTHH:MM` (hora de Guayaquil) tal como lo envía un campo datetime-local. */
const fechaHoraLocal = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'Fecha y hora inválidas')
const fechaHoraLocalOpcional = z.preprocess(vacioANull, fechaHoraLocal.nullable().optional())

const franjaSchema = z
  .object({
    dia_semana: z.number({ invalid_type_error: 'Día no válido' }).int().min(1, 'Día no válido').max(7, 'Día no válido'),
    hora_inicio: horaHHMM,
    hora_fin: horaHHMM,
  })
  .refine((f) => minutos(f.hora_fin) > minutos(f.hora_inicio), { message: 'La hora final debe ser posterior a la inicial', path: ['hora_fin'] })

/** PUT de horarios: reemplaza la semana. Varias franjas por día (p. ej. para dejar libre el almuerzo). */
export const horariosSchema = z.object({
  franjas: z.array(franjaSchema).max(70, 'Demasiadas franjas').superRefine((franjas, ctx) => {
    for (let i = 0; i < franjas.length; i++) {
      for (let j = i + 1; j < franjas.length; j++) {
        const a = franjas[i]
        const b = franjas[j]
        if (a.dia_semana === b.dia_semana
          && minutos(a.hora_inicio) < minutos(b.hora_fin) && minutos(b.hora_inicio) < minutos(a.hora_fin)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Esa franja se cruza con otra del mismo día', path: [j, 'hora_inicio'] })
        }
      }
    }
  }),
})
export type FranjaEntrada = z.infer<typeof franjaSchema>

export const TIPOS_BLOQUEO = ['vacaciones', 'audiencia', 'permiso', 'otro'] as const

export const bloqueoCrearSchema = z
  .object({
    desde: fechaHoraLocal,
    hasta: fechaHoraLocal,
    tipo: z.enum(TIPOS_BLOQUEO, { errorMap: () => ({ message: 'Tipo no válido' }) }).default('otro'),
    motivo: textoOpcional(500),
  })
  .refine((b) => b.hasta > b.desde, { message: 'El fin debe ser posterior al inicio', path: ['hasta'] })

export const bloqueoBorrarSchema = z.object({ bloqueo_id: uuidSchema })

const duracionCita = z.coerce
  .number({ invalid_type_error: 'Duración no válida' })
  .int()
  .min(15, 'Mínimo 15 minutos')
  .max(480, 'Máximo 480 minutos')
  .refine((d) => d % 15 === 0, 'Debe ser múltiplo de 15')

export const disponibilidadQuerySchema = z
  .object({
    abogado_id: uuidSchema,
    desde: fechaISO,
    hasta: fechaISO,
    duracion: duracionCita.optional(),
    /** Cita que se está reagendando: no cuenta como ocupada. */
    excluir: uuidSchema.optional(),
  })
  .refine((d) => d.hasta >= d.desde, { message: 'El rango no es válido', path: ['hasta'] })

export const ORIGENES_CANCELACION = ['cliente', 'estudio', 'abogado'] as const

/** La duración no se recibe: es DURACION_CITA_MIN (R-34). */
export const citaCrearSchema = z.object({
  solicitud_id: uuidSchema,
  abogado_id: uuidSchema,
  fecha: fechaISO,
  hora: horaHHMM,
  mensaje: textoOpcional(1000),
  reagendada_de: uuidOpcional,
})

export const citaEditarSchema = z.discriminatedUnion('accion', [
  /** Reagendar (fecha/hora) o asignar abogado a la misma cita. */
  z.object({ accion: z.literal('reprogramar'), fecha: fechaISO, hora: horaHHMM, abogado_id: uuidSchema }),
  z.object({ accion: z.literal('confirmar') }),
  /** R-39: solo en citas cuya hora ya pasó. */
  z.object({ accion: z.literal('marcar'), resultado: z.enum(['atendida', 'no_asistio'], { errorMap: () => ({ message: 'Resultado no válido' }) }) }),
], { errorMap: () => ({ message: 'Acción no válida' }) })

export const citaCancelarSchema = z.object({
  origen: z.enum(ORIGENES_CANCELACION, { errorMap: () => ({ message: 'Indica quién cancela' }) }),
  motivo: motivoObligatorio,
})

export const citasQuerySchema = z
  .object({
    desde: fechaISO.optional(),
    hasta: fechaISO.optional(),
    abogado_id: uuidSchema.optional(),
    solicitud_id: uuidSchema.optional(),
  })
  .refine((d) => !!d.solicitud_id || (!!d.desde && !!d.hasta), { message: 'Indica el rango de fechas o la solicitud', path: ['desde'] })
  .refine((d) => !d.desde || !d.hasta || d.hasta >= d.desde, { message: 'El rango no es válido', path: ['hasta'] })

/** Tipos que el personal registra a mano; `cambio_estado`, `asignacion`, `cita` y `sistema` son automáticos. */
export const TIPOS_ACTIVIDAD = ['llamada', 'reunion', 'mensaje', 'actuacion', 'tarea', 'nota'] as const
/** `crm_actividades.canal` no tiene CHECK en la base: se limita aquí. Correo = tipo «mensaje» con canal «correo». */
export const CANALES_ACTIVIDAD = ['telefono', 'whatsapp', 'correo', 'presencial', 'videollamada', 'otro'] as const

export const actividadCrearSchema = z
  .object({
    solicitud_id: uuidSchema,
    tipo: z.enum(TIPOS_ACTIVIDAD, { errorMap: () => ({ message: 'Tipo no válido' }) }),
    canal: enumOpcional(CANALES_ACTIVIDAD),
    descripcion: z.string({ required_error: 'Obligatoria' }).trim().min(2, 'Mínimo 2 caracteres').max(5000, 'Máximo 5000 caracteres'),
    resultado: textoOpcional(2000),
    es_juridica: z.boolean().optional().default(false),
    responsable_id: uuidOpcional,
    vence_at: fechaHoraLocalOpcional,
    es_plazo_juridico: z.boolean().optional().default(false),
  })
  .superRefine((d, ctx) => {
    if (d.tipo === 'tarea') {
      if (!d.responsable_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Indica el responsable', path: ['responsable_id'] })
      if (!d.vence_at) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Indica el vencimiento', path: ['vence_at'] })
    } else if (d.es_plazo_juridico) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Un plazo jurídico es una tarea', path: ['es_plazo_juridico'] })
    }
  })
export type ActividadCrear = z.infer<typeof actividadCrearSchema>

export const actividadEditarSchema = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('completar'), resultado: textoOpcional(2000) }),
  z.object({ accion: z.literal('cancelar') }),
  z.object({ accion: z.literal('verificar_plazo') }),
  z.object({ accion: z.literal('reprogramar'), vence_at: fechaHoraLocalOpcional, responsable_id: uuidOpcional }),
], { errorMap: () => ({ message: 'Acción no válida' }) })

export const actividadesQuerySchema = paginacion.extend({
  /** Cronología de un caso. */
  solicitud_id: uuidSchema.optional(),
  /** Bandeja de tareas: las propias o todas las de los casos visibles. */
  tareas: z.enum(['mias', 'todas']).optional(),
  estado: z.enum(['pendiente', 'hecha', 'cancelada', 'todas']).default('pendiente'),
})

const textoExpediente = (max: number) => textoOpcional(max)
export const expedienteSchema = z.object({
  /** null = el expediente aún no existe. */
  updated_at: z.string().max(64).nullable(),
  numero_proceso: textoExpediente(80),
  autoridad: textoExpediente(200),
  contraparte: textoExpediente(200),
  etapa_procesal: textoExpediente(200),
  estado_procesal: textoExpediente(200),
  ultimo_acto: textoExpediente(1000),
  ultimo_acto_at: fechaOpcional,
})

export const notificacionesQuerySchema = paginacion.extend({
  leidas: z.enum(['true', 'false', 'todas']).default('false'),
})

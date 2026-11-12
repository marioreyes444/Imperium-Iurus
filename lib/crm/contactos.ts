import { supabase } from '@/lib/supabase'
import { esTablaAusente } from '@/lib/crm/errores'
import { CrmNoDisponibleError } from '@/lib/crm/permisos'

/** Ficha completa (detalle y edición). `correo_normalizado` y `busqueda` son generadas: no se escriben. */
export const COLUMNAS_CONTACTO =
  'id,tipo,nombres,apellidos,ocupacion,razon_social,nombre_comercial,sector,tipo_identificacion,identificacion,' +
  'identificacion_validada,telefono,telefono_normalizado,correo,ciudad,direccion,preferencia_comunicacion,' +
  'etapa_relacion,motivo_no_continua,canal_primer_contacto,como_nos_conocio,notas_internas,reserva_reforzada,' +
  'fusionado_en,archivado_at,created_at,updated_at'

/** Columnas del listado. */
export const COLUMNAS_LISTA_CONTACTO =
  'id,tipo,nombres,apellidos,razon_social,tipo_identificacion,identificacion,identificacion_validada,' +
  'telefono,correo,etapa_relacion,reserva_reforzada,fusionado_en,created_at,updated_at'

export type ContactoFila = {
  id: string
  tipo: 'persona' | 'empresa'
  nombres: string | null
  apellidos: string | null
  ocupacion: string | null
  razon_social: string | null
  nombre_comercial: string | null
  sector: string | null
  tipo_identificacion: string | null
  identificacion: string | null
  identificacion_validada: boolean
  telefono: string | null
  telefono_normalizado: string | null
  correo: string | null
  ciudad: string | null
  direccion: string | null
  preferencia_comunicacion: string | null
  etapa_relacion: string
  motivo_no_continua: string | null
  canal_primer_contacto: string | null
  como_nos_conocio: string | null
  notas_internas: string | null
  reserva_reforzada: boolean
  fusionado_en: string | null
  archivado_at: string | null
  created_at: string
  updated_at: string
}

export const ETIQUETA_ETAPA: Record<string, string> = {
  prospecto_nuevo: 'Prospecto nuevo',
  prospecto_calificado: 'Prospecto calificado',
  consulta_agendada: 'Consulta agendada',
  propuesta_enviada: 'Propuesta enviada',
  cliente_activo: 'Cliente activo',
  cliente_inactivo: 'Cliente inactivo',
  no_continua: 'No continúa',
}

type ConNombre = Pick<ContactoFila, 'tipo' | 'nombres' | 'apellidos' | 'razon_social'>

export function nombreContacto(c: ConNombre): string {
  if (c.tipo === 'empresa') return c.razon_social ?? '—'
  return [c.nombres, c.apellidos].filter(Boolean).join(' ') || '—'
}

/** Una persona cuyo nombre completo se guardó en `nombres` (formularios web): el personal debe corregirlo. */
export function faltanApellidos(c: ConNombre): boolean {
  return c.tipo === 'persona' && !(c.apellidos && c.apellidos.trim())
}

/** Forma que recibe la pantalla: la fila más `nombre` y `completar_apellidos`. */
export function filaParaPantalla<T extends ConNombre>(c: T): T & { nombre: string; completar_apellidos: boolean } {
  return { ...c, nombre: nombreContacto(c), completar_apellidos: faltanApellidos(c) }
}

export type Coincidencia = {
  id: string
  nombre: string
  coincidencia: 'identificacion' | 'telefono' | 'correo'
  etapa_relacion: string
}

/**
 * Fichas vigentes (no fusionadas) que coinciden por identificación, teléfono o correo normalizados.
 * `excluirId` evita compararse consigo misma. Con `soloVisibles` (alcance de contactos) no se
 * revelan fichas reservadas a quien no puede verlas.
 */
export async function buscarCoincidencias(params: {
  excluirId?: string
  tipoIdentificacion?: string | null
  identificacion?: string | null
  telefonoNormalizado?: string | null
  correoNormalizado?: string | null
}): Promise<{ id: string; coincidencia: Coincidencia['coincidencia'] }[]> {
  const salida = new Map<string, Coincidencia['coincidencia']>()

  const consultar = async (columna: string, valor: string, coincidencia: Coincidencia['coincidencia'], extra?: [string, string]) => {
    let q = supabase.from('crm_contactos').select('id').eq(columna, valor).is('fusionado_en', null).limit(20)
    if (extra) q = q.eq(extra[0], extra[1])
    if (params.excluirId) q = q.neq('id', params.excluirId)
    const { data, error } = await q
    if (error) {
      if (esTablaAusente(error)) throw new CrmNoDisponibleError()
      console.error('[crm/contactos] coincidencias', error.code)
      return
    }
    for (const f of (data ?? []) as { id: string }[]) if (!salida.has(f.id)) salida.set(f.id, coincidencia)
  }

  if (params.identificacion && params.tipoIdentificacion) {
    await consultar('identificacion', params.identificacion, 'identificacion', ['tipo_identificacion', params.tipoIdentificacion])
  }
  if (params.telefonoNormalizado) await consultar('telefono_normalizado', params.telefonoNormalizado, 'telefono')
  if (params.correoNormalizado) await consultar('correo_normalizado', params.correoNormalizado, 'correo')

  return [...salida.entries()].map(([id, coincidencia]) => ({ id, coincidencia }))
}

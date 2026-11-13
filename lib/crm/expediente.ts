// Expediente procesal (crm_expedientes, 1:1 con la solicitud). R-17: independiente del estado del caso.
// Lo ven quienes tienen acceso completo (no asistencia ni externo); lo editan D, C y el titular activo.
// Bitácora: solo los NOMBRES de los campos que cambian (decisión del responsable).
import type { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { esTablaAusente, jsonError, respuestaErrorBD } from '@/lib/crm/errores'
import { CrmNoDisponibleError } from '@/lib/crm/permisos'
import { registrar } from '@/lib/crm/bitacora'

export const CAMPOS_EXPEDIENTE = [
  'numero_proceso', 'autoridad', 'contraparte', 'etapa_procesal', 'estado_procesal', 'ultimo_acto', 'ultimo_acto_at',
] as const
type Campo = (typeof CAMPOS_EXPEDIENTE)[number]

export type Expediente = Record<Campo, string | null> & { solicitud_id: string; updated_at: string }

export const ETIQUETA_CAMPO_EXPEDIENTE: Record<Campo, string> = {
  numero_proceso: 'Número de proceso',
  autoridad: 'Autoridad',
  contraparte: 'Contraparte',
  etapa_procesal: 'Etapa procesal',
  estado_procesal: 'Estado procesal',
  ultimo_acto: 'Último acto',
  ultimo_acto_at: 'Fecha del último acto',
}

export async function obtenerExpediente(solicitudId: string): Promise<Expediente | null> {
  const { data, error } = await supabase
    .from('crm_expedientes')
    .select(`solicitud_id,updated_at,${CAMPOS_EXPEDIENTE.join(',')}`)
    .eq('solicitud_id', solicitudId)
    .maybeSingle()
  if (error) {
    if (esTablaAusente(error)) throw new CrmNoDisponibleError()
    console.error('[crm/expediente] lectura', error.code)
    throw new Error('CRM_ERROR')
  }
  return (data as unknown as Expediente | null) ?? null
}

/**
 * Guarda el expediente con control de edición simultánea: `updatedAt = null` significa que el cliente
 * no veía ninguno (se inserta); si ya existe, se actualiza solo si `updated_at` coincide.
 */
export async function guardarExpediente(
  userId: string | null,
  solicitudId: string,
  updatedAt: string | null,
  valores: Partial<Record<Campo, string | null | undefined>>,
): Promise<{ ok: true; expediente: Expediente } | { ok: false; respuesta: NextResponse }> {
  const actual = await obtenerExpediente(solicitudId)
  const datos: Record<string, string | null> = {}
  for (const c of CAMPOS_EXPEDIENTE) if (valores[c] !== undefined) datos[c] = valores[c] ?? null
  const MODIFICADO = 'Alguien más modificó este registro; recarga.'

  let resultado
  if (!actual) {
    if (updatedAt !== null) return { ok: false, respuesta: jsonError(409, MODIFICADO) }
    resultado = await supabase.from('crm_expedientes').insert({ solicitud_id: solicitudId, ...datos })
      .select(`solicitud_id,updated_at,${CAMPOS_EXPEDIENTE.join(',')}`).single()
    if (resultado.error?.code === '23505') return { ok: false, respuesta: jsonError(409, MODIFICADO) }
  } else {
    if (updatedAt === null || updatedAt !== actual.updated_at) return { ok: false, respuesta: jsonError(409, MODIFICADO) }
    const cambiados = CAMPOS_EXPEDIENTE.filter((c) => c in datos && datos[c] !== actual[c])
    if (cambiados.length === 0) return { ok: false, respuesta: jsonError(400, 'No hay cambios que guardar') }
    resultado = await supabase.from('crm_expedientes').update(datos).eq('solicitud_id', solicitudId).eq('updated_at', updatedAt)
      .select(`solicitud_id,updated_at,${CAMPOS_EXPEDIENTE.join(',')}`).maybeSingle()
    if (!resultado.error && !resultado.data) return { ok: false, respuesta: jsonError(409, MODIFICADO) }
  }
  if (resultado.error) return { ok: false, respuesta: respuestaErrorBD('crm/expediente (guardar)', resultado.error) }

  const campos = actual ? CAMPOS_EXPEDIENTE.filter((c) => c in datos && datos[c] !== actual[c]) : Object.keys(datos).filter((c) => datos[c] !== null)
  await registrar({
    userId,
    accion: actual ? 'actualizar' : 'crear',
    entidad: 'crm_expedientes',
    entidadId: solicitudId,
    detalle: { campos },
  })
  return { ok: true, expediente: resultado.data as unknown as Expediente }
}

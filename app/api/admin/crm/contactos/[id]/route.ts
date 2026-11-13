import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi, puedeCambiarEtapaContacto, puedeMarcarReserva, puedeQuitarReserva } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { contactoEditarSchema, uuidSchema } from '@/lib/crm/schemas'
import { alcancesDe, aplicarAlcance } from '@/lib/crm/visibilidad'
import { detalleContacto } from '@/lib/crm/detalles'
import { registrar } from '@/lib/crm/bitacora'
import { recalcularEtapa } from '@/lib/crm/etapas'
import { registrarCoincidencias } from '@/lib/crm/duplicados'
import {
  buscarCoincidencias, COLUMNAS_CONTACTO, faltanApellidos, filaParaPantalla, type ContactoFila,
} from '@/lib/crm/contactos'

type Ctx = { params: Promise<{ id: string }> }

const ROLES_LECTURA = ['direccion', 'coordinacion', 'asistencia', 'asociado'] as const

const CAMPOS_DATOS = [
  'nombres', 'apellidos', 'ocupacion', 'razon_social', 'nombre_comercial', 'sector', 'tipo_identificacion',
  'identificacion', 'identificacion_validada', 'telefono', 'telefono_normalizado', 'correo', 'ciudad', 'direccion',
  'preferencia_comunicacion', 'canal_primer_contacto', 'como_nos_conocio', 'notas_internas',
] as const

export async function GET(_request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(ROLES_LECTURA)
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  try {
    // Un contacto que no puede ver responde 404 (no 403), para no revelar que existe.
    const detalle = await detalleContacto(a.personal, id)
    return detalle ? NextResponse.json(detalle) : jsonError(404, 'No encontrado')
  } catch (e) {
    return respuestaExcepcion('admin/crm/contactos/[id] GET', e)
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(ROLES_LECTURA)
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = contactoEditarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data
  const rol = a.personal.rol

  try {
    const al = await alcancesDe(a.personal)
    const { data, error } = await aplicarAlcance(
      supabase.from('crm_contactos').select(COLUMNAS_CONTACTO).eq('id', id), al.contactos,
    ).maybeSingle()
    if (error) return respuestaErrorBD('admin/crm/contactos/[id] PATCH (lectura)', error)
    if (!data) return jsonError(404, 'No encontrado')
    const actual = data as unknown as ContactoFila

    // R-05: una ficha fusionada o archivada no se edita.
    if (actual.fusionado_en || actual.archivado_at) {
      return jsonError(422, 'Una ficha fusionada o archivada no se edita.', { codigo: 'R-05' })
    }

    const entrada = d as Record<string, unknown>
    const previo = actual as unknown as Record<string, unknown>
    const cambios: Record<string, unknown> = {}
    for (const campo of CAMPOS_DATOS) {
      const nuevo = entrada[campo]
      if (nuevo !== undefined && nuevo !== previo[campo]) cambios[campo] = nuevo
    }

    // Datos mínimos (R-01) y tipo de identificación de una empresa.
    const final = { ...previo, ...cambios }
    if (actual.tipo === 'persona' && !(typeof final.nombres === 'string' && final.nombres.length >= 2)) {
      return jsonError(400, 'Revisa los datos enviados.', { campos: { nombres: 'Los nombres son obligatorios' } })
    }
    if (actual.tipo === 'empresa' && !(typeof final.razon_social === 'string' && final.razon_social.length >= 2)) {
      return jsonError(400, 'Revisa los datos enviados.', { campos: { razon_social: 'La razón social es obligatoria' } })
    }
    if (actual.tipo === 'empresa' && final.tipo_identificacion && !['ruc', 'extranjera'].includes(String(final.tipo_identificacion))) {
      return jsonError(400, 'Revisa los datos enviados.', { campos: { tipo_identificacion: 'Una empresa se identifica con RUC o identificación extranjera' } })
    }

    // Reserva reforzada: marcar D y C; quitar solo Dirección.
    if (d.reserva_reforzada !== undefined && d.reserva_reforzada !== actual.reserva_reforzada) {
      const permitido = d.reserva_reforzada ? puedeMarcarReserva(rol) : puedeQuitarReserva(rol)
      if (!permitido) return jsonError(403, 'No tienes permiso para cambiar la reserva reforzada')
      cambios.reserva_reforzada = d.reserva_reforzada
    }

    // Etapa a mano: «no continúa» (con motivo, R-06) o reanudar. No para el asociado.
    if (d.etapa_manual) {
      if (!puedeCambiarEtapaContacto(rol)) return jsonError(403, 'No tienes permiso para cambiar la etapa')
      if (d.etapa_manual === 'no_continua') {
        cambios.etapa_relacion = 'no_continua'
        cambios.motivo_no_continua = d.motivo_no_continua
      } else if (actual.etapa_relacion === 'no_continua') {
        cambios.etapa_relacion = 'prospecto_nuevo'
        cambios.motivo_no_continua = null
      } else {
        return jsonError(422, 'La ficha no está marcada como «no continúa».')
      }
    }

    if (Object.keys(cambios).length === 0) return jsonError(422, 'No hay cambios que guardar.')

    // Edición simultánea: solo aplica si nadie modificó el registro.
    const { data: actualizado, error: errUpd } = await supabase
      .from('crm_contactos')
      .update(cambios)
      .eq('id', id)
      .eq('updated_at', d.updated_at)
      .select(COLUMNAS_CONTACTO)
    if (errUpd) return respuestaErrorBD('admin/crm/contactos/[id] PATCH', errUpd)
    if (!actualizado || actualizado.length === 0) return jsonError(409, 'Alguien más modificó este registro; recarga.')
    const nueva = actualizado[0] as unknown as ContactoFila

    // Efectos posteriores (best-effort).
    if ('telefono_normalizado' in cambios || 'correo' in cambios) {
      const crudas = await buscarCoincidencias({
        excluirId: id,
        telefonoNormalizado: 'telefono_normalizado' in cambios ? nueva.telefono_normalizado : null,
        correoNormalizado: 'correo' in cambios ? nueva.correo?.toLowerCase().trim() ?? null : null,
      })
      await registrarCoincidencias(id, crudas)
    }
    if (d.etapa_manual === 'reanudar') await recalcularEtapa(id, { solicitudNueva: true })

    // R-51: valores anterior y nuevo; el contenido de las notas no se copia a la bitácora.
    const antes: Record<string, unknown> = {}
    const despues: Record<string, unknown> = {}
    for (const k of Object.keys(cambios)) {
      antes[k] = k === 'notas_internas' ? '[editado]' : previo[k]
      despues[k] = k === 'notas_internas' ? '[editado]' : cambios[k]
    }
    await registrar({ userId: a.user.id, accion: 'actualizar', entidad: 'crm_contactos', entidadId: id, antes, despues })

    return NextResponse.json({
      contacto: { ...filaParaPantalla(nueva), completar_apellidos: faltanApellidos(nueva) },
    })
  } catch (e) {
    return respuestaExcepcion('admin/crm/contactos/[id] PATCH', e)
  }
}

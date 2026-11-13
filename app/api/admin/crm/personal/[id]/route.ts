import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi, puedeEditarFicha, puedeVerFicha } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaExcepcion, respuestaZod } from '@/lib/crm/errores'
import { personalEditarSchema, uuidSchema } from '@/lib/crm/schemas'
import { registrar } from '@/lib/crm/bitacora'
import { hoyGuayaquil } from '@/lib/crm/fechas'
import {
  areasDe, cargaDe, COLUMNAS_FICHA, fichaParaPantalla, obtenerFicha, type FichaFila,
} from '@/lib/crm/personal'

type Ctx = { params: Promise<{ id: string }> }

const CAMPOS = [
  'es_abogado', 'matricula', 'habilitacion_verificada', 'especialidad', 'capacidad_maxima',
  'fecha_vinculacion', 'acuerdo_confidencialidad', 'ciudad',
] as const

export async function GET(_request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi()
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')
  // Dirección y Coordinación ven todas las fichas; el resto, solo la suya (404 para no revelar otras).
  if (!puedeVerFicha(a.personal, id)) return jsonError(404, 'No encontrado')

  try {
    const ficha = await obtenerFicha(id)
    if (!ficha) return jsonError(404, 'No encontrado')
    const [carga, areas] = await Promise.all([cargaDe(id), areasDe(id)])
    return NextResponse.json({
      ficha: fichaParaPantalla(ficha),
      carga,
      areas,
      permisos: { editar: puedeEditarFicha(a.personal) },
    })
  } catch (e) {
    return respuestaExcepcion('admin/crm/personal/[id] GET', e)
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion', 'coordinacion'])
  if ('status' in a) return a
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')

  const parsed = personalEditarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data

  try {
    const actual = await obtenerFicha(id)
    if (!actual) return jsonError(404, 'No encontrado')

    // Solo se escribe lo que cambia.
    const cambios: Record<string, unknown> = {}
    for (const campo of CAMPOS) {
      const nuevo = d[campo]
      if (nuevo !== undefined && nuevo !== actual[campo]) cambios[campo] = nuevo
    }
    if (Object.keys(cambios).length === 0) return jsonError(422, 'No hay cambios que guardar.')

    // Reglas que la base impone con CHECK: se validan antes para dar un mensaje claro.
    const esAbogado = (cambios.es_abogado as boolean | undefined) ?? actual.es_abogado
    const matricula = ((cambios.matricula as string | null | undefined) ?? actual.matricula)?.trim() ?? ''
    const verificada = (cambios.habilitacion_verificada as boolean | undefined) ?? actual.habilitacion_verificada
    const campos: Record<string, string> = {}
    if (actual.rol === 'asociado' && !esAbogado) campos.es_abogado = 'Un asociado es siempre abogado'
    if (actual.rol === 'externo' && esAbogado) campos.es_abogado = 'El personal externo no ejerce patrocinio'
    if (verificada && !esAbogado) campos.habilitacion_verificada = 'Solo un abogado puede tener la habilitación verificada'
    else if (verificada && !matricula) campos.habilitacion_verificada = 'Registra la matrícula antes de verificar la habilitación'
    if (Object.keys(campos).length > 0) return jsonError(422, 'Revisa los datos enviados.', { campos })

    // Si se quita la condición de abogado, también se retira la habilitación.
    if (cambios.es_abogado === false && actual.habilitacion_verificada) cambios.habilitacion_verificada = false
    if (cambios.acuerdo_confidencialidad === true) cambios.acuerdo_confidencialidad_at = hoyGuayaquil()
    if (cambios.acuerdo_confidencialidad === false) cambios.acuerdo_confidencialidad_at = null

    // Edición simultánea: el UPDATE solo aplica si nadie modificó el registro.
    const { data: actualizado, error } = await supabase
      .from('crm_personal')
      .update(cambios)
      .eq('id', id)
      .eq('updated_at', d.updated_at)
      .select(COLUMNAS_FICHA)
    if (error) return respuestaErrorBD('admin/crm/personal/[id] PATCH', error)
    if (!actualizado || actualizado.length === 0) return jsonError(409, 'Alguien más modificó este registro; recarga.')
    const nueva = actualizado[0] as unknown as FichaFila

    const antes: Record<string, unknown> = {}
    const despues: Record<string, unknown> = {}
    for (const c of Object.keys(cambios)) {
      antes[c] = actual[c as keyof FichaFila]
      despues[c] = nueva[c as keyof FichaFila]
    }
    await registrar({ userId: a.user.id, accion: 'actualizar', entidad: 'crm_personal', entidadId: id, antes, despues })

    return NextResponse.json({ ficha: fichaParaPantalla(nueva) })
  } catch (e) {
    return respuestaExcepcion('admin/crm/personal/[id] PATCH', e)
  }
}

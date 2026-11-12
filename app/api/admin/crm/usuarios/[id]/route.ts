import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { autorizarApi } from '@/lib/crm/permisos'
import { jsonError, respuestaErrorBD, respuestaZod } from '@/lib/crm/errores'
import { usuarioEditarSchema, uuidSchema } from '@/lib/crm/schemas'
import { registrar } from '@/lib/crm/bitacora'
import { rolAMetadata, type Rol } from '@/lib/crm/roles'
import { BAN_DESACTIVADO } from '@/lib/crm/config'
import { afectadosPor, COLUMNAS_USUARIO, paraPantalla, type UsuarioFila } from '@/lib/crm/usuarios'

type Ctx = { params: Promise<{ id: string }> }

const CAMPOS_DATOS = ['nombres', 'apellidos', 'telefono', 'ciudad', 'matricula'] as const

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const a = await autorizarApi(['direccion'])
  if ('status' in a) return a

  const { id } = await params
  if (!uuidSchema.safeParse(id).success) return jsonError(404, 'No encontrado')
  // Nadie cambia su propio rol ni se desactiva a sí mismo.
  if (id === a.personal.id) return jsonError(403, 'No puedes modificar tu propia cuenta.')

  const parsed = usuarioEditarSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return respuestaZod(parsed.error)
  const d = parsed.data

  const { data: previo, error: errPrevio } = await supabase
    .from('crm_personal').select(`${COLUMNAS_USUARIO}`).eq('id', id).maybeSingle()
  if (errPrevio) return respuestaErrorBD('admin/crm/usuarios PATCH (lectura)', errPrevio)
  if (!previo) return jsonError(404, 'No encontrado')
  const actual = previo as UsuarioFila

  const cambiaRol = d.rol !== undefined && d.rol !== actual.rol
  const cambiaActivo = d.activo !== undefined && d.activo !== actual.activo
  const desactiva = cambiaActivo && d.activo === false

  if (desactiva && !d.motivo) {
    return jsonError(400, 'Revisa los datos enviados.', { campos: { motivo: 'Indica el motivo (mínimo 5 caracteres)' } })
  }

  // Solo se escribe lo que cambia.
  const cambios: Record<string, unknown> = {}
  for (const campo of CAMPOS_DATOS) {
    const nuevo = d[campo]
    if (nuevo !== undefined && nuevo !== actual[campo]) cambios[campo] = nuevo
  }
  if (cambiaRol && d.rol) {
    cambios.rol = d.rol
    // Un asociado es siempre abogado; un externo nunca (restricciones de la base).
    if (d.rol === 'asociado' && !actual.es_abogado) cambios.es_abogado = true
    if (d.rol === 'externo' && actual.es_abogado) cambios.es_abogado = false
  }
  if (cambiaActivo) cambios.activo = d.activo
  if (Object.keys(cambios).length === 0) return jsonError(422, 'No hay cambios que guardar.')

  // Edición simultánea: el UPDATE solo aplica si nadie modificó el registro.
  const { data: actualizado, error } = await supabase
    .from('crm_personal')
    .update(cambios)
    .eq('id', id)
    .eq('updated_at', d.updated_at)
    .select(COLUMNAS_USUARIO)
  if (error) return respuestaErrorBD('admin/crm/usuarios PATCH', error)
  if (!actualizado || actualizado.length === 0) {
    return jsonError(409, 'Alguien más modificó este registro; recarga.')
  }
  const nueva = actualizado[0] as UsuarioFila

  // Espejo en Auth: rol (para el middleware) y bloqueo de la cuenta.
  if (actual.user_id && (cambiaRol || cambiaActivo)) {
    // Cuenta inactiva: sin rol en Auth (así isAdminUser y el middleware dejan de reconocerla
    // de inmediato) y bloqueada. Cuenta activa: el rol sale SIEMPRE de crm_personal.rol.
    const atributos: { app_metadata?: Record<string, unknown>; ban_duration?: string } = {}
    atributos.app_metadata = { role: nueva.activo ? rolAMetadata(nueva.rol as Rol) : null }
    if (cambiaActivo) atributos.ban_duration = nueva.activo ? 'none' : BAN_DESACTIVADO

    const { error: errAuth } = await supabase.auth.admin.updateUserById(actual.user_id, atributos)
    if (errAuth) {
      console.error('[admin/crm/usuarios PATCH] Auth no se actualizó:', errAuth.status ?? errAuth.code)
      // Se deshace el cambio de la ficha para no dejar rol y cuenta desincronizados.
      const reversion: Record<string, unknown> = {}
      for (const k of Object.keys(cambios)) reversion[k] = actual[k as keyof UsuarioFila]
      const { error: errRev } = await supabase.from('crm_personal').update(reversion).eq('id', id)
      if (errRev) console.error('[admin/crm/usuarios PATCH] no se pudo revertir la ficha', errRev.code)
      return jsonError(502, 'No se pudo actualizar la cuenta de acceso. No se aplicaron los cambios.')
    }
  }

  // Bitácora (R-51): sin contraseñas ni credenciales.
  if (cambiaRol) {
    await registrar({
      userId: a.user.id, accion: 'cambiar_rol', entidad: 'crm_personal', entidadId: id,
      antes: { rol: actual.rol }, despues: { rol: nueva.rol }, motivo: d.motivo ?? null,
    })
  }
  if (cambiaActivo) {
    await registrar({
      userId: a.user.id,
      accion: d.activo ? 'reactivar_usuario' : 'desactivar_usuario',
      entidad: 'crm_personal', entidadId: id,
      antes: { activo: actual.activo }, despues: { activo: nueva.activo }, motivo: d.motivo ?? null,
    })
  }
  const datosCambiados = CAMPOS_DATOS.filter((c) => c in cambios)
  if (datosCambiados.length > 0) {
    const antes: Record<string, unknown> = {}
    const despues: Record<string, unknown> = {}
    for (const c of datosCambiados) { antes[c] = actual[c]; despues[c] = nueva[c] }
    await registrar({ userId: a.user.id, accion: 'actualizar', entidad: 'crm_personal', entidadId: id, antes, despues })
  }

  // R-45: al desactivar no se cancela ni reasigna nada solo; se devuelve la lista.
  const afectados = desactiva ? await afectadosPor(id) : undefined

  return NextResponse.json({ usuario: paraPantalla(nueva), afectados })
}

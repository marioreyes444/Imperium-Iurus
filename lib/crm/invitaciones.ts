// ═══════════════════════════════════════════════════════════════════════════
// PENDIENTE — INVITACIÓN POR CORREO (se implementa en una fase aparte)
// ═══════════════════════════════════════════════════════════════════════════
// Aquí irá el envío de la invitación al crear (o reenviar a) un usuario:
//
//   1. Comprobar que el proyecto Supabase tenga configurado el envío de correos
//      y la URL de redirección. Si no, detenerse y avisar.
//   2. supabase.auth.admin.inviteUserByEmail(correo, { redirectTo: <…/admin/crm/acceso> })
//      con el cliente service_role de lib/supabase.ts.
//   3. supabase.auth.admin.updateUserById(id, { app_metadata: { role: rolAMetadata(rol) } }).
//   4. Vincular la cuenta a la ficha: UPDATE crm_personal SET user_id = <id nuevo>.
//      Si la vinculación falla, eliminar la cuenta recién creada (auth.admin.deleteUser).
//   5. Página /admin/crm/acceso (única pantalla del CRM accesible con la sesión del
//      enlace): pide la contraseña dos veces y llama a auth.updateUser. Dirección
//      nunca ve ni escribe contraseñas.
//   6. Reenvío (POST usuarios/[id]/invitacion) solo mientras la persona no haya
//      definido su contraseña. Bitácora: `actualizar`.
//
// Mientras tanto, crear un usuario guarda solo su FICHA en crm_personal (sin cuenta:
// user_id = null). Todo lo demás del flujo de usuarios (rol, activo, bitácora)
// funciona sobre esa ficha.
// ═══════════════════════════════════════════════════════════════════════════
import type { Rol } from '@/lib/crm/roles'

export type ResultadoInvitacion = {
  enviada: false
  motivo: 'pendiente_implementacion'
}

export async function invitarUsuario(_datos: { personalId: string; correo: string; rol: Rol }): Promise<ResultadoInvitacion> {
  return { enviada: false, motivo: 'pendiente_implementacion' }
}

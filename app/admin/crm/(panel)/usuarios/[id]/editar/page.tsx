import { notFound, redirect } from 'next/navigation'
import UsuarioForm from '@/components/crm/UsuarioForm'
import { personalDePagina } from '@/lib/crm/permisos'
import { ROLES, ROL_LABEL } from '@/lib/crm/roles'
import { uuidSchema } from '@/lib/crm/schemas'
import { obtenerUsuario } from '@/lib/crm/usuarios'

export const dynamic = 'force-dynamic'

export default async function EditarUsuarioPage({ params }: { params: Promise<{ id: string }> }) {
  const personal = await personalDePagina(['direccion'])
  const { id } = await params

  if (!uuidSchema.safeParse(id).success) notFound()
  // Nadie edita su propia cuenta desde aquí.
  if (id === personal.id) redirect('/admin/crm/usuarios')

  const usuario = await obtenerUsuario(id)
  if (!usuario) notFound()

  return (
    <UsuarioForm
      modo="editar"
      roles={ROLES.map((r) => ({ valor: r, etiqueta: ROL_LABEL[r] }))}
      inicial={{
        id: usuario.id,
        rol: usuario.rol,
        nombres: usuario.nombres,
        apellidos: usuario.apellidos,
        correo: usuario.correo,
        telefono: usuario.telefono,
        ciudad: usuario.ciudad,
        es_abogado: usuario.es_abogado,
        matricula: usuario.matricula,
        updated_at: usuario.updated_at,
      }}
    />
  )
}

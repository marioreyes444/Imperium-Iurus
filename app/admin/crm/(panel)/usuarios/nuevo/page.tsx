import UsuarioForm from '@/components/crm/UsuarioForm'
import { personalDePagina } from '@/lib/crm/permisos'
import { ROLES, ROL_LABEL } from '@/lib/crm/roles'

export const dynamic = 'force-dynamic'

export default async function NuevoUsuarioPage() {
  await personalDePagina(['direccion'])
  return <UsuarioForm modo="nuevo" roles={ROLES.map((r) => ({ valor: r, etiqueta: ROL_LABEL[r] }))} />
}

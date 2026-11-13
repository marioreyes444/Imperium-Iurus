import PersonalLista from '@/components/crm/PersonalLista'
import { personalDePagina } from '@/lib/crm/permisos'
import { ROLES, ROL_LABEL } from '@/lib/crm/roles'

export const dynamic = 'force-dynamic'

export default async function PersonalPage() {
  await personalDePagina(['direccion', 'coordinacion'])
  return <PersonalLista roles={ROLES.map((r) => ({ valor: r, etiqueta: ROL_LABEL[r] }))} />
}

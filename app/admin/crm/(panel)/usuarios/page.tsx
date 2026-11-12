import UsuariosLista from '@/components/crm/UsuariosLista'
import { personalDePagina } from '@/lib/crm/permisos'
import { ROLES, ROL_LABEL } from '@/lib/crm/roles'

export const dynamic = 'force-dynamic'

export default async function UsuariosPage({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const personal = await personalDePagina(['direccion'])
  const { aviso } = await searchParams

  return (
    <UsuariosLista
      miId={personal.id}
      roles={ROLES.map((r) => ({ valor: r, etiqueta: ROL_LABEL[r] }))}
      aviso={aviso === 'creado' || aviso === 'editado' ? aviso : undefined}
    />
  )
}

import TareasLista from '@/components/crm/TareasLista'
import { personalDePagina } from '@/lib/crm/permisos'

export const dynamic = 'force-dynamic'

/** Tareas: las propias o las de los casos visibles (el externo, solo las suyas). */
export default async function TareasPage() {
  const personal = await personalDePagina()
  return <TareasLista verTodas={personal.rol !== 'externo'} />
}

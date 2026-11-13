import AsignacionesLista from '@/components/crm/AsignacionesLista'
import { personalDePagina } from '@/lib/crm/permisos'

export const dynamic = 'force-dynamic'

/** Cualquier persona del personal puede entrar: la lista muestra solo las filas de su propia cuenta. */
export default async function AsignacionesPage() {
  await personalDePagina()
  return <AsignacionesLista />
}

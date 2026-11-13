import AvisosLista from '@/components/crm/AvisosLista'
import { personalDePagina } from '@/lib/crm/permisos'

export const dynamic = 'force-dynamic'

/** Avisos del panel (cada quien, los suyos). Pantalla agregada en la Entrega 4 (no está en 9.6). */
export default async function AvisosPage() {
  await personalDePagina()
  return <AvisosLista />
}

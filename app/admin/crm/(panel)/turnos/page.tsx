import TurnosLista from '@/components/crm/TurnosLista'
import { ACCIONES, personalDePagina } from '@/lib/crm/permisos'
import { abogadosActivos } from '@/lib/crm/horarios'

export const dynamic = 'force-dynamic'

/** Turnos de abogados fuera de horario (Dirección y Coordinación). */
export default async function TurnosPage() {
  await personalDePagina(ACCIONES['turnos.gestionar'])
  const personas = await abogadosActivos().catch(() => [])
  return <TurnosLista personas={personas} />
}

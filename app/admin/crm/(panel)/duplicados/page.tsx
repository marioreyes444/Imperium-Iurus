import DuplicadosLista from '@/components/crm/DuplicadosLista'
import { personalDePagina } from '@/lib/crm/permisos'

export const dynamic = 'force-dynamic'

export default async function DuplicadosPage() {
  await personalDePagina(['direccion', 'coordinacion', 'asistencia'])
  return <DuplicadosLista />
}

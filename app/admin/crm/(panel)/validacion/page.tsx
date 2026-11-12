import ValidacionLista from '@/components/crm/ValidacionLista'
import { personalDePagina } from '@/lib/crm/permisos'

export const dynamic = 'force-dynamic'

export default async function ValidacionPage() {
  await personalDePagina(['direccion', 'coordinacion', 'asistencia'])
  return <ValidacionLista />
}

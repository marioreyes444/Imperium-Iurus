import ContactoForm from '@/components/crm/ContactoForm'
import { personalDePagina } from '@/lib/crm/permisos'

export const dynamic = 'force-dynamic'

export default async function NuevoContactoPage() {
  await personalDePagina(['direccion', 'coordinacion', 'asistencia'])
  return <ContactoForm modo="nuevo" />
}

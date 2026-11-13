import ContactosLista from '@/components/crm/ContactosLista'
import { personalDePagina, puedeCrearContactos } from '@/lib/crm/permisos'
import { ETIQUETA_ETAPA } from '@/lib/crm/contactos'

export const dynamic = 'force-dynamic'

export default async function ContactosPage() {
  const personal = await personalDePagina(['direccion', 'coordinacion', 'asistencia', 'asociado'])
  const crea = puedeCrearContactos(personal.rol)

  return (
    <ContactosLista
      etapas={Object.entries(ETIQUETA_ETAPA).map(([valor, etiqueta]) => ({ valor, etiqueta }))}
      puedeCrear={crea}
      puedeEditar
    />
  )
}

import SolicitudForm from '@/components/crm/SolicitudForm'
import { personalDePagina, puedeMarcarReserva, puedeQuitarReserva } from '@/lib/crm/permisos'
import { obtenerCatalogo } from '@/lib/crm/catalogo'
import { alcancesDe, contactosVisiblesEntre } from '@/lib/crm/visibilidad'
import { supabase } from '@/lib/supabase'
import { nombreContacto, type ContactoFila } from '@/lib/crm/contactos'
import { uuidSchema } from '@/lib/crm/schemas'
import { ETIQUETA_URGENCIA } from '@/components/crm/IndicadoresSolicitud'

export const dynamic = 'force-dynamic'

const CANALES = [
  { valor: 'llamada', etiqueta: 'Llamada' }, { valor: 'presencial', etiqueta: 'Presencial' },
  { valor: 'whatsapp', etiqueta: 'WhatsApp' }, { valor: 'correo', etiqueta: 'Correo' },
  { valor: 'chat', etiqueta: 'Chat' }, { valor: 'referido', etiqueta: 'Referido' },
]

export default async function NuevaSolicitudPage({ searchParams }: { searchParams: Promise<{ contacto?: string }> }) {
  const personal = await personalDePagina(['direccion', 'coordinacion', 'asistencia'])
  const { contacto } = await searchParams
  const catalogo = await obtenerCatalogo()

  // Contacto precargado (desde su ficha): solo si la persona puede verlo.
  let contactoInicial: { id: string; nombre: string } | null = null
  if (contacto && uuidSchema.safeParse(contacto).success) {
    try {
      const al = await alcancesDe(personal)
      if ((await contactosVisiblesEntre([contacto], al.contactos)).has(contacto)) {
        const { data } = await supabase.from('crm_contactos').select('id,tipo,nombres,apellidos,razon_social,fusionado_en').eq('id', contacto).maybeSingle()
        const f = data as unknown as (Pick<ContactoFila, 'id' | 'tipo' | 'nombres' | 'apellidos' | 'razon_social' | 'fusionado_en'>) | null
        if (f && !f.fusionado_en) contactoInicial = { id: f.id, nombre: nombreContacto(f) }
      }
    } catch {
      contactoInicial = null
    }
  }

  return (
    <SolicitudForm
      modo="nueva"
      catalogo={{ areas: catalogo.areas.map((a) => ({ id: a.id, nombre: a.nombre })), servicios: catalogo.servicios.map((s) => ({ id: s.id, area_id: s.area_id, nombre: s.nombre })) }}
      urgencias={Object.entries(ETIQUETA_URGENCIA).map(([valor, etiqueta]) => ({ valor, etiqueta }))}
      canales={CANALES}
      puedeMarcarReserva={puedeMarcarReserva(personal.rol)}
      puedeQuitarReserva={puedeQuitarReserva(personal.rol)}
      contactoInicial={contactoInicial}
    />
  )
}

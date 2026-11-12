import SolicitudesLista from '@/components/crm/SolicitudesLista'
import { personalDePagina } from '@/lib/crm/permisos'
import { obtenerCatalogo } from '@/lib/crm/catalogo'
import { ETIQUETA_ESTADO, type Estado } from '@/lib/crm/estados'
import { ETIQUETA_URGENCIA } from '@/components/crm/IndicadoresSolicitud'

export const dynamic = 'force-dynamic'

export default async function SolicitudesPage() {
  const personal = await personalDePagina(['direccion', 'coordinacion', 'asistencia', 'asociado', 'externo'])
  const catalogo = await obtenerCatalogo()
  const rol = personal.rol

  return (
    <SolicitudesLista
      estados={(Object.keys(ETIQUETA_ESTADO) as Estado[]).map((valor) => ({ valor, etiqueta: ETIQUETA_ESTADO[valor] }))}
      urgencias={Object.entries(ETIQUETA_URGENCIA).map(([valor, etiqueta]) => ({ valor, etiqueta }))}
      areas={catalogo.areas.map((a) => ({ valor: a.id, etiqueta: a.nombre }))}
      puedeCrear={rol === 'direccion' || rol === 'coordinacion' || rol === 'asistencia'}
      puedeEditar={rol !== 'externo'}
      puedeCambiarEstado={rol !== 'externo'}
    />
  )
}

import SolicitudesLista from '@/components/crm/SolicitudesLista'
import { personalDePagina, puedeCrearSolicitudes, puedeEditarEnListadoSolicitudes, puedeFiltrarPorTitular } from '@/lib/crm/permisos'
import { abogadosParaFiltro } from '@/lib/crm/titulares'
import { obtenerCatalogo } from '@/lib/crm/catalogo'
import { ETIQUETA_ESTADO, type Estado } from '@/lib/crm/estados'
import { ETIQUETA_URGENCIA } from '@/components/crm/IndicadoresSolicitud'

export const dynamic = 'force-dynamic'

export default async function SolicitudesPage() {
  const personal = await personalDePagina(['direccion', 'coordinacion', 'asistencia', 'asociado', 'externo'])
  const catalogo = await obtenerCatalogo()
  const rol = personal.rol
  const titulares = puedeFiltrarPorTitular(rol)
    ? (await abogadosParaFiltro().catch(() => [])).map((a) => ({ valor: a.id, etiqueta: a.nombre }))
    : undefined

  return (
    <SolicitudesLista
      estados={(Object.keys(ETIQUETA_ESTADO) as Estado[]).map((valor) => ({ valor, etiqueta: ETIQUETA_ESTADO[valor] }))}
      urgencias={Object.entries(ETIQUETA_URGENCIA).map(([valor, etiqueta]) => ({ valor, etiqueta }))}
      areas={catalogo.areas.map((a) => ({ valor: a.id, etiqueta: a.nombre }))}
      titulares={titulares}
      puedeCrear={puedeCrearSolicitudes(rol)}
      puedeEditar={puedeEditarEnListadoSolicitudes(rol)}
      puedeCambiarEstado={puedeEditarEnListadoSolicitudes(rol)}
    />
  )
}

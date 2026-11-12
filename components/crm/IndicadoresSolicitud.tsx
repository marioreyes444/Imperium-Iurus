import Indicador from '@/components/crm/Indicador'

// Indicadores de una solicitud (9.5). Sin píldoras de colores: texto normal con un marcador pequeño;
// el rojo se reserva para lo crítico y el significado nunca depende solo del color.

export const ETIQUETA_URGENCIA: Record<string, string> = {
  critica: 'Crítica', alta: 'Alta', media: 'Media', ordinaria: 'Ordinaria',
}

/** Urgencia (cuadrado): crítica = relleno rojo y texto resaltado · alta = dorado · media = contorno · ordinaria = sin marcador, atenuado. */
export function IndicadorUrgencia({ urgencia }: { urgencia: string }) {
  const texto = ETIQUETA_URGENCIA[urgencia] ?? urgencia
  switch (urgencia) {
    case 'critica': return <Indicador forma="cuadrado" relleno="rojo" resaltado texto={texto} />
    case 'alta': return <Indicador forma="cuadrado" relleno="dorado" texto={texto} />
    case 'media': return <Indicador forma="cuadrado" relleno="contorno" texto={texto} />
    default: return <Indicador relleno="ninguno" atenuado texto={texto} />
  }
}

const RELLENO_FASE = { por_atender: 'contorno', en_tramite: 'dorado', activo: 'claro', terminado: 'atenuado' } as const

/** Estado (punto, por fase): por atender = contorno · en trámite = dorado · activo = claro · terminado = atenuado. */
export function IndicadorEstado({ etiqueta, fase }: { etiqueta: string; fase: string }) {
  const relleno = RELLENO_FASE[fase as keyof typeof RELLENO_FASE] ?? 'atenuado'
  return <Indicador forma="punto" relleno={relleno} atenuado={fase === 'terminado'} texto={etiqueta} />
}

// Exportación CSV de solicitudes (Entrega 5, R-53 y R-54). Solo Dirección y Coordinación.
//
//   · UTF-8 con BOM y separador PUNTO Y COMA: Excel en español (es-EC/es-ES) usa `;` como separador de
//     lista y con coma dejaría todo en una sola columna. Sin la línea `sep=;` (haría que Excel ignorara el
//     BOM y estropeara las tildes). Los decimales llevan coma, igual que en esa configuración regional.
//   · Contra la inyección de fórmulas, toda celda que empiece con = + - @ tabulación o retorno de carro
//     lleva un apóstrofo delante.
//   · Una fila por solicitud recibida en el período. Los casos reservados quedan fuera para quien no está
//     autorizado: la visibilidad se aplica EN la consulta (R-53).
//   · Nunca salen: descripción, objetivo del cliente, notas, notas jurídicas, expediente, nombre, correo,
//     teléfono, identificación, dirección ni ciudad. El caso se identifica por su código.
import { alcancesDe, contactoVisibleEn } from '@/lib/crm/visibilidad'
import type { Personal } from '@/lib/crm/permisos'
import { COLUMNAS_SOLICITUD_REPORTE, solicitudesDelPeriodo, type FiltrosReporte, type SolicitudReporte } from '@/lib/crm/reportes'
import { nombresPersonal, titularesDe } from '@/lib/crm/titulares'
import { feriados } from '@/lib/crm/disponibilidad'
import { evaluarObjetivo, minutosHabilesEntre } from '@/lib/crm/objetivos'
import { obtenerCatalogo } from '@/lib/crm/catalogo'
import { ETIQUETA_ESTADO, type Estado } from '@/lib/crm/estados'
import { TOPE_FILAS_EXPORTAR } from '@/lib/crm/config'
import { partesGuayaquil } from '@/lib/crm/fechas'

export const SEPARADOR_CSV = ';'
const BOM = '﻿'

/** Columnas del archivo, en orden. Cada una está justificada en docs/E6_PRUEBAS_CRM.md. */
export const COLUMNAS_CSV = [
  'codigo',
  'fecha_recepcion',
  'canal',
  'area',
  'servicio',
  'urgencia',
  'estado',
  'estado_desde',
  'reserva_reforzada',
  'titular',
  'primera_respuesta',
  'horas_habiles_primera_respuesta',
  'objetivo_primer_contacto',
  'asignada',
  'cerrada',
  'resultado_cierre',
  'motivo_descarte',
  'contacto_tipo',
] as const

/** Una celda: antepone `'` si pudiera interpretarse como fórmula y entrecomilla si hace falta. */
export function celdaCsv(valor: unknown): string {
  let s = valor === null || valor === undefined ? '' : String(valor)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[;"\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export const filaCsv = (celdas: readonly unknown[]) => celdas.map(celdaCsv).join(SEPARADOR_CSV)

/** Ensambla el archivo: BOM, encabezado y filas separadas por CRLF. */
export function ensamblarCsv(filas: readonly (readonly unknown[])[]): string {
  return BOM + [COLUMNAS_CSV, ...filas].map(filaCsv).join('\r\n') + '\r\n'
}

const fechaHora = (iso: string | null) => {
  if (!iso) return ''
  const p = partesGuayaquil(new Date(iso))
  return `${p.anio}-${p.mes}-${p.dia} ${p.hora}:${p.minuto}`
}

const decimal = (n: number) => n.toFixed(2).replace('.', ',')

type FilaExportable = SolicitudReporte & {
  contacto_id: string
  crm_contactos: { id?: string; tipo: string; reserva_reforzada: boolean } | { tipo: string; reserva_reforzada: boolean }[] | null
}

export type ResultadoExportacion = { csv: string; filas: number }

/**
 * Genera el CSV. Lanza `ExcedeTopeError` si el período trae más de TOPE_FILAS_EXPORTAR solicitudes
 * (no se entrega nada parcial). El llamador registra la exportación en la bitácora ANTES de entregarlo.
 */
export async function generarCsv(personal: Personal, f: FiltrosReporte): Promise<ResultadoExportacion> {
  const al = await alcancesDe(personal)
  const solicitudes = await solicitudesDelPeriodo<FilaExportable>(personal, f, {
    columnas: `${COLUMNAS_SOLICITUD_REPORTE},contacto_id,crm_contactos!crm_solicitudes_contacto_fkey(tipo,reserva_reforzada)`,
    tope: TOPE_FILAS_EXPORTAR,
    bloque: 'exportación',
  })

  const [fer, catalogo, titulares] = await Promise.all([
    feriados(),
    obtenerCatalogo(),
    titularesDe(solicitudes.map((s) => s.id)),
  ])
  const nombres = await nombresPersonal([...titulares.values()])
  const area = new Map(catalogo.areas.map((a) => [a.id, a.nombre]))
  const servicio = new Map(catalogo.servicios.map((s) => [s.id, s.nombre]))
  const ahora = Date.now()

  const filas = solicitudes.map((s) => {
    const recepcion = Date.parse(s.fecha_recepcion)
    const respuesta = s.primera_respuesta_at ? Date.parse(s.primera_respuesta_at) : null
    const ev = evaluarObjetivo({ recepcion, primeraRespuesta: respuesta, urgencia: s.urgencia }, ahora, fer)
    const contacto = Array.isArray(s.crm_contactos) ? (s.crm_contactos[0] ?? null) : s.crm_contactos
    const tipoVisible = contacto && contactoVisibleEn(al.contactos, { id: s.contacto_id, reserva_reforzada: contacto.reserva_reforzada })
    const titular = titulares.get(s.id)
    return [
      s.codigo,
      fechaHora(s.fecha_recepcion),
      s.canal_origen,
      s.area_principal_id ? (area.get(s.area_principal_id) ?? '') : '',
      s.servicio_id ? (servicio.get(s.servicio_id) ?? '') : '',
      s.urgencia,
      ETIQUETA_ESTADO[s.estado as Estado] ?? s.estado,
      fechaHora(s.estado_at),
      s.reserva_reforzada ? 'sí' : 'no',
      titular ? (nombres.get(titular) ?? '') : '',
      fechaHora(s.primera_respuesta_at),
      respuesta !== null ? decimal(minutosHabilesEntre(recepcion, respuesta, fer) / 60) : '',
      ev ? (ev.estado === 'en_curso' ? 'en curso' : ev.estado) : '',
      fechaHora(s.asignada_at),
      fechaHora(s.cerrada_at),
      s.resultado_cierre ?? '',
      s.estado === 'descartada' ? (s.motivo_estado ?? '') : '',
      tipoVisible && contacto ? contacto.tipo : '',
    ]
  })

  return { csv: ensamblarCsv(filas), filas: filas.length }
}

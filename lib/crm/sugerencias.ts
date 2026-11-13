// Sugerencias para asignar un caso (R-25).
// Orden: 1) titular de referencia del área, 2) suplente de referencia, 3) demás abogados habilitados del
// área; dentro de cada grupo, menor carga/capacidad y luego misma ciudad que el contacto. Siempre se
// devuelven carga y capacidad. El llamador YA comprobó que la persona puede ver el caso.
import { supabase } from '@/lib/supabase'
import { esTablaAusente } from '@/lib/crm/errores'
import { CrmNoDisponibleError } from '@/lib/crm/permisos'
import { normalizarBusqueda } from '@/lib/crm/normalizar'
import { ESTADOS_VIGENTES_EQUIPO } from '@/lib/crm/asignacion'

export type GrupoSugerencia = 'titular_ref' | 'suplente_ref' | 'area' | 'otros'

export type Sugerencia = {
  personal_id: string
  nombre: string
  grupo: GrupoSugerencia
  carga: number
  capacidad: number | null
  en_limite: boolean
  misma_ciudad: boolean
}

export type ResultadoSugerencias = {
  items: Sugerencia[]
  /** El caso no tiene área principal: se muestran todos los abogados habilitados. */
  sin_area: boolean
  /** El área no tiene a nadie vinculado (o el catálogo no está disponible): se muestran todos los habilitados. */
  sin_referencias: boolean
}

const RANGO: Record<GrupoSugerencia, number> = { titular_ref: 0, suplente_ref: 1, area: 2, otros: 3 }

export async function sugerenciasPara(solicitudId: string): Promise<ResultadoSugerencias> {
  const { data: sol, error: errSol } = await supabase
    .from('crm_solicitudes')
    .select('id,area_principal_id,contacto_id')
    .eq('id', solicitudId)
    .maybeSingle()
  if (errSol) {
    if (esTablaAusente(errSol)) throw new CrmNoDisponibleError()
    console.error('[crm/sugerencias] solicitud', errSol.code)
    throw new Error('CRM_ERROR')
  }
  if (!sol) return { items: [], sin_area: false, sin_referencias: false }

  // Ciudad del contacto: solo para ordenar; nunca se devuelve.
  const { data: contacto } = await supabase.from('crm_contactos').select('ciudad').eq('id', sol.contacto_id).maybeSingle()
  const ciudadContacto = contacto?.ciudad ? normalizarBusqueda(String(contacto.ciudad)) : null

  // Quien ya figura vigente en el equipo no se sugiere.
  const { data: vigentes } = await supabase
    .from('crm_solicitud_equipo')
    .select('personal_id')
    .eq('solicitud_id', solicitudId)
    .in('estado', [...ESTADOS_VIGENTES_EQUIPO])
  const excluidos = new Set(((vigentes ?? []) as { personal_id: string }[]).map((v) => v.personal_id))

  const { data: personas, error: errPersonas } = await supabase
    .from('crm_personal')
    .select('id,nombres,apellidos,ciudad,capacidad_maxima')
    .eq('activo', true)
    .eq('es_abogado', true)
    .eq('habilitacion_verificada', true)
  if (errPersonas) {
    if (esTablaAusente(errPersonas)) throw new CrmNoDisponibleError()
    console.error('[crm/sugerencias] personal', errPersonas.code)
    throw new Error('CRM_ERROR')
  }
  const habilitados = ((personas ?? []) as { id: string; nombres: string; apellidos: string; ciudad: string | null; capacidad_maxima: number | null }[])
    .filter((p) => !excluidos.has(p.id))

  const { data: cargas } = await supabase
    .from('crm_v_carga_personal')
    .select('personal_id,carga_titular')
    .in('personal_id', habilitados.map((p) => p.id).concat('00000000-0000-0000-0000-000000000000'))
  const cargaDe = new Map(((cargas ?? []) as { personal_id: string; carga_titular: number }[]).map((c) => [c.personal_id, c.carga_titular]))

  // Vínculos con el área (si el catálogo E5 aún no existe, esta consulta puede fallar: se sugiere a todos).
  const grupoDe = new Map<string, GrupoSugerencia>()
  let sinReferencias = false
  const sinArea = !sol.area_principal_id
  if (sol.area_principal_id) {
    const { data: vinculos, error: errAreas } = await supabase
      .from('crm_personal_areas')
      .select('personal_id,rol_referencia')
      .eq('area_id', sol.area_principal_id)
    if (errAreas && !esTablaAusente(errAreas)) console.error('[crm/sugerencias] áreas', errAreas.code)
    const filas = (errAreas ? [] : (vinculos ?? [])) as { personal_id: string; rol_referencia: string }[]
    for (const v of filas) {
      grupoDe.set(v.personal_id, v.rol_referencia === 'titular' ? 'titular_ref' : v.rol_referencia === 'suplente' ? 'suplente_ref' : 'area')
    }
    sinReferencias = filas.length === 0
  }

  const items: Sugerencia[] = []
  for (const p of habilitados) {
    let grupo: GrupoSugerencia | undefined = grupoDe.get(p.id)
    if (!grupo) {
      // Sin área, o área sin nadie vinculado: todos los habilitados, sin prioridad de área.
      if (sinArea || sinReferencias) grupo = 'otros'
      else continue
    }
    const carga = cargaDe.get(p.id) ?? 0
    items.push({
      personal_id: p.id,
      nombre: `${p.nombres} ${p.apellidos}`,
      grupo,
      carga,
      capacidad: p.capacidad_maxima,
      en_limite: p.capacidad_maxima !== null && carga >= p.capacidad_maxima,
      misma_ciudad: !!ciudadContacto && !!p.ciudad && normalizarBusqueda(p.ciudad) === ciudadContacto,
    })
  }

  const razon = (s: Sugerencia) => (s.capacidad ? s.carga / s.capacidad : 0)
  items.sort(
    (a, b) =>
      RANGO[a.grupo] - RANGO[b.grupo] ||
      razon(a) - razon(b) ||
      Number(b.misma_ciudad) - Number(a.misma_ciudad) ||
      a.nombre.localeCompare(b.nombre, 'es'),
  )
  return { items, sin_area: sinArea, sin_referencias: !sinArea && sinReferencias }
}

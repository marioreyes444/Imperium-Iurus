import BitacoraLista from '@/components/crm/BitacoraLista'
import { supabase } from '@/lib/supabase'
import { ACCIONES_BITACORA } from '@/lib/crm/bitacora'
import { personalDePagina } from '@/lib/crm/permisos'

export const dynamic = 'force-dynamic'

export default async function BitacoraPage() {
  await personalDePagina(['direccion'])

  // Personas con cuenta, para el filtro por usuario (la bitácora guarda la cuenta).
  const { data, error } = await supabase
    .from('crm_personal')
    .select('user_id,nombres,apellidos')
    .not('user_id', 'is', null)
    .order('nombres', { ascending: true })
  if (error) console.error('[admin/crm/bitacora] usuarios', error.code)

  const usuarios = ((data ?? []) as { user_id: string; nombres: string; apellidos: string }[]).map((p) => ({
    valor: p.user_id,
    etiqueta: `${p.nombres} ${p.apellidos}`,
  }))

  return <BitacoraLista acciones={[...ACCIONES_BITACORA]} usuarios={usuarios} />
}

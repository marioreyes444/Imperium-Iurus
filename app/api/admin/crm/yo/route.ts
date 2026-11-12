import { NextResponse } from 'next/server'
import { autorizarApi, menuDe, permisosDe } from '@/lib/crm/permisos'
import { ROL_LABEL } from '@/lib/crm/roles'

/** Ficha, rol y permisos de quien consulta, para armar el menú. */
export async function GET() {
  const a = await autorizarApi()
  if ('status' in a) return a
  const { personal } = a

  return NextResponse.json({
    personal: {
      id: personal.id,
      nombres: personal.nombres,
      apellidos: personal.apellidos,
      rol: personal.rol,
      rol_label: ROL_LABEL[personal.rol],
    },
    permisos: permisosDe(personal.rol),
    menu: menuDe(personal.rol),
  })
}

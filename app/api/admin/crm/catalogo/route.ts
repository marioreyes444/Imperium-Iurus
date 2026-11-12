import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/crm/permisos'
import { obtenerCatalogo } from '@/lib/crm/catalogo'

/** Áreas y servicios activos (catálogo E5). Lista vacía, sin error, si aún no existe. */
export async function GET() {
  const a = await autorizarApi()
  if ('status' in a) return a
  return NextResponse.json(await obtenerCatalogo())
}

// Canal «correo» de los avisos del CRM (11.2). Mismo patrón que el resto del proyecto:
// Resend con RESEND_API_KEY y remitente RESEND_FROM_EMAIL; Resend no lanza, se revisa `error`.
// Solo para el PERSONAL: el CRM no envía correos al cliente (los recordatorios son del E7).
// El contenido es mínimo y sin datos sensibles: el título del aviso y un enlace al CRM.
import { Resend } from 'resend'
import { SITE_URL } from '@/lib/site'

let cliente: Resend | null = null

function resend(): Resend | null {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return null
  cliente ??= new Resend(process.env.RESEND_API_KEY)
  return cliente
}

const escapar = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function html(titulo: string, enlace: string): string {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#0a1220;font-family:Arial,sans-serif;color:#e8e2d4">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<p style="margin:0;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#c9a227">CRM · Imperium Iuris</p>
<h1 style="margin:16px 0 8px;font-size:18px;color:#e8e2d4">${escapar(titulo)}</h1>
<p style="margin:0 0 24px;font-size:13px;color:#9aa3b2">Abre el CRM para ver el detalle.</p>
<a href="${escapar(enlace)}" style="display:inline-block;padding:10px 20px;background:#c9a227;color:#0a1220;text-decoration:none;font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">Abrir el CRM</a>
<p style="margin:32px 0 0;font-size:11px;color:#6b7280">Aviso automático del CRM. No respondas a este correo.</p>
</div></body></html>`
}

export type ResultadoCorreo = { ok: true } | { ok: false; error: string }

/** Envía un aviso por correo. Nunca lanza; el error devuelto no lleva datos personales. */
export async function enviarCorreoAviso(a: { para: string; titulo: string; url: string }): Promise<ResultadoCorreo> {
  const r = resend()
  if (!r) return { ok: false, error: 'Correo no configurado en el servidor' }
  try {
    const enlace = a.url.startsWith('http') ? a.url : `${SITE_URL}${a.url}`
    const { error } = await r.emails.send({
      from: `Imperium Iuris <${process.env.RESEND_FROM_EMAIL}>`,
      to: a.para,
      subject: a.titulo,
      html: html(a.titulo, enlace),
    })
    if (error) return { ok: false, error: `Resend: ${error.name ?? 'error'}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `Excepción: ${e instanceof Error ? e.name : 'error'}` }
  }
}

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isAdminUser } from '@/lib/admin-auth'
import { rolCrmDesdeUsuario } from '@/lib/crm/roles'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // ── Rutas admin ────────────────────────────────────────────────────────
  if (pathname.startsWith('/admin')) {
    const isLoginPage = pathname === '/admin/login'
    const isAdmin = isAdminUser(user)
    // Personal del CRM (coordinación, asistencia, asociado, externo): solo /admin/crm/**.
    // Dirección equivale a admin y conserva acceso a todo /admin.
    const rolCrm = rolCrmDesdeUsuario(user)
    const esPersonalCrm = rolCrm !== null && !isAdmin
    const isCrmRoute = pathname === '/admin/crm' || pathname.startsWith('/admin/crm/')

    if (!isAdmin && !esPersonalCrm && !isLoginPage) {
      const url = new URL('/admin/login', request.url)
      url.searchParams.set('redirect', pathname)
      return NextResponse.redirect(url)
    }
    if (isAdmin && isLoginPage) {
      return NextResponse.redirect(new URL('/admin/agenda', request.url))
    }
    if (esPersonalCrm && (isLoginPage || !isCrmRoute)) {
      return NextResponse.redirect(new URL('/admin/crm', request.url))
    }
    return supabaseResponse
  }

  // ── Portal de clientes ─────────────────────────────────────────────────
  if (pathname.startsWith('/chat') || pathname.startsWith('/mis-citas') || pathname.startsWith('/cuenta')) {
    if (!user) return NextResponse.redirect(new URL('/login', request.url))
    return supabaseResponse
  }

  if (pathname === '/login' || pathname === '/registro') {
    if (user) return NextResponse.redirect(new URL('/', request.url))
    return supabaseResponse
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/admin/:path*', '/chat', '/mis-citas', '/cuenta/:path*', '/login', '/registro'],
}

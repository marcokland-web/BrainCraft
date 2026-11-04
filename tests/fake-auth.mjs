// Gefälschte Google-Anmeldung (Supabase Auth) für die Browser-Tests. Es geht NIE eine Anfrage an Google oder
// an die echte Datenbank: Die Tests fangen /auth/v1/* ab und beantworten sie hier.
//
//  signedIn(storage)   localStorage-Einträge für ein schon angemeldetes Gerät (Sitzung + Familie), JSON-Werte
//  authRoute(route)    Antwort auf /auth/v1/*: authorize leitet mit ?code= zurück zur App, token liefert eine
//                      Sitzung (pkce und refresh_token), logout/user wie Supabase
//  bearerOk(route)     hat die RPC das Zugangstoken der gefälschten Sitzung?

export const FAMILY = 'f0000000-0000-4000-8000-000000000001'
export const USER = { id: 'u0000000-0000-4000-8000-000000000001', email: 'parent@example.org' }

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = () => Math.floor(Date.now() / 1000) + 365 * 86400
export const ACCESS = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', exp: exp(), email: USER.email })}.fake`

export function session() {
  return {
    access_token: ACCESS, token_type: 'bearer', expires_in: 365 * 86400, expires_at: exp(), refresh_token: 'fake-refresh',
    user: { id: USER.id, aud: 'authenticated', role: 'authenticated', email: USER.email, app_metadata: { provider: 'google' }, user_metadata: { full_name: 'Alex Test' }, created_at: '2026-11-01T00:00:00Z' },
  }
}

// Für open({ storage }) der Tests, die Werte als JSON speichern
export function signedIn(extra = {}) {
  return { 'braincraft-auth': session(), 'braincraft:family': FAMILY, ...extra }
}

export const bearerOk = (route) => (route.request().headers().authorization ?? '') === `Bearer ${ACCESS}`

export function authRoute(route, opts = {}) {
  const req = route.request()
  const url = new URL(req.url())
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) })
  opts.log?.push(url.pathname + url.search)
  if (url.pathname.endsWith('/authorize')) {
    const back = new URL(url.searchParams.get('redirect_to'))
    if (opts.noAccess) {
      // So meldet Supabase ein Konto, das nicht angelegt werden darf (signup_disabled / Before-User-Created-Hook)
      back.searchParams.set('error', 'access_denied')
      back.searchParams.set('error_code', 'signup_disabled')
      back.searchParams.set('error_description', 'Signups not allowed for this instance')
    } else if (opts.deny) back.searchParams.set('error', 'access_denied')
    else back.searchParams.set('code', 'fake-auth-code')
    return route.fulfill({ status: 302, headers: { location: back.href } })
  }
  if (url.pathname.endsWith('/token')) return json(session())
  if (url.pathname.endsWith('/logout')) return opts.logoutDown ? route.abort('internetdisconnected') : route.fulfill({ status: 204, headers: cors })
  if (url.pathname.endsWith('/user')) return json(session().user)
  return json({ message: 'not found' }, 404)
}

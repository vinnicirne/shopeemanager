import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request, Response, Router } from 'express'
import { z } from 'zod'

type AuthConfig = { localPassword: string } | { url: string; key: string; loopbackStaging?: boolean; signupRedirect: string }
const credentials = z.object({ email: z.email(), password: z.string().min(1).max(256) })
const signupCredentials = credentials.extend({ password: z.string().min(8).max(256) })
const resetCredentials = z.object({
  accessToken: z.string().max(8192).regex(/^[\w-]+\.[\w-]+\.[\w-]+$/),
  password: signupCredentials.shape.password,
})
const user = z.object({ id: z.uuid(), is_anonymous: z.boolean().optional() })
const session = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  user,
})

function readCookie(req: Request, name: string) {
  const value = req.headers.cookie?.split(';').map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1)
  if (!value) return
  try { return decodeURIComponent(value) }
  catch { return undefined }
}

function matches(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function mountAuth(router: Router, config: AuthConfig) {
  const remote = 'url' in config ? config : undefined
  const staging = remote?.loopbackStaging === true
  const accessCookie = staging ? 'shopee_staging_session' : 'shopee_session'
  const refreshCookie = staging ? 'shopee_staging_refresh' : 'shopee_refresh'
  const cookie = { httpOnly: true, secure: !!remote && (!staging || remote.signupRedirect.startsWith('https:')), sameSite: 'lax' as const, path: '/api' }
  const clearSession = (res: Response) => res.clearCookie(accessCookie, cookie).clearCookie(refreshCookie, cookie)
  const secret = randomBytes(32)
  const localUsers = new Map([['demo@local.test', 'local-owner'], ['leitor@local.test', 'local-reader']])
  const sign = (body: string) => createHmac('sha256', secret).update(body).digest('hex')
  const setAccess = (res: Response, token: string, seconds: number) =>
    res.cookie(accessCookie, token, { ...cookie, maxAge: seconds * 1000 })
  const setSession = (res: Response, data: z.infer<typeof session>) => {
    setAccess(res, data.access_token, data.expires_in)
    res.cookie(refreshCookie, data.refresh_token, cookie)
  }

  function supabase(path: string, options: { body?: object; token?: string; method?: 'POST' | 'PUT' } = {}) {
    if (!remote) throw new Error('Supabase Auth indisponível no modo local.')
    const headers = new Headers({ apikey: remote.key })
    if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
    if (options.body) headers.set('Content-Type', 'application/json')
    return fetch(`${remote.url}/auth/v1${path}`, {
      headers, method: options.method, redirect: 'error',
      body: JSON.stringify(options.body), signal: AbortSignal.timeout(8000),
    })
  }

  async function renew(token: string) {
    const response = await supabase('/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: token } })
    if (response.ok) return session.parse(await response.json())
    if (![400, 401, 403, 422].includes(response.status)) throw new Error('Serviço de autenticação indisponível.')
  }

  router.post('/login', async (req, res) => {
    const { email, password } = credentials.parse(req.body)
    if ('localPassword' in config) {
      const id = localUsers.get(email.toLowerCase())
      if (id && matches(password, config.localPassword)) {
        const seconds = 8 * 3600
        const body = `${id}.${Date.now() + seconds * 1000}`
        setAccess(res, `${body}.${sign(body)}`, seconds).json({ ok: true })
        return
      }
    } else {
      const response = await supabase('/token?grant_type=password', { method: 'POST', body: { email, password } })
      if (response.ok) {
        const data = session.parse(await response.json())
        setSession(res, data)
        res.json({ ok: true })
        return
      }
      if (response.status === 429) {
        res.status(429).json({ error: 'Limite de login atingido. Tente novamente mais tarde.' })
        return
      }
      if (![400, 401, 403, 422].includes(response.status)) throw new Error('Serviço de autenticação indisponível.')
    }
    res.status(401).json({ error: 'E-mail ou senha inválidos.' })
  })

  router.post('/signup', async (req, res) => {
    if (!remote) {
      res.status(403).json({ error: 'O cadastro está disponível no ambiente conectado ao Supabase.' })
      return
    }
    const { email, password } = signupCredentials.parse(req.body)
    const query = new URLSearchParams({ redirect_to: remote.signupRedirect })
    const response = await supabase(`/signup?${query}`, { method: 'POST', body: { email, password } })
    if (response.ok) {
      const data: unknown = await response.json()
      const signedIn = session.safeParse(data)
      if (signedIn.success) {
        setSession(res, signedIn.data)
        res.status(201).json({ confirmationRequired: false })
        return
      }
      user.parse(data)
      res.status(201).json({ confirmationRequired: true })
      return
    }
    const result = z.object({ code: z.string().optional(), error_code: z.string().optional() }).safeParse(await response.json().catch(() => undefined))
    const code = result.data?.code || result.data?.error_code || ''
    if (code === 'user_already_exists' || code === 'email_exists') {
      res.status(201).json({ confirmationRequired: true })
      return
    }
    if (response.status === 429) {
      res.status(429).json({ error: 'Limite de cadastro atingido. Tente novamente mais tarde.' })
      return
    }
    if (['signup_disabled', 'email_provider_disabled'].includes(code)) {
      res.status(403).json({ error: 'O cadastro por e-mail está desabilitado no Supabase.' })
      return
    }
    if (code === 'weak_password') {
      res.status(400).json({ error: 'Escolha uma senha que atenda aos requisitos de segurança do Supabase.' })
      return
    }
    if (response.status >= 500) throw new Error('Serviço de cadastro indisponível.')
    res.status(400).json({ error: 'O Supabase não pôde criar a conta. Confira o e-mail e a senha.' })
  })

  router.post('/recover', async (req, res) => {
    if (!remote) { res.sendStatus(404); return }
    const { email } = credentials.pick({ email: true }).parse(req.body)
    const query = new URLSearchParams({ redirect_to: remote.signupRedirect })
    const response = await supabase(`/recover?${query}`, { method: 'POST', body: { email } })
    const code = response.ok ? '' : (await response.json().catch(() => null))?.error_code
    if (response.ok || code === 'user_not_found' || code === 'email_address_not_authorized' || code === 'over_email_send_rate_limit') {
      res.json({ ok: true })
      return
    }
    if (response.status === 429) {
      res.status(429).json({ error: 'Aguarde antes de solicitar outro link de recuperação.' })
      return
    }
    res.status(502).json({ error: 'Não foi possível enviar o link de recuperação agora. Tente novamente mais tarde.' })
  })

  router.post('/reset-password', async (req, res) => {
    if (!remote) { res.sendStatus(404); return }
    const { accessToken, password } = resetCredentials.parse(req.body)
    const response = await supabase('/user', { method: 'PUT', token: accessToken, body: { password } })
    if (response.ok) {
      clearSession(res).json({ ok: true })
      return
    }
    const code = (await response.json().catch(() => null))?.error_code
    if (code === 'weak_password' || code === 'same_password') {
      res.status(400).json({ error: 'Escolha uma senha diferente da anterior que atenda aos requisitos de segurança.' })
      return
    }
    if (response.status === 401 || response.status === 403) {
      res.status(401).json({ error: 'Este link expirou ou é inválido. Solicite outro link de recuperação.' })
      return
    }
    res.status(502).json({ error: 'Não foi possível alterar a senha agora. Tente novamente mais tarde.' })
  })

  router.post('/logout', async (req, res) => {
    try {
      if (remote) {
        const revoke = (token: string) => supabase('/logout?scope=local', { method: 'POST', token })
        const access = readCookie(req, accessCookie)
        let response = access ? await revoke(access) : undefined
        const refresh = readCookie(req, refreshCookie)
        if (refresh && (!response || response.status === 401 || response.status === 403)) {
          const renewed = await renew(refresh)
          if (renewed) response = await revoke(renewed.access_token)
        }
        if (response && !response.ok && ![401, 403, 404].includes(response.status)) throw new Error('Falha ao encerrar sessão.')
      }
    } catch {
      clearSession(res).status(502).json({ error: 'A sessão foi removida deste navegador. O Supabase não confirmou o encerramento.' })
      return
    }
    clearSession(res).json({ ok: true })
  })

  return async function identify(req: Request, res: Response) {
    const access = readCookie(req, accessCookie)
    if (!remote) {
      const [id, expiration, hash] = access?.split('.') ?? []
      if (id && expiration && hash && Date.now() < Number(expiration) && matches(sign(`${id}.${expiration}`), hash)) return id
      return
    }
    if (access) {
      const response = await supabase('/user', { token: access })
      if (response.ok) {
        const identity = user.parse(await response.json())
        return identity.is_anonymous ? undefined : identity.id
      }
      if (![401, 403].includes(response.status)) throw new Error('Serviço de autenticação indisponível.')
    }
    const refresh = readCookie(req, refreshCookie)
    if (!refresh) return
    const data = await renew(refresh)
    if (!data || data.user.is_anonymous) { clearSession(res); return }
    setSession(res, data)
    return data.user.id
  }
}

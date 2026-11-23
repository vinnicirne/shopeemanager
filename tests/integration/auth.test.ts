import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import express from 'express'
import { mountAuth } from '../../server/auth'

test('Supabase Auth renova a sessão e encerra apenas o login atual', async () => {
  const app = express()
  app.use(express.json())
  const server = app.listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const url = `http://127.0.0.1:${address.port}`
    const user = { id: '9d0221aa-5382-4fb3-88a8-87d88a430c67' }
    let revoked = false
    app.post('/auth/v1/signup', (req, res) => {
      assert.equal(req.header('apikey'), 'test-publishable-key')
      assert.equal(req.query.redirect_to, `${url}/login`)
      assert.equal(req.body.password, 'test-password')
      if (req.body.email === 'confirmed@example.test') {
        res.json({ user, access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 })
        return
      }
      res.json(user)
    })
    app.post('/auth/v1/token', (req, res) => {
      assert.equal(req.header('apikey'), 'test-publishable-key')
      const initial = req.query.grant_type === 'password'
      if (initial && req.body.password !== 'test-password') {
        res.sendStatus(400)
        return
      }
      if (!initial && (revoked || req.body.refresh_token !== 'refresh-1')) {
        res.sendStatus(400)
        return
      }
      const version = initial ? 1 : 2
      res.json({ user, access_token: `access-${version}`, refresh_token: `refresh-${version}`, expires_in: 3600 })
    })
    app.get('/auth/v1/user', (req, res) => {
      if (revoked || req.header('authorization') !== 'Bearer access-1') { res.sendStatus(401); return }
      res.json(user)
    })
    app.post('/auth/v1/logout', (req, res) => {
      assert.equal(req.query.scope, 'local')
      assert.equal(req.header('authorization'), 'Bearer access-2')
      revoked = true
      res.sendStatus(204)
    })
    const api = express.Router()
    app.use('/api', api)
    const identify = mountAuth(api, { url, key: 'test-publishable-key', signupRedirect: `${url}/login` })
    api.get('/protected', async (req, res) => {
      const id = await identify(req, res)
      if (!id) { res.sendStatus(401); return }
      res.json({ id })
    })

    const apiRequest = (path: string, options?: RequestInit) => fetch(`${url}/api${path}`, options)
    const login = (password: string) => apiRequest('/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.test', password }),
    })
    const signup = (email: string) => apiRequest('/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'test-password' }),
    })
    const created = await signup('pending@example.test')
    assert.equal(created.status, 201)
    assert.deepEqual(await created.json(), { confirmationRequired: true })
    assert.equal(created.headers.getSetCookie().length, 0)
    const confirmed = await signup('confirmed@example.test')
    assert.deepEqual(await confirmed.json(), { confirmationRequired: false })
    assert.equal(confirmed.headers.getSetCookie().length, 2)
    assert.equal((await apiRequest('/protected')).status, 401)
    assert.equal((await login('incorrect')).status, 401)
    const signedIn = await login('test-password')
    assert.deepEqual(await signedIn.json(), { ok: true })
    const cookies = signedIn.headers.getSetCookie()
    assert.equal(cookies.length, 2)
    for (const header of cookies) assert.match(header, /Path=\/api;.*HttpOnly; Secure; SameSite=Lax/)
    const identified = await apiRequest('/protected', { headers: { Cookie: 'shopee_session=access-1' } })
    assert.deepEqual(await identified.json(), user)
    const refreshed = await apiRequest('/protected', { headers: { Cookie: 'shopee_refresh=refresh-1' } })
    assert.deepEqual(await refreshed.json(), user)
    assert.ok(refreshed.headers.getSetCookie().some((cookie) => cookie.startsWith('shopee_refresh=refresh-2;')))
    const signedOut = await apiRequest('/logout', { method: 'POST', headers: { Cookie: 'shopee_session=access-2; shopee_refresh=refresh-2' } })
    assert.equal(signedOut.status, 200)
    assert.equal(signedOut.headers.getSetCookie().length, 2)
    assert.equal(revoked, true)
    assert.equal((await apiRequest('/protected')).status, 401)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
      server.closeAllConnections()
    })
  }
})

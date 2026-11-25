import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { forShop, openDatabase } from '../../server/db'
import { decideProposal } from '../../server/operations'
import { ShopeeService } from '../../server/shopee'
import { shopeePaths, openToken, readShopeeConfig, ShopeeClient, type ShopeeConfig } from '../../server/shopee-client'

test('staging habilita o sandbox por configuração e recusa o ambiente live', () => {
  const origin = 'https://staging.example'
  const env = {
    SHOPEE_PARTNER_ID: '701',
    SHOPEE_PARTNER_KEY: 'test-key-not-a-credential',
    SHOPEE_TOKEN_KEY: '11'.repeat(32),
    SHOPEE_ENV: 'sandbox',
  }
  assert.equal(readShopeeConfig({}, undefined, true), undefined)
  assert.equal(readShopeeConfig(env, origin, true)?.mode, 'sandbox')
  assert.equal(readShopeeConfig(env, origin, true)?.writes, false)
  assert.equal(readShopeeConfig({ ...env, SHOPEE_ENABLE_WRITES: 'true' }, origin, true)?.writes, true)
  assert.throws(() => readShopeeConfig(env, 'http://localhost:4174', true), /APP_ORIGIN HTTPS/)
  assert.throws(() => readShopeeConfig({ ...env, SHOPEE_ENV: 'live' }, origin, true), /somente o sandbox/)
  assert.equal(readShopeeConfig({ ...env, SHOPEE_ENV: 'live' }, origin)?.mode, 'live')
})

test('Shopee autoriza uma vez, sincroniza catálogo, pedidos e anúncios e concilia uma escrita incerta', async (t) => {
  const db = await openDatabase()
  t.after(() => db.close())
  await db.query("INSERT INTO manager.shops (id,name) VALUES ('shopp','Loja de teste'),('outra','Outra loja')")
  await db.query("INSERT INTO manager.members VALUES ('shopp','owner-1','owner'),('outra','owner-2','owner')")
  const config: ShopeeConfig = { partner: 701, key: 'test-key-not-a-credential', encryption: Buffer.alloc(32, 11), origin: 'https://escritorio.example', mode: 'sandbox', writes: true, ads: true }
  let externalPrice = 70
  let writes = 0
  let readPrices = 0
  const calls: string[] = []
  const token = { access_token: 'token-contrato', refresh_token: 'refresh-contrato', expire_in: 14400, shop_id: 42 }
  const wrapped = (response: unknown) => Response.json({ error: '', request_id: 'trace-test', response })
  const transport: typeof fetch = async (input, options) => {
    const url = new URL(String(input))
    assert.equal(url.hostname, 'partner.test-stable.shopeemobile.com')
    const path = url.pathname
    const timestamp = url.searchParams.get('timestamp')
    const shopToken = path === shopeePaths.token || path === shopeePaths.refresh ? '' : 'token-contrato42'
    const expected = createHmac('sha256', config.key).update(`${config.partner}${path}${timestamp}${shopToken}`).digest('hex')
    assert.equal(url.searchParams.get('sign'), expected)
    calls.push(path)
    switch (path) {
      case shopeePaths.token:
        assert.equal(options?.method, 'POST')
        assert.deepEqual(JSON.parse(String(options?.body)), { code: 'code-contrato', shop_id: 42, partner_id: 701 })
        return Response.json(token)
      case shopeePaths.refresh:
        assert.deepEqual(JSON.parse(String(options?.body)), { refresh_token: token.refresh_token, shop_id: 42, partner_id: 701 })
        return Response.json(token)
      case shopeePaths.items:
        assert.deepEqual(url.searchParams.getAll('item_status'), ['NORMAL', 'UNLIST'])
        return Response.json({ error: '', request_id: 'unexpected trace format', response: { item: [{ item_id: 4001 }], has_next_page: false } })
      case shopeePaths.itemInfo:
        readPrices++
        assert.equal(url.searchParams.get('item_id_list'), '4001')
        return wrapped({ item_list: [{ item_id: 4001, item_name: 'Organizador', has_model: false, price_info: [{ currency: 'BRL', original_price: externalPrice }], stock_info_v2: { summary_info: { total_available_stock: 3 } } }] })
      case shopeePaths.orderList:
        assert.equal(url.searchParams.get('order_status'), 'COMPLETED')
        return wrapped({ more: false, order_list: [{ order_sn: 'order-test' }] })
      case shopeePaths.orderDetail:
        assert.equal(url.searchParams.get('response_optional_fields'), 'item_list')
        return wrapped({ order_list: [{ order_sn: 'order-test', currency: 'BRL', order_status: 'COMPLETED', buyer_cpf_id: 'sensitive-example', item_list: [{ item_id: 4001, model_id: 0, model_quantity_purchased: 2, model_discounted_price: 45.25 }] }] })
      case shopeePaths.ads:
        assert.equal(url.searchParams.get('start_date'), '19-11-2026')
        return wrapped([{ date: '19-11-2026', impression: 120, clicks: 8, direct_conversions: 2, expense: 3.21 }])
      case shopeePaths.price:
        writes++
        assert.deepEqual(JSON.parse(String(options?.body)), { item_id: 4001, price_list: [{ model_id: 0, original_price: 75 }] })
        externalPrice = 75
        throw new DOMException('Teste: operação aplicada antes de expirar', 'TimeoutError')
      default:
        throw new Error(`Unexpected path ${path}`)
    }
  }
  const service = new ShopeeService(db, new ShopeeClient(config, transport))
  const auth = new URL(await service.authorization('shopp', 'owner-1'))
  assert.equal(auth.origin, 'https://open.test-stable.shopee.com')
  assert.equal(auth.searchParams.get('redirect_uri'), 'https://escritorio.example/api/shopee/callback')
  assert.ok(!auth.href.includes(config.key))
  const state = auth.searchParams.get('state')!
  assert.equal(await service.connect('owner-2', state, 'code-contrato', 42), false)
  assert.equal(await service.connect('owner-1', state, 'code-contrato', 42), true)
  assert.equal(await service.connect('owner-1', state, 'code-contrato', 42), false)
  const sealed = (await db.query<{ sealed: string }>("SELECT sealed FROM manager.shopee_links WHERE shop_id='shopp'")).rows[0].sealed
  assert.equal(sealed.includes('token-contrato'), false)
  assert.throws(() => openToken(config, 'outra', sealed))
  const tokens = openToken(config, 'shopp', sealed)
  assert.equal(tokens.id, 42)
  const { sealToken } = await import('../../server/shopee-client')
  await db.query("UPDATE manager.shopee_links SET sealed=$1 WHERE shop_id='shopp'", [sealToken(config, 'shopp', { ...tokens, expiry: 0 })])

  assert.equal(await service.queue('shopp', 'owner-1', '2026-11-19'), true)
  assert.equal(await service.queue('shopp', 'owner-1', '2026-11-19'), false)
  assert.equal(await service.sync('another-shop'), false)
  assert.equal((await service.view('shopp', true)).status, 'queued')
  assert.equal(await service.sync('shopp'), true)
  for (let i = 0; i < 3; i++) await service.tick()
  assert.ok(calls.includes(shopeePaths.refresh))
  const view = await service.view('shopp', true)
  assert.equal(view.status, 'done')
  assert.deepEqual(view.ads, [{ period: '2026-11-19', impressions: 120, clicks: 8, conversions: 2, expense: 3.21 }])
  assert.equal((await service.view('outra', true)).connected, false)
  const product = (await db.query<{ sku: string; units: number; revenue: number; stock: number }>("SELECT sku,units,revenue,stock FROM manager.products WHERE shop_id='shopp'")).rows[0]
  assert.deepEqual({ ...product, revenue: Number(product.revenue) }, { sku: 'SHOPEE-4001', units: 2, revenue: 90.5, stock: 3 })
  assert.equal((await db.query("SELECT 1 FROM manager.audit WHERE details::text LIKE '%sensitive-example%'")).rows.length, 0)

  const proposal = (await db.query<{ id: string }>(`
    INSERT INTO manager.proposals (shop_id,sku,price,previous_price,product_version,evidence,author)
    SELECT shop_id,sku,75,price,version,'evidência do teste','owner-1' FROM manager.products WHERE shop_id='shopp' RETURNING id
  `)).rows[0].id
  assert.equal(writes, 0)
  assert.equal(await decideProposal(forShop(db, 'shopp'), 'shopp', proposal, 'owner-1', true, true), 'approved')
  assert.equal(await decideProposal(forShop(db, 'shopp'), 'shopp', proposal, 'owner-1', true, true), null)
  await service.tick()
  assert.equal((await db.query<{ status: string }>('SELECT status FROM manager.proposals WHERE id=$1', [proposal])).rows[0].status, 'uncertain')
  await service.tick()
  await service.tick()
  assert.equal(writes, 1)
  assert.ok(readPrices >= 3)
  assert.equal((await db.query<{ status: string }>('SELECT status FROM manager.proposals WHERE id=$1', [proposal])).rows[0].status, 'applied')
  assert.equal((await db.query("SELECT 1 FROM manager.audit WHERE event='Resultado de alteração Shopee'")).rows.length, 2)
})

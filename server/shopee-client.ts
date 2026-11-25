import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { z } from 'zod'

export interface ShopeeConfig {
  partner: number
  key: string
  encryption: Buffer
  origin: string
  mode: 'sandbox' | 'live'
  writes: boolean
  ads: boolean
}
export interface ShopToken { id: number; access: string; refresh: string; expiry: number }
type Params = Record<string, string | number | string[]>

export const shopeePaths = {
  token: '/api/v2/auth/token/get',
  refresh: '/api/v2/auth/access_token/get',
  items: '/api/v2/product/get_item_list',
  itemInfo: '/api/v2/product/get_item_base_info',
  models: '/api/v2/product/get_model_list',
  orderList: '/api/v2/order/get_order_list',
  orderDetail: '/api/v2/order/get_order_detail',
  price: '/api/v2/product/update_price',
  ads: '/api/v2/ads/get_all_cpc_ads_daily_performance',
} as const

const platform = {
  sandbox: { api: 'https://partner.test-stable.shopeemobile.com', auth: 'https://open.test-stable.shopee.com' },
  live: { api: 'https://partner.shopeemobile.com', auth: 'https://open.shopee.com' },
}
const envelope = z.object({
  error: z.string().optional(),
  request_id: z.string().regex(/^[a-zA-Z0-9_.:-]{1,150}$/).optional().catch(undefined),
  response: z.unknown().optional(),
})
const identifier = z.number().int().nonnegative()
const priceInfo = z.object({ currency: z.string(), original_price: z.number().nonnegative() })
const stockInfo = z.object({ summary_info: z.object({ total_available_stock: z.number().int().nonnegative() }) })
const itemInfo = z.object({
  item_id: identifier, item_name: z.string().min(1), item_sku: z.string().optional(), has_model: z.boolean().optional(),
  price_info: z.array(priceInfo).optional(), stock_info_v2: stockInfo.optional(), item_status: z.string().nullish(),
})
const modelInfo = z.object({
  model_id: identifier, model_sku: z.string().optional(), model_status: z.string().optional(),
  price_info: z.array(priceInfo).optional(), stock_info_v2: stockInfo.optional(),
})
const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expire_in: z.number().positive(), shop_id: identifier.optional() })

export class ShopeeError extends Error {
  constructor(public code: string, public requestId?: string) { super(code) }
}

export function readShopeeConfig(env: NodeJS.ProcessEnv, origin?: string, sandboxOnly = false): ShopeeConfig | undefined {
  if (!env.SHOPEE_PARTNER_ID && !env.SHOPEE_PARTNER_KEY && !env.SHOPEE_TOKEN_KEY) return
  const values = z.object({
    SHOPEE_PARTNER_ID: z.coerce.number().int().positive(),
    SHOPEE_PARTNER_KEY: z.string().min(16),
    SHOPEE_TOKEN_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
    SHOPEE_ENV: z.enum(['sandbox', 'live']).default('sandbox'),
  }).parse(env)
  if (sandboxOnly && values.SHOPEE_ENV !== 'sandbox') throw new Error('O staging aceita somente o sandbox da Shopee.')
  if (!origin || new URL(origin).protocol !== 'https:') throw new Error('A autorização Shopee requer APP_ORIGIN HTTPS.')
  return { origin, mode: values.SHOPEE_ENV, partner: values.SHOPEE_PARTNER_ID, key: values.SHOPEE_PARTNER_KEY, encryption: Buffer.from(values.SHOPEE_TOKEN_KEY, 'hex'), writes: env.SHOPEE_ENABLE_WRITES === 'true', ads: env.SHOPEE_ENABLE_ADS === 'true' }
}

export function sealToken(config: ShopeeConfig, scope: string, token: ShopToken) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', config.encryption, iv)
  cipher.setAAD(Buffer.from(`${config.mode}:${scope}`))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(token)), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
}

export function openToken(config: ShopeeConfig, scope: string, value: string): ShopToken {
  const [iv, tag, data] = value.split('.').map((part) => Buffer.from(part, 'base64url'))
  const decipher = createDecipheriv('aes-256-gcm', config.encryption, iv)
  decipher.setAAD(Buffer.from(`${config.mode}:${scope}`))
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString())
}

export class ShopeeClient {
  constructor(readonly config: ShopeeConfig, private readonly transport = fetch, private readonly clock = Date.now) {}

  authorize(state: string) {
    const url = new URL('/auth', platform[this.config.mode].auth)
    url.search = new URLSearchParams({ partner_id: String(this.config.partner), auth_type: 'seller', redirect_uri: new URL('/api/shopee/callback', this.config.origin).href, response_type: 'code', state }).toString()
    return url.href
  }

  private async call(path: string, token?: ShopToken, params: Params = {}, body?: Record<string, unknown>) {
    const timestamp = Math.floor(this.clock() / 1000)
    const { partner, key, mode } = this.config
    const common = `${partner}${path}${timestamp}${token ? `${token.access}${token.id}` : ''}`
    const url = new URL(path, platform[mode].api)
    url.searchParams.set('partner_id', String(partner))
    url.searchParams.set('timestamp', String(timestamp))
    url.searchParams.set('sign', createHmac('sha256', key).update(common).digest('hex'))
    if (token) {
      url.searchParams.set('shop_id', String(token.id))
      url.searchParams.set('access_token', token.access)
    }
    for (const [name, value] of Object.entries(params)) {
      for (const entry of Array.isArray(value) ? value : [value]) url.searchParams.append(name, String(entry))
    }
    const response = await this.transport(url, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
      ...(body && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new ShopeeError(`http_${response.status}`)
    const raw: unknown = await response.json()
    const result = envelope.parse(raw)
    if (result.error && result.error !== '-') {
      throw new ShopeeError(/^[a-z0-9_.-]{1,80}$/i.test(result.error) ? result.error : 'api_error', result.request_id)
    }
    return { raw, response: result.response, request: result.request_id }
  }

  private async getToken(path: string, shop: number, credentials: Record<string, unknown>): Promise<ShopToken> {
    const { raw } = await this.call(path, undefined, {}, { ...credentials, shop_id: shop, partner_id: this.config.partner })
    const token = tokenSchema.parse(raw)
    if (token.shop_id !== undefined && token.shop_id !== shop) throw new ShopeeError('shop_mismatch')
    return { id: shop, access: token.access_token, refresh: token.refresh_token, expiry: this.clock() + Math.min(token.expire_in, 14400) * 1000 }
  }

  exchange(code: string, shop: number) { return this.getToken(shopeePaths.token, shop, { code }) }
  refresh(token: ShopToken) { return this.getToken(shopeePaths.refresh, token.id, { refresh_token: token.refresh }) }

  async listItems(token: ShopToken, offset: number) {
    const { response } = await this.call(shopeePaths.items, token, { offset, page_size: 20, item_status: ['NORMAL', 'UNLIST'] })
    return z.object({ item: z.array(z.object({ item_id: identifier, item_status: z.string().nullish() })).default([]), has_next_page: z.boolean(), next_offset: z.number().int().nonnegative().optional() }).parse(response)
  }

  async itemDetails(token: ShopToken, items: number[]) {
    const { response } = await this.call(shopeePaths.itemInfo, token, { item_id_list: items.join(',') })
    return z.object({ item_list: z.array(itemInfo) }).parse(response).item_list
  }

  async models(token: ShopToken, item: number) {
    const { response } = await this.call(shopeePaths.models, token, { item_id: item })
    return z.object({ model: z.array(modelInfo) }).parse(response).model
  }

  async orderPage(token: ShopToken, from: number, to: number, cursor: string) {
    const { response } = await this.call(shopeePaths.orderList, token, { time_range_field: 'create_time', time_from: from, time_to: to, page_size: 40, order_status: 'COMPLETED', ...(cursor ? { cursor } : {}) })
    return z.object({ more: z.boolean(), next_cursor: z.string().optional(), order_list: z.array(z.object({ order_sn: z.string().min(1).max(40) })) }).parse(response)
  }

  async orderDetails(token: ShopToken, orders: string[]) {
    const { response } = await this.call(shopeePaths.orderDetail, token, { order_sn_list: orders.join(','), response_optional_fields: 'item_list' })
    return z.object({ order_list: z.array(z.object({
      order_sn: z.string(), currency: z.string(), order_status: z.string(),
      item_list: z.array(z.object({ item_id: identifier, model_id: identifier, model_quantity_purchased: z.number().int().nonnegative(), model_discounted_price: z.number().nonnegative() })),
    })) }).parse(response).order_list
  }

  async currentPrice(token: ShopToken, item: number, model: number) {
    const listing = model ? (await this.models(token, item)).find((record) => record.model_id === model) : (await this.itemDetails(token, [item]))[0]
    const value = listing?.price_info?.find((price) => price.currency === 'BRL')?.original_price
    if (value === undefined) throw new ShopeeError('price_unavailable')
    return value
  }

  async writePrice(token: ShopToken, item: number, model: number, price: number) {
    const { response, request } = await this.call(shopeePaths.price, token, {}, { item_id: item, price_list: [{ model_id: model, original_price: price }] })
    const result = z.object({ success_list: z.array(z.object({ model_id: identifier, original_price: z.number() })).default([]) }).parse(response)
    if (!result.success_list.some((entry) => entry.model_id === model && Math.round(entry.original_price * 100) === Math.round(price * 100))) throw new ShopeeError('price_not_confirmed', request)
    return request
  }

  async adsPerformance(token: ShopToken, period: string) {
    const date = period.split('-').reverse().join('-')
    const { response } = await this.call(shopeePaths.ads, token, { start_date: date, end_date: date })
    const results = z.array(z.object({ date: z.string(), impression: z.number().nonnegative(), clicks: z.number().nonnegative(), direct_conversions: z.number().nonnegative(), expense: z.number().nonnegative() })).parse(response)
    const entry = results.find((record) => record.date === date)
    return entry ? { impressions: entry.impression, clicks: entry.clicks, conversions: entry.direct_conversions, expense: entry.expense } : null
  }
}

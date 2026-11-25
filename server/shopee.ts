import { createHash, randomBytes } from 'node:crypto'
import { ZodError } from 'zod'
import type { Snapshot } from '../packages/contracts/src/index.js'
import { record, type Database, type DatabaseQuery } from './db.js'
import { openToken, sealToken, ShopeeClient, ShopeeError } from './shopee-client.js'

type ConnectionView = Snapshot['shopee']
type SyncJob = { shop_id: string; phase: 'catalog' | 'orders' | 'ads'; period: string; page_offset: number; cursor: string; lease: string }
type PriceJob = { proposal_id: string; shop_id: string; item: string; model: string; status: 'sending' | 'uncertain'; lease: string; sku: string; price: number; previous_price: number; stale: boolean }
type Link = { sealed: string; mode: 'sandbox' | 'live' }
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const regionDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
const todayInBrazil = () => regionDate.format(new Date())
const yesterday = () => new Date(Date.parse(`${todayInBrazil()}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)
const skuFor = (item: number, model: number) => `SHOPEE-${item}${model ? `-${model}` : ''}`
const twoDecimals = (amount: number) => Math.round(amount * 100)
function failure(error: unknown) {
  if (error instanceof ShopeeError) return { error: error.code, request: error.requestId }
  const operation = error instanceof Error ? error.stack?.match(/\bat ShopeeClient\.(\w+)/)?.[1] : undefined
  if (error instanceof ZodError) {
    return {
      error: 'resposta_shopee_invalida', operation,
      fields: error.issues.slice(0, 8).map(({ code, path }) => ({ code, field: path.join('.') })),
    }
  }
  return { error: 'falha_de_resposta_ou_conexao', operation, type: error instanceof Error ? error.name : undefined }
}

export class ShopeeService {
  constructor(private readonly db: Database, readonly client: ShopeeClient) {}

  async authorization(shop: string, user: string) {
    const state = randomBytes(32).toString('base64url')
    await this.db.query(`
      INSERT INTO manager.shopee_auth (state_hash,shop_id,user_id) VALUES ($1,$2,$3)
      ON CONFLICT (shop_id) DO UPDATE SET state_hash=EXCLUDED.state_hash,user_id=EXCLUDED.user_id,expires_at=EXCLUDED.expires_at
    `, [sha(state), shop, user])
    return this.client.authorize(state)
  }

  async connect(user: string, state: string, code: string, remoteId: number) {
    const scope = (await this.db.query<{ shop_id: string }>(`
      DELETE FROM manager.shopee_auth a USING manager.members m
      WHERE a.state_hash=$1 AND a.user_id=$2 AND a.expires_at>now()
        AND m.shop_id=a.shop_id AND m.user_id=a.user_id AND m.role='owner'
      RETURNING a.shop_id
    `, [sha(state), user])).rows[0]
    if (!scope) return false
    const current = (await this.db.query<{ remote_id: string; mode: string }>('SELECT remote_id,mode FROM manager.shopee_links WHERE shop_id=$1', [scope.shop_id])).rows[0]
    if (current && (String(current.remote_id) !== String(remoteId) || current.mode !== this.client.config.mode)) throw new ShopeeError('loja_diferente_ou_ambiente_diferente')
    const token = await this.client.exchange(code, remoteId)
    await this.db.transaction(async (tx) => {
      const linked = await tx.query(`
        INSERT INTO manager.shopee_links (shop_id,remote_id,mode,sealed) VALUES ($1,$2,$3,$4)
        ON CONFLICT (shop_id) DO UPDATE SET sealed=EXCLUDED.sealed,connected_at=now()
        WHERE manager.shopee_links.remote_id=EXCLUDED.remote_id AND manager.shopee_links.mode=EXCLUDED.mode
        RETURNING shop_id
      `, [scope.shop_id, remoteId, this.client.config.mode, sealToken(this.client.config, scope.shop_id, token)])
      if (!linked.rows.length) throw new ShopeeError('loja_diferente_ou_ambiente_diferente')
      await record(tx, scope.shop_id, 'Loja Shopee autorizada', user, { remoteId, mode: this.client.config.mode })
    })
    return true
  }

  async view(shop: string, showAds: boolean): Promise<ConnectionView> {
    const connected = !!(await this.db.query('SELECT 1 FROM manager.shopee_links WHERE shop_id=$1 AND mode=$2', [shop, this.client.config.mode])).rows.length
    const job = (await this.db.query<{ status: ConnectionView['status']; updated_at: string; error: string | null }>(
      'SELECT status,updated_at,error FROM manager.shopee_jobs WHERE shop_id=$1', [shop],
    )).rows[0]
    const ads = showAds && connected && this.client.config.ads ? (await this.db.query<ConnectionView['ads'][number]>(
      'SELECT period::text, (metrics->>\'impressions\')::bigint::float AS impressions,(metrics->>\'clicks\')::bigint::float AS clicks,(metrics->>\'conversions\')::float AS conversions,(metrics->>\'expense\')::float AS expense FROM manager.shopee_ads WHERE shop_id=$1 ORDER BY period DESC LIMIT 30', [shop],
    )).rows : []
    return { mode: this.client.config.mode, connected, adsEnabled: this.client.config.ads, writes: connected && this.client.config.writes, status: job?.status || null, updated: job?.updated_at || null, error: job?.error || null, ads }
  }

  async queue(shop: string, actor: string, period = yesterday()) {
    if (period >= todayInBrazil()) throw new ShopeeError('data_incompleta')
    return this.db.transaction(async (tx) => {
      const result = await tx.query(`
        INSERT INTO manager.shopee_jobs (shop_id,status,period)
        SELECT shop_id,'queued',$3 FROM manager.shopee_links WHERE shop_id=$1 AND mode=$2
        ON CONFLICT (shop_id) DO UPDATE SET status='queued',
          phase=CASE WHEN manager.shopee_jobs.status='failed' AND manager.shopee_jobs.period=EXCLUDED.period THEN manager.shopee_jobs.phase ELSE 'catalog' END,
          page_offset=CASE WHEN manager.shopee_jobs.status='failed' AND manager.shopee_jobs.period=EXCLUDED.period THEN manager.shopee_jobs.page_offset ELSE 0 END,
          cursor=CASE WHEN manager.shopee_jobs.status='failed' AND manager.shopee_jobs.period=EXCLUDED.period THEN manager.shopee_jobs.cursor ELSE '' END,
          period=EXCLUDED.period,error=NULL,updated_at=now()
        WHERE manager.shopee_jobs.status IN ('failed','done') RETURNING shop_id
      `, [shop, this.client.config.mode, period])
      if (result.rows.length) await record(tx, shop, 'Sincronização Shopee solicitada', actor, { period })
      return !!result.rows.length
    })
  }

  private async token(shop: string) {
    return this.db.transaction(async (tx) => {
      const link = (await tx.query<Link>('SELECT sealed,mode FROM manager.shopee_links WHERE shop_id=$1 AND mode=$2 FOR UPDATE', [shop, this.client.config.mode])).rows[0]
      if (!link) throw new ShopeeError('loja_nao_conectada')
      const token = openToken(this.client.config, shop, link.sealed)
      if (Date.now() + 60000 < token.expiry) return token
      const fresh = await this.client.refresh(token)
      await tx.query('UPDATE manager.shopee_links SET sealed=$1 WHERE shop_id=$2', [sealToken(this.client.config, shop, fresh), shop])
      return fresh
    })
  }

  private async catalog(job: SyncJob, token: Awaited<ReturnType<ShopeeService['token']>>) {
    const page = await this.client.listItems(token, job.page_offset)
    if (page.has_next_page && (!page.next_offset || page.next_offset <= job.page_offset)) throw new ShopeeError('paginacao_invalida')
    const items = page.item.length ? await this.client.itemDetails(token, page.item.map(({ item_id }) => item_id)) : []
    if (items.length !== page.item.length) throw new ShopeeError('catalogo_incompleto')
    const statuses = new Map(page.item.map(({ item_id, item_status }) => [item_id, item_status]))
    const products: { item: number; model: number; name: string; price: number; stock: number; status: string | null }[] = []
    for (const item of items) {
      const append = (model: number, name: string, listing: Pick<typeof item, 'price_info' | 'stock_info_v2'>) => {
        const price = listing.price_info?.find((info) => info.currency === 'BRL')?.original_price
        const stock = listing.stock_info_v2?.summary_info.total_available_stock
        if (price === undefined || stock === undefined) throw new ShopeeError('produto_sem_preco_brl_ou_estoque')
        const status = item.item_status ?? statuses.get(item.item_id) ?? null
        products.push({ item: item.item_id, model, name: name.slice(0, 200), price, stock, status })
      }
      if (item.has_model) {
        for (const model of await this.client.models(token, item.item_id)) {
          if (model.model_status === 'MODEL_DELETED') continue
          append(model.model_id, `${item.item_name} · ${model.model_sku || model.model_id}`, model)
        }
      } else append(0, item.item_name, item)
    }
    await this.stage(job, async (tx) => {
      for (const row of products) await tx.query(`
        INSERT INTO manager.products (shop_id,sku,name,price,stock,units,revenue,shopee_item,shopee_model,shopee_status)
        VALUES ($1,$2,$3,$4,$5,0,0,$6,$7,$8)
        ON CONFLICT (shop_id,sku) DO UPDATE SET name=EXCLUDED.name,price=EXCLUDED.price,stock=EXCLUDED.stock,
          shopee_item=EXCLUDED.shopee_item,shopee_model=EXCLUDED.shopee_model,shopee_status=EXCLUDED.shopee_status,
          version=manager.products.version+CASE WHEN manager.products.price <> EXCLUDED.price THEN 1 ELSE 0 END
      `, [job.shop_id, skuFor(row.item, row.model), row.name, row.price, row.stock, row.item, row.model, row.status])
      await tx.query("UPDATE manager.shopee_jobs SET phase=$1,page_offset=$2 WHERE shop_id=$3", [page.has_next_page ? 'catalog' : 'orders', page.next_offset || 0, job.shop_id])
    })
  }

  private async orders(job: SyncJob, token: Awaited<ReturnType<ShopeeService['token']>>) {
    const start = Date.parse(`${job.period}T00:00:00-03:00`) / 1000
    const page = await this.client.orderPage(token, start, start + 86400 - 1, job.cursor)
    if (page.more && (!page.next_cursor || page.next_cursor === job.cursor)) throw new ShopeeError('paginacao_invalida')
    const orders = page.order_list.length ? await this.client.orderDetails(token, page.order_list.map(({ order_sn }) => order_sn)) : []
    if (orders.length !== page.order_list.length) throw new ShopeeError('pedidos_incompletos')
    await this.stage(job, async (tx) => {
      for (const order of orders) {
        if (order.currency !== 'BRL' || order.order_status !== 'COMPLETED') continue
        const totals = new Map<string, { units: number; cents: number }>()
        for (const item of order.item_list) {
          const sku = skuFor(item.item_id, item.model_id)
          const total = totals.get(sku) || { units: 0, cents: 0 }
          total.units += item.model_quantity_purchased
          total.cents += item.model_quantity_purchased * twoDecimals(item.model_discounted_price)
          totals.set(sku, total)
        }
        for (const [sku, total] of totals) await tx.query(`
          INSERT INTO manager.shopee_sales VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (shop_id,period,order_sn,sku) DO UPDATE SET units=EXCLUDED.units,revenue=EXCLUDED.revenue
        `, [job.shop_id, job.period, order.order_sn, sku, total.units, total.cents / 100])
      }
      if (!page.more) {
        await tx.query(`
          INSERT INTO manager.sales_observations (shop_id,period,sku,units,revenue)
          SELECT shop_id,period,sku,sum(units),sum(revenue) FROM manager.shopee_sales
          WHERE shop_id=$1 AND period=$2 GROUP BY shop_id,period,sku
          ON CONFLICT (shop_id,period,sku) DO UPDATE SET units=EXCLUDED.units,revenue=EXCLUDED.revenue
        `, [job.shop_id, job.period])
        await tx.query(`
          UPDATE manager.products p SET units=COALESCE((SELECT o.units FROM manager.sales_observations o WHERE o.shop_id=p.shop_id AND o.sku=p.sku AND o.period=$2),0),
            revenue=COALESCE((SELECT o.revenue FROM manager.sales_observations o WHERE o.shop_id=p.shop_id AND o.sku=p.sku AND o.period=$2),0)
          WHERE p.shop_id=$1 AND p.shopee_item IS NOT NULL
        `, [job.shop_id, job.period])
      }
      await tx.query('UPDATE manager.shopee_jobs SET phase=$1,cursor=$2,status=$3 WHERE shop_id=$4', [
        !page.more && this.client.config.ads ? 'ads' : 'orders', page.more ? page.next_cursor : '', !page.more && !this.client.config.ads ? 'done' : 'queued', job.shop_id,
      ])
      if (!page.more && !this.client.config.ads) await record(tx, job.shop_id, 'Sincronização Shopee concluída', 'Shopee', { period: job.period })
    })
  }

  private async ads(job: SyncJob, token: Awaited<ReturnType<ShopeeService['token']>>) {
    const metrics = await this.client.adsPerformance(token, job.period)
    await this.stage(job, async (tx) => {
      if (metrics) await tx.query(`
        INSERT INTO manager.shopee_ads VALUES ($1,$2,$3)
        ON CONFLICT (shop_id,period) DO UPDATE SET metrics=EXCLUDED.metrics
      `, [job.shop_id, job.period, JSON.stringify(metrics)])
      await tx.query("UPDATE manager.shopee_jobs SET status='done' WHERE shop_id=$1", [job.shop_id])
      await record(tx, job.shop_id, 'Sincronização Shopee concluída', 'Shopee', { period: job.period, ads: !!metrics })
    })
  }

  private async stage(job: SyncJob, work: (tx: DatabaseQuery) => Promise<void>) {
    await this.db.transaction(async (tx) => {
      const valid = await tx.query(`
        UPDATE manager.shopee_jobs SET status='queued',lease=NULL,deadline=NULL,updated_at=now()
        WHERE shop_id=$1 AND lease=$2 AND deadline>now() RETURNING shop_id
      `, [job.shop_id, job.lease])
      if (valid.rows.length) await work(tx)
    })
  }

  async sync(shop?: string): Promise<boolean> {
    const job = (await this.db.query<SyncJob>(`
      UPDATE manager.shopee_jobs SET status='running',lease=gen_random_uuid(),deadline=now()+interval '4 minutes',updated_at=now()
      WHERE shop_id=(SELECT j.shop_id FROM manager.shopee_jobs j JOIN manager.shopee_links l USING(shop_id)
        WHERE l.mode=$1 AND ($2::text IS NULL OR j.shop_id=$2)
          AND (j.status='queued' OR (j.status='running' AND j.deadline<now()))
        ORDER BY j.updated_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED)
      RETURNING shop_id,phase,period::text,page_offset,cursor,lease
    `, [this.client.config.mode, shop ?? null])).rows[0]
    if (!job) return false
    try {
      const token = await this.token(job.shop_id)
      if (job.phase === 'catalog') await this.catalog(job, token)
      else if (job.phase === 'orders') await this.orders(job, token)
      else await this.ads(job, token)
    } catch (error) {
      const details = failure(error)
      await this.stage(job, async (tx) => {
        await tx.query("UPDATE manager.shopee_jobs SET status='failed',error=$1 WHERE shop_id=$2", [details.error, job.shop_id])
        await record(tx, job.shop_id, 'Sincronização Shopee interrompida', 'Shopee', { phase: job.phase, ...details })
      })
    }
    return true
  }

  private async savePrice(job: PriceJob, status: 'applied' | 'uncertain' | 'expired', details: Record<string, unknown>) {
    await this.db.transaction(async (tx) => {
      const changed = await tx.query(`
        UPDATE manager.shopee_price_operations SET status=$1,lease=NULL,deadline=NULL,external_ref=coalesce($2,external_ref),
          checked_at=CASE WHEN $5 THEN now() ELSE checked_at END
        WHERE proposal_id=$3 AND lease=$4 RETURNING proposal_id
      `, [status, details.request || null, job.proposal_id, job.lease, job.status === 'uncertain'])
      if (!changed.rows.length) return
      await tx.query('UPDATE manager.proposals SET status=$1 WHERE id=$2 AND shop_id=$3', [status, job.proposal_id, job.shop_id])
      if (status === 'applied') await tx.query('UPDATE manager.products SET price=$1,version=version+1 WHERE shop_id=$2 AND sku=$3 AND price<>$1', [job.price, job.shop_id, job.sku])
      await record(tx, job.shop_id, 'Resultado de alteração Shopee', 'Shopee', { proposal: job.proposal_id, status, ...details })
    })
  }

  private async price() {
    const job = (await this.db.query<PriceJob>(`
      WITH next AS (
        SELECT o.proposal_id FROM manager.shopee_price_operations o JOIN manager.shopee_links l USING(shop_id)
        WHERE l.mode=$1 AND (
          (o.status='queued' AND $2::boolean AND NOT EXISTS (
            SELECT 1 FROM manager.shopee_price_operations active
            WHERE active.shop_id=o.shop_id AND active.item=o.item AND active.model=o.model AND active.status IN ('sending','uncertain')
          )) OR (o.status='sending' AND o.deadline<now())
          OR (o.status='uncertain' AND o.checked_at IS NULL AND (o.deadline IS NULL OR o.deadline<now()))
        )
        ORDER BY (o.status='queued'),o.created_at LIMIT 1 FOR UPDATE OF o SKIP LOCKED
      ), claimed AS (
        UPDATE manager.shopee_price_operations o SET status=CASE WHEN o.status='queued' THEN 'sending' ELSE 'uncertain' END,
          lease=gen_random_uuid(),deadline=now()+interval '45 seconds'
        FROM next WHERE o.proposal_id=next.proposal_id RETURNING o.*
      )
      SELECT c.*,p.sku,p.price,p.previous_price,(p.expires_at<=now() OR p.product_version<>pr.version) AS stale
      FROM claimed c JOIN manager.proposals p ON c.proposal_id=p.id AND p.shop_id=c.shop_id
      JOIN manager.products pr ON pr.shop_id=p.shop_id AND pr.sku=p.sku
    `, [this.client.config.mode, this.client.config.writes])).rows[0]
    if (!job) return
    const item = Number(job.item)
    const model = Number(job.model)
    try {
      if (job.status === 'sending' && job.stale) {
        await this.savePrice(job, 'expired', { reason: 'prazo_ou_versao' })
        return
      }
      const token = await this.token(job.shop_id)
      const current = twoDecimals(await this.client.currentPrice(token, item, model))
      if (job.status === 'uncertain') {
        await this.savePrice(job, current === twoDecimals(job.price) ? 'applied' : 'uncertain', { reason: 'conciliacao_por_leitura' })
        return
      }
      if (current !== twoDecimals(job.previous_price) || current === twoDecimals(job.price)) {
        await this.savePrice(job, 'expired', { reason: 'preco_externo_divergente' })
        return
      }
      const valid = (await this.db.query(`
        SELECT 1 FROM manager.shopee_price_operations o JOIN manager.proposals p ON p.id=o.proposal_id
        JOIN manager.products pr ON pr.shop_id=p.shop_id AND pr.sku=p.sku
        WHERE o.proposal_id=$1 AND o.lease=$2 AND o.deadline>now()
          AND p.status='approved' AND p.expires_at>now() AND p.product_version=pr.version
      `, [job.proposal_id, job.lease])).rows.length
      if (!valid) {
        await this.savePrice(job, 'expired', { reason: 'prazo_ou_versao' })
        return
      }
      const request = await this.client.writePrice(token, item, model, Number(job.price))
      await this.savePrice(job, 'applied', { request })
    } catch (error) {
      await this.savePrice(job, 'uncertain', failure(error))
    }
  }

  async tick() {
    await this.price()
    await this.sync()
  }
}

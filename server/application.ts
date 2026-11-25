import { mountAuth } from './auth.js'
import { mkdir } from 'node:fs/promises'
import { waitUntil } from '@vercel/functions'
import express, { type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { agents, marketBrief, marketSegments, type Product, type Role, type Snapshot } from '../packages/contracts/src/index.js'
import { forShop, openDatabase, record } from './db.js'
import { createRun, decideProposal, importProducts, initializeStagingShop, seedLocal, type Settings } from './operations.js'
import { createProvider } from './providers.js'
import { readShopeeConfig, ShopeeClient, ShopeeError } from './shopee-client.js'
import { ShopeeService } from './shopee.js'

const hosted = process.env.VERCEL === '1'
const production = hosted || process.env.APP_MODE === 'production'
const staging = !production && (process.env.APP_MODE === 'staging' || process.argv.includes('--staging'))
const local = !production && !staging
const config = {
  database: process.env.DATABASE_URL,
  supabase: process.env.SUPABASE_URL?.replace(/\/$/, ''),
  key: process.env.SUPABASE_PUBLISHABLE_KEY,
  origin: process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin
    : hosted && process.env.VERCEL_URL ? new URL(`https://${process.env.VERCEL_URL}`).origin : undefined,
  port: Number(process.env.PORT || (staging ? 4174 : 4173)),
  host: process.env.HOST || '127.0.0.1',
  password: process.env.LOCAL_PASSWORD || 'demonstracao',
}
if (!local && (!config.database || !config.supabase?.startsWith('https://') || !config.key)) throw new Error('Configure DATABASE_URL, SUPABASE_URL (HTTPS) e SUPABASE_PUBLISHABLE_KEY.')
if (production && !config.origin?.startsWith('https://')) throw new Error('Em produção, configure APP_ORIGIN com a origem HTTPS do painel.')
if (!production && !['127.0.0.1', '::1', 'localhost'].includes(config.host)) throw new Error('Demonstração e staging local exigem loopback.')
const shopeeConfig = local ? undefined : readShopeeConfig(process.env, config.origin, staging || process.env.VERCEL_ENV === 'preview')
const provider = createProvider(staging && process.env.STAGING_AI_PROVIDER
  ? { ...process.env, AI_PROVIDER: process.env.STAGING_AI_PROVIDER }
  : process.env)
const storage = process.env.LOCAL_DATA_DIR || '.data/store'
if (local && storage !== ':memory:') await mkdir(storage, { recursive: true })
const db = await openDatabase(local ? undefined : config.database, local && storage !== ':memory:' ? storage : undefined, process.env.DATABASE_CA_PEM)
if (local) await seedLocal(db)
else await db.query('SELECT id FROM manager.shops LIMIT 1')
const shopee = shopeeConfig ? new ShopeeService(db, new ShopeeClient(shopeeConfig)) : undefined
function continueHostedSync(shop: string) {
  if (!hosted || !shopee) return
  const service = shopee
  waitUntil((async () => {
    const stopStartingAt = Date.now() + 30_000
    do {
      if (!await service.sync(shop)) break
    } while (Date.now() < stopStartingAt)
  })().catch((error: unknown) => {
    console.error('Sincronização Shopee indisponível', error instanceof Error ? error.name : 'unknown')
  }))
}
const authOrigin = config.origin ?? `http://${config.host === '::1' ? '[::1]' : config.host}:${config.port}`

const app = express()
const api = express.Router()
app.disable('x-powered-by')
app.use('/api', express.json({ limit: '1mb' }), api)
api.use((req, res, next) => {
  res.set('Cache-Control', 'no-store')
  if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && req.headers.origin !== (config.origin || `http://${req.headers.host}`)) {
    res.status(403).json({ error: 'Origem da requisição não autorizada.' })
    return
  }
  next()
})
api.get('/health', (_req, res) => { res.json({ status: 'ok' }) })
api.get('/config', (_req, res) => { res.json({ local }) })
const identify = mountAuth(api, local
  ? { localPassword: config.password }
  : { url: config.supabase!, key: config.key!, loopbackStaging: staging, signupRedirect: new URL('/login', authOrigin).href })

interface Access {
  id: string
  name: string
  role: Role
  fixture: boolean
  settings: Settings
}
api.get('/shopee/callback', async (req, res) => {
  const callback = z.object({ state: z.string().regex(/^[a-zA-Z0-9_-]{43}$/), code: z.string().min(1).max(256), shop_id: z.coerce.number().int().positive() }).safeParse(req.query)
  const user = shopee && callback.success ? await identify(req, res) : undefined
  if (!user || !shopee || !callback.success) {
    res.status(400).send('A autorização da Shopee não pôde ser validada. Abra uma nova autorização no escritório.')
    return
  }
  try {
    if (await shopee.connect(user, callback.data.state, callback.data.code, callback.data.shop_id)) {
      res.set('Referrer-Policy', 'no-referrer').redirect(303, '/connections?shopee=connected')
      return
    }
  } catch (error) {
    console.error('Autorização Shopee indisponível', error instanceof ShopeeError ? error.code : 'unknown')
  }
  res.status(400).send('A autorização da Shopee não pôde ser concluída. Confira o aplicativo e abra uma nova autorização no escritório.')
})

api.use(async (req, res, next) => {
  const user = await identify(req, res)
  if (!user) { res.status(401).json({ error: 'Entre para acessar o escritório.' }); return }
  const shop = req.header('x-shop-id')
  const membership = (await db.query<Access>(`
    SELECT s.id,s.name,s.fixture,s.settings,m.role FROM manager.members m JOIN manager.shops s ON s.id=m.shop_id
    WHERE m.user_id=$1 AND ($2::text IS NULL OR s.id=$2) ORDER BY s.id LIMIT 1
  `, [user, shop || null])).rows[0]
  const access = membership ?? (staging && !shop && req.method === 'GET' && req.path === '/snapshot' ? await initializeStagingShop(db, user) : undefined)
  if (!access) { res.status(403).json({ error: 'Você não possui acesso a esta loja.' }); return }
  res.locals.access = access
  res.locals.actor = user
  next()
})
const access = (res: Response): Access => res.locals.access
const actor = (res: Response): string => res.locals.actor
const scoped = (res: Response) => forShop(db, access(res).id)
const allowed = (...roles: Role[]) => (_req: Request, res: Response, next: NextFunction) => {
  if (!roles.includes(access(res).role)) { res.status(403).json({ error: 'Seu perfil não permite esta operação.' }); return }
  next()
}

api.get('/snapshot', async (_req, res) => {
  const { id, name, role, fixture, settings } = access(res)
  const db = scoped(res)
  const [runs, products, audit, proposals, usage, salesHistory, notifications, members] = await Promise.all([
    db.query<Snapshot['runs'][number]>(`
      SELECT r.id,r.workflow,r.brief,r.created_at,r.source,
        (SELECT jsonb_agg(jsonb_build_object('id',t.id,'agent',t.agent,'status',t.status,'result',t.result,'error',t.error,'attempts',t.attempts) ORDER BY t.stage,t.agent)
         FROM manager.tasks t WHERE t.run_id=r.id AND t.shop_id=r.shop_id) AS tasks
      FROM manager.runs r WHERE r.shop_id=$1 ORDER BY r.created_at DESC LIMIT 100
    `, [id]),
    db.query<Product>('SELECT sku,name,price,cost,fee,stock,units,revenue FROM manager.products WHERE shop_id=$1 AND archived_at IS NULL ORDER BY units DESC,sku', [id]),
    role === 'owner' ? db.query<Snapshot['audit'][number]>('SELECT id,event,actor,details,created_at FROM manager.audit WHERE shop_id=$1 ORDER BY created_at DESC LIMIT 150', [id]) : { rows: [] },
    db.query<Snapshot['proposals'][number]>('SELECT id,sku,price,previous_price,evidence,author,source_task_id,recommended_by,decided_by,status,created_at FROM manager.proposals WHERE shop_id=$1 ORDER BY created_at DESC LIMIT 100', [id]),
    role === 'owner' ? db.query<Snapshot['usage'][number]>(`
      SELECT agent,task_id,model,input,output,cost,status,created_at FROM manager.usage
      WHERE shop_id=$1 AND created_at >= date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
      ORDER BY created_at DESC
    `, [id]) : { rows: [] },
    db.query<Snapshot['salesHistory'][number]>(`
      SELECT period::text,sum(units)::float AS units,sum(revenue)::float AS revenue,count(*)::int AS skus
      FROM manager.sales_observations WHERE shop_id=$1 GROUP BY period ORDER BY period DESC LIMIT 30
    `, [id]),
    db.query<Snapshot['notifications'][number]>('SELECT id,kind,title,body,created_at FROM manager.notifications WHERE shop_id=$1 ORDER BY created_at DESC LIMIT 40', [id]),
    role === 'owner' ? db.query<Snapshot['members'][number]>('SELECT user_id, role, user_id=$2 AS self FROM manager.members WHERE shop_id=$1 ORDER BY self DESC,user_id LIMIT 100', [id, actor(res)]) : { rows: [] },
  ])
  const snapshot: Snapshot = {
    shop: { id, name, role }, local, fixture, provider: provider.kind,
    shopee: shopee && !fixture ? await shopee.view(id, true) : { mode: 'disabled', connected: false, adsEnabled: false, writes: false, status: null, updated: null, error: null, ads: [] },
    settings: role === 'owner' ? settings : { ...settings, instructions: {}, dailyLimit: 0, monthlyLimit: 0, lastWorker: null },
    runs: runs.rows, products: products.rows.map((item) => ({ ...item, price: Number(item.price), cost: item.cost === null ? null : Number(item.cost), fee: item.fee === null ? null : Number(item.fee), revenue: Number(item.revenue) })),
    audit: audit.rows,
    proposals: proposals.rows.map((item) => ({ ...item, price: Number(item.price), previous_price: Number(item.previous_price) })),
    usage: usage.rows.map((item) => ({ ...item, cost: Number(item.cost) })),
    salesHistory: salesHistory.rows, notifications: notifications.rows, members: members.rows,
  }
  const { status, updated } = snapshot.shopee
  if (role !== 'reader' && (status === 'queued' || (status === 'running' && updated && Date.now() - Date.parse(updated) > 240_000))) {
    continueHostedSync(id)
  }
  res.json(snapshot)
})

api.post('/shopee/authorize', allowed('owner'), async (_req, res) => {
  if (!shopee || access(res).fixture) { res.status(409).json({ error: 'A integração Shopee precisa ser configurada no backend.' }); return }
  res.json({ url: await shopee.authorization(access(res).id, actor(res)) })
})
api.post('/shopee/sync', allowed('owner', 'operator'), async (req, res) => {
  if (!shopee || access(res).fixture) { res.status(409).json({ error: 'A integração Shopee precisa ser configurada no backend.' }); return }
  const { period } = z.object({ period: z.iso.date().optional() }).parse(req.body)
  try {
    const shop = access(res).id
    if (await shopee.queue(shop, actor(res), period)) {
      continueHostedSync(shop)
      res.status(202).json({ ok: true }); return
    }
  } catch (error) {
    if (!(error instanceof ShopeeError) || error.code !== 'data_incompleta') throw error
    res.status(400).json({ error: 'Escolha um dia já encerrado para sincronizar pedidos.' }); return
  }
  res.status(409).json({ error: 'Já existe uma sincronização ativa ou a loja ainda precisa ser autorizada.' })
})

api.post('/runs', allowed('owner', 'operator'), async (req, res) => {
  const { workflow, brief, key, segment, query } = z.object({
    workflow: z.enum(['oportunidade', 'diario', 'atendimento']),
    brief: z.string().trim().min(5).max(2500), key: z.uuid(),
    segment: z.enum(marketSegments.map(({ id }) => id)).optional(),
    query: z.string().trim().max(140).regex(/^[^\r\n]*$/).optional(),
  }).parse(req.body)
  const taskBrief = workflow === 'oportunidade' && segment ? marketBrief(brief, segment, query ?? '') : brief
  res.status(201).json(await createRun(scoped(res), access(res).id, workflow, taskBrief, actor(res), `manual:${key}`, 'manual'))
})
api.post('/runs/:id/retry', allowed('owner', 'operator'), async (req, res) => {
  const id = z.uuid().parse(req.params.id)
  const shop = access(res).id
  await scoped(res).transaction(async (tx) => {
    const changed = await tx.query(`
      UPDATE manager.tasks SET status='queued',error=NULL,deadline=NULL
      WHERE shop_id=$1 AND run_id=$2 AND (status='blocked' OR (status='failed' AND attempts<6)) RETURNING id
    `, [shop, id])
    if (changed.rows.length) await record(tx, shop, 'Reprocessamento solicitado', actor(res), { run: id })
  })
  res.json({ ok: true })
})
const value = z.number().min(0).max(999999999)
const count = z.number().int().min(0).max(100000000)
const skuSchema = z.string().trim().min(1).max(80)
const productSchema = z.object({ sku: skuSchema, name: z.string().trim().min(1).max(200), price: value, cost: value.nullable(), fee: value.nullable(), stock: count, units: count, revenue: value })
api.post('/products/import', allowed('owner', 'operator'), async (req, res) => {
  const { products: data, period } = z.object({ products: z.array(productSchema).min(1).max(1000), period: z.iso.date().optional() }).parse(req.body)
  if (new Set(data.map((product) => product.sku)).size !== data.length) {
    res.status(400).json({ error: 'Há SKUs duplicados na importação.' }); return
  }
  await importProducts(scoped(res), access(res).id, actor(res), data, period)
  res.json({ count: data.length })
})
api.post('/proposals', allowed('owner', 'operator'), async (req, res) => {
  const shop = access(res).id
  const { sku, price, evidence, sourceTask } = z.object({ sku: skuSchema, price: value.positive(), evidence: z.string().trim().min(5).max(2000), sourceTask: z.uuid().optional() }).parse(req.body)
  const item = await scoped(res).transaction(async (tx) => {
    const source = sourceTask ? (await tx.query<{ agent: string; result: string }>(`
      SELECT agent,result FROM manager.tasks WHERE shop_id=$1 AND id=$2 AND status='done'
    `, [shop, sourceTask])).rows[0] : undefined
    if (sourceTask && !source) return null
    const inserted = (await tx.query<{ id: string }>(`
      INSERT INTO manager.proposals (shop_id,sku,price,previous_price,product_version,evidence,author,source_task_id,recommended_by)
      SELECT shop_id,sku,$1,price,version,$2,$3,$6,$7 FROM manager.products WHERE shop_id=$4 AND sku=$5 AND archived_at IS NULL RETURNING id
    `, [price, evidence, actor(res), shop, sku, sourceTask || null, source?.agent || null])).rows[0]
    if (inserted) await record(tx, shop, 'Proposta registrada', actor(res), { proposal: inserted.id, sku, price, evidence, sourceTask, recommendedBy: source?.agent, sourceResult: source?.result })
    return inserted
  })
  if (!item) { res.status(404).json({ error: 'Produto ou resultado de tarefa indisponível.' }); return }
  res.status(201).json(item)
})
api.post('/proposals/:id/decision', allowed('owner'), async (req, res) => {
  const id = z.uuid().parse(req.params.id)
  const { approve } = z.object({ approve: z.boolean() }).parse(req.body)
  const shop = access(res).id
  const writes = approve && shopee?.client.config.writes === true && (await shopee.view(shop, false)).connected
  const status = await decideProposal(scoped(res), shop, id, actor(res), approve, writes)
  if (!status) { res.status(409).json({ error: 'A proposta já foi decidida ou está indisponível.' }); return }
  res.json({ status })
})
const agentIds = z.enum(agents.map(({ id }) => id))
api.post('/settings', allowed('owner'), async (req, res) => {
  const settings = z.object({
    daily: z.boolean(), hour: z.number().int().min(0).max(23),
    dailyLimit: value, monthlyLimit: value, paused: z.array(agentIds).max(7),
    instructions: z.partialRecord(agentIds, z.string().trim().max(1000)),
  }).parse(req.body)
  await scoped(res).transaction(async (tx) => {
    await tx.query('UPDATE manager.shops SET settings=settings || $1::jsonb WHERE id=$2', [JSON.stringify(settings), access(res).id])
    await record(tx, access(res).id, 'Configurações atualizadas', actor(res), { daily: settings.daily, hour: settings.hour, dailyLimit: settings.dailyLimit, monthlyLimit: settings.monthlyLimit, paused: settings.paused, editedAgents: Object.keys(settings.instructions) })
  })
  res.json({ ok: true })
})
api.post('/members', allowed('owner'), async (req, res) => {
  const shop = access(res).id
  const { user, role } = z.object({
    user: local ? z.literal('local-reader') : z.uuid(),
    role: z.enum(['owner', 'operator', 'reader', 'remove']),
  }).parse(req.body)
  if (user === actor(res)) {
    res.status(400).json({ error: 'O proprietário não pode alterar seu próprio papel.' }); return
  }
  await scoped(res).transaction(async (tx) => {
    await tx.query('SELECT id FROM manager.shops WHERE id=$1 FOR UPDATE', [shop])
    const active = (await tx.query<{ role: Role }>('SELECT role FROM manager.members WHERE shop_id=$1 AND user_id=$2', [shop, actor(res)])).rows[0]
    if (active?.role !== 'owner') throw new Error('Permissão alterada durante a operação')
    if (role === 'remove') await tx.query('DELETE FROM manager.members WHERE shop_id=$1 AND user_id=$2', [shop, user])
    else await tx.query('INSERT INTO manager.members VALUES ($1,$2,$3) ON CONFLICT (shop_id,user_id) DO UPDATE SET role=EXCLUDED.role', [shop, user, role])
    await record(tx, shop, 'Acesso de membro alterado', actor(res), { user, role })
  })
  res.json({ ok: true })
})
api.use((_req, res) => { res.status(404).json({ error: 'Recurso desconhecido.' }) })
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError || (error instanceof SyntaxError && 'status' in error)) {
    res.status(400).json({ error: 'Confira os dados enviados e tente novamente.' }); return
  }
  console.error('Falha na API', error instanceof Error ? error.name : 'unknown')
  res.status(500).json({ error: 'Não foi possível concluir a operação.' })
})

export { app, config, db, provider, shopee }

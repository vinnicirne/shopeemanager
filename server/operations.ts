import { agents, workflows, type AgentId, type Product, type Proposal, type Run, type Snapshot, type Workflow } from '../packages/contracts/src/index.js'
import { record, type Database, type DatabaseQuery } from './db.js'
import type { Provider } from './providers.js'

export type Settings = Snapshot['settings']
type Source = Run['source']
const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })

export async function initializeStagingShop(db: Database, user: string) {
  return db.transaction(async (tx) => {
    await tx.query('LOCK TABLE manager.shops IN SHARE ROW EXCLUSIVE MODE')
    const { rows } = await tx.query<{ id: string; name: string; fixture: boolean; settings: Settings }>(`
      INSERT INTO manager.shops (id,name)
      SELECT 'principal','Minha loja Shopee' WHERE NOT EXISTS (SELECT 1 FROM manager.shops)
      RETURNING id,name,fixture,settings
    `)
    const shop = rows[0]
    if (!shop) return
    await tx.query("INSERT INTO manager.members (shop_id,user_id,role) VALUES ($1,$2,'owner')", [shop.id, user])
    await record(tx, shop.id, 'Primeiro proprietário vinculado', user, {})
    return { ...shop, role: 'owner' as const }
  })
}

export async function createRun(db: Database, shop: string, workflow: Workflow, brief: string, actor: string, key: string, source: Source) {
  return db.transaction(async (tx) => {
    const item = (await tx.query<{ id: string }>(
      'INSERT INTO manager.runs (shop_id,workflow,brief,source,request_key) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (shop_id, request_key) DO NOTHING RETURNING id',
      [shop, workflow, brief, source, key],
    )).rows[0]
    if (!item) return (await tx.query<{ id: string }>('SELECT id FROM manager.runs WHERE shop_id=$1 AND request_key=$2', [shop, key])).rows[0]
    for (const [stage, members] of workflows[workflow].entries()) {
      for (const agent of members) await tx.query('INSERT INTO manager.tasks (shop_id,run_id,stage,agent) VALUES ($1,$2,$3,$4)', [shop, item.id, stage, agent])
    }
    await record(tx, shop, 'Fluxo enfileirado', actor, { run: item.id, workflow, source })
    return item
  })
}

export async function importProducts(db: Database, shop: string, actor: string, products: Product[], period?: string) {
  await db.transaction(async (tx) => {
    for (const product of products) {
      await tx.query(`
        INSERT INTO manager.products (shop_id,sku,name,price,cost,fee,stock,units,revenue)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (shop_id,sku) DO UPDATE SET name=EXCLUDED.name, price=EXCLUDED.price, cost=EXCLUDED.cost,
          fee=EXCLUDED.fee, stock=EXCLUDED.stock, units=EXCLUDED.units, revenue=EXCLUDED.revenue, version=manager.products.version+1
        WHERE (manager.products.name, manager.products.price, manager.products.cost, manager.products.fee, manager.products.stock, manager.products.units, manager.products.revenue)
          IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.price, EXCLUDED.cost, EXCLUDED.fee, EXCLUDED.stock, EXCLUDED.units, EXCLUDED.revenue)
      `, [shop, product.sku, product.name, product.price, product.cost, product.fee, product.stock, product.units, product.revenue])
      if (period) await tx.query(`
        INSERT INTO manager.sales_observations (shop_id,period,sku,units,revenue) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (shop_id,period,sku) DO UPDATE SET units=EXCLUDED.units,revenue=EXCLUDED.revenue
      `, [shop, period, product.sku, product.units, product.revenue])
    }
    await record(tx, shop, 'Catálogo importado', actor, { count: products.length, source: 'manual', period: period || null })
  })
}

export async function seedLocal(db: Database) {
  const created = await db.query("INSERT INTO manager.shops (id,name,fixture) VALUES ('demo','Loja de demonstração',true) ON CONFLICT DO NOTHING RETURNING id")
  if (!created.rows.length) return
  await db.query("INSERT INTO manager.members VALUES ('demo','local-owner','owner'),('demo','local-reader','reader') ON CONFLICT DO NOTHING")
  await importProducts(db, 'demo', 'Ambiente de demonstração', [
    { sku: 'ORG-01', name: 'Organizador modular', price: 69.9, cost: 25, fee: 13.5, stock: 36, units: 42, revenue: 2935.8 },
    { sku: 'LUM-02', name: 'Luminária de mesa', price: 89.9, cost: 42, fee: 17, stock: 3, units: 17, revenue: 1528.3 },
    { sku: 'KIT-03', name: 'Kit para escritório', price: 49.9, cost: 20, fee: 9, stock: 24, units: 23, revenue: 1147.7 },
  ])
}

export async function decideProposal(db: Database, shop: string, id: string, actor: string, approved: boolean, externalWrites = false) {
  return db.transaction(async (tx) => {
    const row = (await tx.query<Proposal & { version: number; product_version: number; expired: boolean; fixture: boolean; item: string | null; model: string | null }>(`
      SELECT p.*, pr.version, p.expires_at <= now() AS expired, s.fixture,pr.shopee_item AS item,pr.shopee_model AS model
      FROM manager.proposals p JOIN manager.products pr USING (shop_id,sku)
      JOIN manager.shops s ON s.id=p.shop_id
      WHERE p.shop_id=$1 AND p.id=$2 AND pr.archived_at IS NULL FOR UPDATE OF p,pr
    `, [shop, id])).rows[0]
    if (!row || row.status !== 'pending') return null
    const status = row.expired || row.version !== row.product_version ? 'expired'
      : !approved ? 'rejected' : row.fixture ? 'applied' : 'approved'
    if (status === 'applied') {
      await tx.query('UPDATE manager.products SET price=$1,version=version+1 WHERE shop_id=$2 AND sku=$3', [row.price, shop, row.sku])
    }
    const queued = status === 'approved' && externalWrites && row.item !== null
    if (queued) {
      await tx.query('INSERT INTO manager.shopee_price_operations (proposal_id,shop_id,item,model) VALUES ($1,$2,$3,$4)', [id, shop, row.item, row.model || 0])
    }
    await tx.query('UPDATE manager.proposals SET status=$1,decided_by=$2 WHERE shop_id=$3 AND id=$4', [status, actor, shop, id])
    await record(tx, shop, 'Proposta decidida', actor, { proposal: id, author: row.author, evidence: row.evidence, sourceTask: row.source_task_id, recommendedBy: row.recommended_by, sku: row.sku, before: row.previous_price, price: row.price, productVersion: row.product_version, status, channel: queued ? 'shopee' : row.fixture ? 'fixture' : 'manual' })
    return status
  })
}

type Claim = { id: string; shop_id: string; run_id: string; agent: AgentId; attempts: number; stage: number; workflow: Workflow; brief: string; lease: string }

async function notify(tx: DatabaseQuery, task: Claim, result: string) {
  const amount = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
  const alerts: { kind: string; title: string; body: string }[] = [
    { kind: 'report', title: 'Relatório operacional disponível', body: result },
  ]
  const stock = (await tx.query<{ name: string; stock: number }>('SELECT name,stock FROM manager.products WHERE shop_id=$1 AND archived_at IS NULL AND stock<5 ORDER BY stock,sku LIMIT 20', [task.shop_id])).rows
  if (stock.length) alerts.push({ kind: 'stock', title: 'Atenção ao estoque', body: stock.map(({ name, stock }) => `${name} (${stock})`).join(' · ') })
  const comparison = (await tx.query<{ recent: number; previous: number; period: string; baseline: string }>(`
    WITH periods AS (
      SELECT DISTINCT period FROM manager.sales_observations WHERE shop_id=$1 ORDER BY period DESC LIMIT 2
    ), bounds AS (SELECT max(period) AS recent,min(period) AS previous FROM periods)
    SELECT sum(n.revenue) AS recent,sum(p.revenue) AS previous,max(n.period)::text AS period,max(p.period)::text AS baseline
    FROM bounds b JOIN manager.sales_observations n ON n.shop_id=$1 AND n.period=b.recent
    JOIN manager.sales_observations p ON p.shop_id=n.shop_id AND p.sku=n.sku AND p.period=b.previous
    WHERE b.recent=b.previous+1
  `, [task.shop_id])).rows[0]
  if (Number(comparison.previous) > 0 && Number(comparison.recent) < Number(comparison.previous) * 0.8) {
    alerts.push({ kind: 'sales', title: 'Queda de receita nos SKUs comparáveis', body: `${comparison.baseline} · ${amount.format(Number(comparison.previous))}. ${comparison.period} · ${amount.format(Number(comparison.recent))}.` })
  }
  for (const { kind, title, body } of alerts) {
    await tx.query('INSERT INTO manager.notifications (shop_id,run_id,kind,title,body) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [task.shop_id, task.run_id, kind, title, body])
  }
}

async function recover(tx: DatabaseQuery, shop?: string) {
  const { rows } = await tx.query<Claim>(`
    UPDATE manager.tasks SET status=CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
      error='Prazo de execução expirado', lease=NULL,deadline=NULL
    WHERE status='running' AND deadline < now() AND ($1::text IS NULL OR shop_id=$1)
    RETURNING id,shop_id,agent,attempts,run_id
  `, [shop ?? null])
  for (const task of rows) {
    await tx.query("UPDATE manager.usage SET status='unknown' WHERE task_id=$1 AND attempt=$2 AND status='reserved'", [task.id, task.attempts])
    await record(tx, task.shop_id, 'Execução expirada', task.agent, { task: task.id, run: task.run_id, attempt: task.attempts })
  }
}

async function claim(db: Database, provider: Provider, shop: string) {
  return db.transaction(async (tx) => {
    const { settings } = (await tx.query<{ settings: Settings }>('SELECT settings FROM manager.shops WHERE id=$1 FOR UPDATE', [shop])).rows[0]
    await tx.query("UPDATE manager.shops SET settings=jsonb_set(settings,'{lastWorker}',to_jsonb(now())) WHERE id=$1", [shop])
    const task = (await tx.query<Claim>(`
      SELECT t.*,r.workflow,r.brief FROM manager.tasks t JOIN manager.runs r ON r.id=t.run_id
      WHERE t.shop_id=$1 AND t.status='queued' AND (t.deadline IS NULL OR t.deadline <= now())
        AND NOT (t.agent=ANY($2::text[]))
        AND NOT EXISTS (SELECT 1 FROM manager.tasks d WHERE d.run_id=t.run_id AND d.stage<t.stage AND d.status <> 'done')
        AND NOT EXISTS (SELECT 1 FROM manager.tasks a WHERE a.shop_id=t.shop_id AND a.agent=t.agent AND a.status='running')
      ORDER BY r.created_at,t.stage,t.agent LIMIT 1 FOR UPDATE OF t SKIP LOCKED
    `, [shop, settings.paused])).rows[0]
    if (!task) return null

    if (provider.maximumCost > 0) {
      const totals = (await tx.query<{ daily: number; monthly: number }>(`
        SELECT coalesce(sum(cost) FILTER (WHERE created_at >= date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'),0) AS daily,
          coalesce(sum(cost),0) AS monthly
        FROM manager.usage WHERE shop_id=$1 AND created_at >= date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
      `, [shop])).rows[0]
      if (Number(totals.daily) + provider.maximumCost > settings.dailyLimit || Number(totals.monthly) + provider.maximumCost > settings.monthlyLimit) {
        await tx.query("UPDATE manager.tasks SET status='blocked',error='Limite de orçamento de IA' WHERE id=$1", [task.id])
        await record(tx, shop, 'Tarefa bloqueada pelo orçamento', task.agent, { task: task.id, run: task.run_id })
        return null
      }
    }
    const state = (await tx.query<{ lease: string; attempts: number }>(`
      UPDATE manager.tasks SET status='running', lease=gen_random_uuid(), deadline=now()+interval '1 millisecond' * $2,
        attempts=attempts+1,error=NULL WHERE id=$1 RETURNING lease,attempts
    `, [task.id, provider.timeoutMs ? provider.timeoutMs + 15_000 : 60_000])).rows[0]
    await tx.query(`
      INSERT INTO manager.usage (task_id,attempt,shop_id,agent,model,cost,rates,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'reserved')
    `, [task.id, state.attempts, shop, task.agent, provider.model, provider.maximumCost, JSON.stringify(provider.rates)])
    await record(tx, shop, 'Tarefa iniciada', task.agent, { task: task.id, run: task.run_id, attempt: state.attempts, model: provider.model })
    return { ...task, ...state, instruction: settings.instructions[task.agent] }
  })
}

async function execute(db: Database, provider: Provider, task: NonNullable<Awaited<ReturnType<typeof claim>>>) {
  const agent = agents.find((entry) => entry.id === task.agent)!
  let output: Awaited<ReturnType<Provider['run']>> | undefined
  try {
    const { rows: results } = await db.query<{ agent: string; result: string }>('SELECT agent,result FROM manager.tasks WHERE run_id=$1 AND shop_id=$2 AND stage<$3 AND status=\'done\' ORDER BY stage,agent', [task.run_id, task.shop_id, task.stage])
    const { rows: products } = await db.query<Product>('SELECT sku,name,price,cost,fee,stock,units,revenue FROM manager.products WHERE shop_id=$1 AND archived_at IS NULL ORDER BY sku', [task.shop_id])
    output = await provider.run({ agent, instruction: task.instruction || agent.instruction, workflow: task.workflow, brief: task.brief, results, products })
  } catch (error) {
    console.error('Falha na execução da tarefa', task.id, error instanceof Error ? error.name : 'unknown')
  }
  await db.transaction(async (tx) => {
    const retry = !output && task.attempts < 3
    const status = output ? 'done' : retry ? 'queued' : 'failed'
    const changed = await tx.query(`
      UPDATE manager.tasks SET status=$1,result=$2,error=$3,lease=NULL,
        deadline=CASE WHEN $4 THEN now()+interval '2 seconds' * attempts ELSE NULL END
      WHERE id=$5 AND shop_id=$6 AND lease=$7 AND deadline > now() RETURNING id
    `, [status, output?.result || null, output ? null : 'Execução indisponível', retry, task.id, task.shop_id, task.lease])
    if (!changed.rows.length) return
    if (output) {
      await tx.query("UPDATE manager.usage SET input=$1,output=$2,cost=$3,status='settled' WHERE task_id=$4 AND attempt=$5", [output.input, output.output, output.cost, task.id, task.attempts])
      if (task.workflow === 'diario' && task.agent === 'vinni') await notify(tx, task, output.result)
    } else {
      await tx.query("UPDATE manager.usage SET status='unknown' WHERE task_id=$1 AND attempt=$2", [task.id, task.attempts])
    }
    await record(tx, task.shop_id, output ? 'Tarefa concluída' : 'Tentativa falhou', agent.name, { task: task.id, run: task.run_id, attempt: task.attempts, status })
  })
}

export async function tick(db: Database, provider: Provider, now = new Date(), shop?: string) {
  const parts = Object.fromEntries(dateParts.formatToParts(now).map(({ type, value }) => [type, value]))
  await db.transaction((tx) => recover(tx, shop))
  const { rows: shops } = await db.query<{ id: string; settings: Settings }>(
    'SELECT id,settings FROM manager.shops WHERE $1::text IS NULL OR id=$1 ORDER BY id', [shop ?? null],
  )
  let processed = false
  for (const { id, settings } of shops) {
    if (settings.daily && Number(parts.hour) >= settings.hour) {
      const date = `${parts.year}-${parts.month}-${parts.day}`
      await createRun(db, id, 'diario', `Rotina diária de vendas, estoque e margem de ${date}.`, 'Agendador', `daily:${date}`, 'schedule')
    }
    const task = await claim(db, provider, id)
    if (task) {
      await execute(db, provider, task)
      processed = true
    }
  }
  return processed
}

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { forShop, openDatabase } from '../../server/db'
import { createRun, decideProposal, importProducts, initializeStagingShop, seedLocal, tick } from '../../server/operations'
import { createProvider, type Provider } from '../../server/providers'

test('configura uma única loja inicial e vincula apenas o primeiro proprietário', async (t) => {
  const db = await openDatabase()
  t.after(() => db.close())
  const contenders = ['primeiro', 'segundo']
  const results = await Promise.all(contenders.map((user) => initializeStagingShop(db, user)))
  assert.equal(results.filter(Boolean).length, 1)
  const row = (await db.query('SELECT shop_id,user_id,role FROM manager.members')).rows
  assert.deepEqual(row, [{ shop_id: 'principal', user_id: contenders[results.findIndex(Boolean)], role: 'owner' }])
  assert.equal(await initializeStagingShop(db, 'terceiro'), undefined)
})

test('deduplica fluxos e permite etapas apenas após o resultado anterior', async (t) => {
  const db = await openDatabase()
  t.after(() => db.close())
  await seedLocal(db)
  const key = randomUUID()
  const [a, b] = await Promise.all([
    createRun(db, 'demo', 'oportunidade', 'Validar produto de teste', 'local-owner', key, 'manual'),
    createRun(db, 'demo', 'oportunidade', 'Validar produto de teste', 'local-owner', key, 'manual'),
  ])
  assert.equal(a.id, b.id)
  const order: string[] = []
  const base = createProvider({})
  const provider: Provider = { ...base, async run(input) {
    order.push(input.agent.id)
    assert.equal(input.results.length, order.length - 1)
    return base.run(input)
  } }
  for (let i = 0; i < 6; i++) await tick(db, provider)
  assert.deepEqual(order, ['rafael', 'beatriz', 'eduardo', 'gabriel', 'vinni'])
  const { rows } = await db.query<{ status: string }>('SELECT status FROM manager.tasks WHERE run_id=$1', [a.id])
  assert.equal(rows.length, 5)
  assert.ok(rows.every(({ status }) => status === 'done'))
  await assert.rejects(db.query("UPDATE manager.audit SET actor='outro' WHERE shop_id='demo'"), /append-only/)
})

test('reserva orçamento sob concorrência e bloqueia duplicidade de consumo', async (t) => {
  const db = await openDatabase()
  t.after(() => db.close())
  await seedLocal(db)
  await db.query("UPDATE manager.shops SET settings=jsonb_set(settings,'{dailyLimit}','0.10') WHERE id='demo'")
  await createRun(db, 'demo', 'diario', 'Teste de concorrência', 'local-owner', randomUUID(), 'manual')
  let release!: () => void
  const consume = new Promise<void>((resolve) => { release = resolve })
  let started!: () => void
  const entered = new Promise<void>((resolve) => { started = resolve })
  const base = createProvider({})
  const provider: Provider = { ...base, model: 'modelo-teste', maximumCost: 0.09, async run() {
    started()
    await consume
    return { input: 10, output: 20, cost: 0.08, result: 'Resultado confirmado.' }
  } }
  const running = tick(db, provider)
  try {
    await entered
    await tick(db, provider)
    const { rows } = await db.query<{ status: string }>('SELECT status FROM manager.tasks ORDER BY status')
    assert.deepEqual(rows.map(({ status }) => status), ['blocked', 'queued', 'running'])
  } finally { release(); await running }
  const { rows } = await db.query<{ cost: number; status: string }>('SELECT cost,status FROM manager.usage')
  assert.deepEqual(rows.map((row) => [Number(row.cost), row.status]), [[0.08, 'settled']])
})

test('recupera lease vencida e conserva custo de uso incerto', async (t) => {
  const db = await openDatabase()
  t.after(() => db.close())
  await seedLocal(db)
  const run = await createRun(db, 'demo', 'atendimento', 'Teste de execução interrompida', 'local-owner', randomUUID(), 'manual')
  const prior = (await db.query<{ id: string }>(`
    UPDATE manager.tasks SET status='running',attempts=1,lease=gen_random_uuid(),deadline=now()-interval '1 second'
    WHERE run_id=$1 AND agent='mariana' RETURNING id
  `, [run.id])).rows[0]
  await db.query("INSERT INTO manager.usage VALUES ($1,1,'demo','mariana','teste',null,null,0.3,'{}','reserved',now())", [prior.id])
  await tick(db, createProvider({}))
  const { rows } = await db.query<{ attempt: number; status: string }>('SELECT attempt,status FROM manager.usage WHERE task_id=$1 ORDER BY attempt', [prior.id])
  assert.deepEqual(rows, [{ attempt: 1, status: 'unknown' }, { attempt: 2, status: 'settled' }])
})

test('protege aprovação contra alteração concorrente e reaplicação', async (t) => {
  const db = await openDatabase()
  t.after(() => db.close())
  await seedLocal(db)
  const proposal = async () => (await db.query<{ id: string }>(`
    INSERT INTO manager.proposals (shop_id,sku,price,previous_price,product_version,evidence,author)
    SELECT shop_id,sku,50,price,version,'motivo de referência','operator' FROM manager.products
    WHERE shop_id='demo' AND sku='ORG-01' RETURNING id
  `)).rows[0].id
  const first = await proposal()
  const second = await proposal()
  const decisions = await Promise.all([decideProposal(db, 'demo', first, 'owner', true), decideProposal(db, 'demo', first, 'owner', true)])
  assert.deepEqual(decisions, ['applied', null])
  assert.equal(await decideProposal(db, 'demo', second, 'owner', true), 'expired')
  assert.equal(await decideProposal(db, 'outra-loja', first, 'owner', true), null)

  await importProducts(db, 'demo', 'owner', [{ sku: 'ORG-01', name: 'Organizador modular', price: 50, cost: 25, fee: 13.5, stock: 36, units: 42, revenue: 2935.8 }])
  const version = (await db.query<{ version: number }>("SELECT version FROM manager.products WHERE shop_id='demo' AND sku='ORG-01'")).rows[0].version
  assert.equal(version, 2)
})

test('restringe leitura e escrita por loja no RLS e restaura escopo após a transação', async (t) => {
  const db = await openDatabase()
  t.after(() => db.close())
  await seedLocal(db)
  await db.query("INSERT INTO manager.shops (id,name) VALUES ('separada','Outra loja')")
  const row = { sku: 'PRIVATE-1', name: 'Produto de outra loja', price: 10, cost: 4, fee: 1, stock: 2, units: 5, revenue: 50 }
  await importProducts(db, 'separada', 'owner', [row])
  const demo = forShop(db, 'demo')
  assert.equal((await demo.query("SELECT sku FROM manager.products WHERE sku='PRIVATE-1'")).rows.length, 0)
  await assert.rejects(importProducts(demo, 'separada', 'owner', [{ ...row, sku: 'PRIVATE-2' }]), /row-level security/)
  assert.equal((await forShop(db, 'separada').query('SELECT sku FROM manager.products')).rows.length, 1)
  assert.equal((await db.query('SELECT sku FROM manager.products')).rows.length, 4)
})

test('emite alerta apenas para dias consecutivos e SKUs comparáveis', async (t) => {
  const db = await openDatabase()
  t.after(() => db.close())
  await seedLocal(db)
  const row = { sku: 'S-1', name: 'SKU comparável', price: 10, cost: 2, fee: 1, stock: 2, units: 10, revenue: 100 }
  await importProducts(db, 'demo', 'owner', [row], '2026-11-20')
  await importProducts(db, 'demo', 'owner', [{ ...row, units: 6, revenue: 60 }, { ...row, sku: 'S-2', revenue: 250 }], '2026-11-21')
  await createRun(db, 'demo', 'diario', 'Apurar receita dos SKUs comparáveis', 'local-owner', randomUUID(), 'manual')
  for (let i = 0; i < 5; i++) await tick(db, createProvider({}))
  const alerts = await db.query<{ kind: string; body: string }>('SELECT kind,body FROM manager.notifications ORDER BY kind')
  assert.deepEqual(alerts.rows.map((item) => item.kind), ['report', 'sales', 'stock'])
  assert.match(alerts.rows[1].body, /100,00.*60,00/u)
})

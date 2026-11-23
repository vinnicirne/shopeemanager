import { expect, test, type Page } from '@playwright/test'
import type { Snapshot } from '../../packages/contracts/src/index'

async function login(page: Page, email = 'demo@local.test') {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha', { exact: true }).fill('demonstracao')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Escritório virtual' })).toBeVisible()
}
const menu = (page: Page, name: string) => page.getByRole('navigation', { name: 'Menu principal' }).getByRole('button', { name, exact: true })

test('retorna à rota protegida após o login e exige sessão após sair', async ({ page }) => {
  await page.goto('/tasks')
  await expect(page).toHaveURL(/\/login\?next=%2Ftasks$/)
  await page.getByLabel('E-mail').fill('demo@local.test')
  await page.getByLabel('Senha', { exact: true }).fill('demonstracao')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).toHaveURL(/\/tasks$/)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Tarefas', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  expect((await page.request.get('/api/snapshot')).status()).toBe(401)
})

test('protege o escritório e abre os sete perfis por teclado', async ({ page, request }) => {
  expect((await request.get('/api/snapshot')).status()).toBe(401)
  await login(page)
  const candidates = ['Vinni', 'Ana', 'Rafael', 'Beatriz', 'Gabriel', 'Mariana', 'Eduardo']
  for (const name of candidates) {
    await page.getByRole('button', { name: `Abrir perfil de ${name}`, exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog').getByRole('heading', { name, exact: true })).toBeVisible()
    await expect(page.getByRole('dialog').getByText(/Aguardando/)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  const dimensions = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => Array.from(canvas.getContext('2d')!.getImageData(100, 100, 1, 1).data))
  expect(dimensions[3]).toBeGreaterThan(0)
})

test('executa a cadeia completa e recupera o histórico ao recarregar', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: 'Nova tarefa' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Segmento').selectOption('ferramentas')
  await dialog.getByLabel('Produto ou tema para pesquisar').fill('Kit de organização de ferramentas')
  await dialog.getByLabel('Briefing').fill('Avaliar um kit de organização para mesas pequenas.')
  await dialog.getByRole('button', { name: 'Criar tarefa' }).click()
  await expect(page.getByRole('heading', { name: 'Escritório virtual' })).toBeVisible()
  await expect(page.locator('.office-agent[data-pose="walking"]').first()).toBeVisible()
  await page.getByRole('list', { name: 'Atividade das tarefas' }).getByRole('button', { name: /Gabriel → Vinni/ }).click()
  await expect(page).toHaveURL(/\/tasks\?run=/)
  await expect(page.getByText('Síntese da equipe e próximos passos')).toBeVisible({ timeout: 12000 })
  const run = page.locator('article.run').filter({ hasText: 'Avaliar um kit de organização' })
  await expect(run.getByText('Ferramentas', { exact: true })).toBeVisible()
  await expect(run.getByText('Concluída', { exact: true })).toHaveCount(5)
  await page.reload()
  await menu(page, 'Tarefas').click()
  await expect(run.getByText('Concluída', { exact: true })).toHaveCount(5)
  await menu(page, 'Administração').click()
  await expect(page.getByRole('heading', { name: 'Uso de IA no mês' })).toBeVisible()
  await page.getByText('Custos por tarefa e modelo').click()
  await expect(page.getByText('Regras locais', { exact: true }).first()).toBeVisible()
  await menu(page, 'Aprovações').click()
  await page.getByLabel('Produto').selectOption('ORG-01')
  await page.getByLabel('Novo preço').fill('73.00')
  await page.getByLabel('Resultado da equipe').selectOption({ label: 'Vinni · Avaliar um kit de organização para mesas pequenas.' })
  await page.getByLabel('Evidência e justificativa').fill('Proposta baseada na consolidação registrada por Vinni.')
  await page.getByRole('button', { name: 'Registrar proposta' }).click()
  await expect(page.getByText(/Evidência de Vinni/)).toBeVisible()
})

test('move os agentes e mostra a entrega conforme a fila avança', async ({ page }) => {
  await login(page)
  const initial = await (await page.request.get('/api/snapshot')).json() as Snapshot
  const tasks = [
    { id: 'pesquisa', agent: 'rafael', status: 'queued', result: null, error: null, attempts: 0 },
    { id: 'fornecedores', agent: 'beatriz', status: 'queued', result: null, error: null, attempts: 0 },
  ] satisfies Snapshot['runs'][number]['tasks']
  let run: Snapshot['runs'][number] = {
    id: 'movimento', workflow: 'oportunidade', brief: 'Pesquisa de fornecedores em movimento', created_at: new Date().toISOString(),
    source: 'manual', tasks,
  }
  await page.route('**/api/snapshot', (route) => route.fulfill({ json: { ...initial, runs: [run] } }))
  const board = page.getByRole('list', { name: 'Atividade das tarefas' })
  const rafael = page.getByRole('button', { name: 'Abrir perfil de Rafael' })
  const beatriz = page.getByRole('button', { name: 'Abrir perfil de Beatriz' })
  await expect(board.getByText('Rafael · Na fila')).toBeVisible()
  await expect(board.getByText('Beatriz · Na fila')).toHaveCount(0)
  const rest = await rafael.evaluate((button) => button.getBoundingClientRect().y)
  run = { ...run, tasks: [{ ...tasks[0], status: 'running', attempts: 1 }, tasks[1]] }
  await expect(board.getByText('Rafael · Em execução')).toBeVisible()
  await expect(rafael).toHaveAttribute('data-pose', 'desk')
  const desk = await rafael.evaluate((button) => button.getBoundingClientRect().y)
  expect(desk).toBeLessThan(rest - 40)
  run = { ...run, tasks: [{ ...tasks[0], status: 'done', attempts: 1 }, { ...tasks[1], status: 'running', attempts: 1 }] }
  await expect(board.getByText('Rafael → Beatriz')).toBeVisible()
  await expect(beatriz).toHaveAttribute('data-pose', 'desk')
  await expect(rafael).toHaveAttribute('data-pose', 'lounge')
})

test('importa catálogo, apresenta margem e permite aprovação somente ao proprietário', async ({ page, browser }) => {
  await login(page)
  await menu(page, 'Integrações').click()
  await expect(page.getByText('Shopee Open Platform', { exact: true })).toBeVisible()
  await page.getByLabel('Data de referência').fill('2026-11-21')
  await page.getByLabel('Catálogo CSV').fill('sku;nome;preco;custo;taxa;estoque;unidades;receita\nTEST-45;Porta cabos;20;7;3;4;9;180')
  await page.getByRole('button', { name: 'Importar catálogo' }).click()
  await expect(page.getByRole('status')).toContainText('Operação registrada')
  await menu(page, 'Vendas e estoque').click()
  await expect(page.getByRole('row').filter({ hasText: 'Porta cabos' })).toContainText('10,00')
  await expect(page.getByRole('row').filter({ hasText: '21/11/2026' })).toContainText('180,00')
  await menu(page, 'Aprovações').click()
  await page.getByLabel('Produto').selectOption('TEST-45')
  await page.getByLabel('Novo preço').fill('22.50')
  await page.getByLabel('Evidência e justificativa').fill('Margem revisada com base nos custos importados.')
  await page.getByRole('button', { name: 'Registrar proposta' }).click()
  const proposal = page.locator('article.proposal').filter({ hasText: 'TEST-45' })
  await expect(proposal.getByText('Pendente', { exact: true })).toBeVisible()

  const reader = await browser.newPage()
  await login(reader, 'leitor@local.test')
  await reader.goto('/settings')
  await expect(reader.getByRole('heading', { name: 'Escritório virtual' })).toBeVisible()
  await expect(reader).toHaveURL('/')
  await menu(reader, 'Aprovações').click()
  await expect(reader.getByRole('button', { name: 'Aprovar', exact: true })).toHaveCount(0)
  const snapshot = await (await reader.request.get('/api/snapshot')).json() as Snapshot
  const id = snapshot.proposals.find((item) => item.sku === 'TEST-45')!.id
  expect((await reader.request.post(`/api/proposals/${id}/decision`, { data: { approve: true } })).status()).toBe(403)
  expect((await reader.request.get('/api/snapshot', { headers: { 'x-shop-id': 'outra-loja' } })).status()).toBe(403)
  await reader.close()

  await proposal.getByRole('button', { name: 'Aprovar', exact: true }).click()
  await expect(proposal.getByText('Aplicada na demonstração')).toBeVisible()
  await menu(page, 'Administração').click()
  await page.getByText('Proposta decidida', { exact: false }).first().click()
  await expect(page.getByText('"productVersion"', { exact: false })).toBeVisible()
})

test('gera relatório diário com o navegador fechado', async ({ browser }) => {
  const setup = await browser.newPage()
  await login(setup)
  const response = await setup.request.post('/api/settings', { data: { daily: true, hour: 0, dailyLimit: 1, monthlyLimit: 20, paused: [], instructions: {} } })
  expect(response.ok()).toBeTruthy()
  await setup.context().close()
  await expect.poll(async () => {
    const client = await browser.newContext()
    await client.request.post('/api/login', { data: { email: 'demo@local.test', password: 'demonstracao' } })
    const data = await (await client.request.get('/api/snapshot')).json() as Snapshot
    await client.close()
    return data.runs.filter((run) => run.source === 'schedule').map((run) => run.tasks.every((task) => task.status === 'done'))
  }, { timeout: 12000 }).toEqual([true])
  const reports = await browser.newPage()
  await login(reports)
  await menu(reports, 'Relatórios e alertas').click()
  await expect(reports.getByText('Relatório operacional disponível')).toHaveCount(1)
  await expect(reports.getByText('Atenção ao estoque')).toHaveCount(1)
  await reports.close()
})

test('escritório mantém navegação em uma tela móvel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.getByRole('button', { name: 'Abrir perfil de Mariana', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Mariana' })).toBeVisible()
})

test('proprietário altera papel de um membro e a auditoria identifica a decisão', async ({ page, browser }) => {
  await login(page)
  await menu(page, 'Administração').click()
  const access = page.getByRole('heading', { name: 'Acesso à loja' }).locator('../..')
  const row = access.getByRole('row').filter({ hasText: 'local-reader' })
  await access.getByLabel('Papel').selectOption('operator')
  await access.getByRole('button', { name: 'Atualizar acesso' }).click()
  await expect(row).toContainText('Operador')

  const member = await browser.newPage()
  await login(member, 'leitor@local.test')
  await expect(member.getByRole('button', { name: 'Nova tarefa' })).toBeVisible()
  expect((await member.request.post('/api/members', { data: { user: 'local-reader', role: 'owner' } })).status()).toBe(403)
  await member.close()

  await access.getByLabel('Papel').selectOption('reader')
  await access.getByRole('button', { name: 'Atualizar acesso' }).click()
  await expect(row).toContainText('Leitor')
  await expect(page.getByText('Acesso de membro alterado', { exact: false })).toHaveCount(2)
})

test('pausa e reativa um funcionário sem simular trabalho', async ({ page }) => {
  await login(page)
  await menu(page, 'Administração').click()
  await page.getByText('Configurar funcionários').click()
  await page.getByLabel('Pausar Ana').check()
  await page.getByRole('button', { name: 'Salvar configurações' }).click()
  await expect(page.getByRole('status')).toContainText('Operação registrada')
  await menu(page, 'Escritório').click()
  const ana = page.getByRole('button', { name: 'Abrir perfil de Ana', exact: true })
  await expect(ana).toHaveAttribute('data-paused', 'true')
  await ana.click()
  await expect(page.getByRole('dialog').getByText(/Em pausa/)).toBeVisible()
  await page.keyboard.press('Escape')
  await menu(page, 'Administração').click()
  await page.getByText('Configurar funcionários').click()
  await page.getByLabel('Pausar Ana').uncheck()
  await page.getByRole('button', { name: 'Salvar configurações' }).click()
  await expect(page.getByRole('status')).toContainText('Operação registrada')
})

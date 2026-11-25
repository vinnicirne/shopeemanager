import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, BarChart3, Bell, BriefcaseBusiness, Building2, CheckCircle2, ChevronRight, CircleHelp, ClipboardList, Clock3, Database, Eye, EyeOff, FileText, Gauge, History, Layers3, LogOut, Plus, Settings2, ShieldCheck, Store, Users, Wallet } from 'lucide-react'
import { agents, marketSegments, splitMarketBrief, workflowLabels, type AgentId, type OrderFinance, type Product, type Snapshot, type Workflow } from '../../../packages/contracts/src/index'
import { Office, type States } from '../../../packages/office/src/Office'
import { activityLabel, officeActivity, type OfficeActivity } from '../../../packages/office/src/activity'
import './styles.css'

type Page = 'office' | 'tasks' | 'sales' | 'profit' | 'reports' | 'proposals' | 'connections' | 'settings'
const pages = [
  { id: 'office', name: 'Escritório', icon: Building2 },
  { id: 'tasks', name: 'Tarefas', icon: ClipboardList },
  { id: 'sales', name: 'Vendas e estoque', icon: BarChart3 },
  { id: 'profit', name: 'Lucro', icon: Wallet },
  { id: 'reports', name: 'Relatórios e alertas', icon: Bell },
  { id: 'proposals', name: 'Aprovações', icon: ShieldCheck },
  { id: 'connections', name: 'Integrações', icon: Layers3 },
  { id: 'settings', name: 'Administração', icon: Settings2 },
] as const
const pagePath = (page: Page) => page === 'office' ? '/' : `/${page}`
const ownerOnly = (page?: Page) => page === 'settings' || page === 'profit'
const currentRoute = () => window.location.pathname + window.location.search
function pageFor(route: string): Page | undefined {
  const [path, query] = route.split('?')
  if (path === '/' && new URLSearchParams(query).has('shopee')) return 'connections'
  return pages.find(({ id }) => pagePath(id) === path)?.id
}
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 })
const localeTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
const day = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' })
const statusLabels = { queued: 'Na fila', running: 'Trabalhando', done: 'Concluída', failed: 'Falhou', blocked: 'Bloqueada', pending: 'Pendente', approved: 'Aprovada', rejected: 'Rejeitada', expired: 'Expirada', applied: 'Aplicada na demonstração', uncertain: 'Em revisão' }
const byId = Object.fromEntries(agents.map((a) => [a.id, a])) as Record<AgentId, typeof agents[number]>

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) throw new ApiError(response.status, data.error)
  return data
}
function errorLabel(error: unknown) { return error instanceof ApiError ? error.message : 'Não foi possível acessar o servidor.' }
function formValues(event: FormEvent<HTMLFormElement>) {
  event.preventDefault()
  return new FormData(event.currentTarget)
}
function Badge({ status, label }: { status: keyof typeof statusLabels; label?: string }) {
  return <span className={`pill pill-${status}`}>{label || statusLabels[status]}</span>
}
function TaskResult({ result }: { result: string }) {
  return <p className="result">{result.split(/(https:\/\/[^\s<>()[\]]+)/u).map((part, index) => {
    if (index % 2 === 0) return part
    const address = part.replace(/[.,;!?]+$/u, '')
    return <span key={index}><a href={address} target="_blank" rel="noopener noreferrer">{address}</a>{part.slice(address.length)}</span>
  })}</p>
}
function Card({ title, icon, children, className = '' }: { title: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}><div className="card-head">{icon}{<h2>{title}</h2>}</div>{children}</section>
}
function Avatar({ id }: { id: AgentId }) {
  const item = byId[id]
  return <span className="avatar" style={{ color: item.color, backgroundColor: `${item.color}20` }} aria-hidden="true">{item.name[0]}</span>
}
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <dialog ref={(dialog) => { if (dialog && !dialog.open) dialog.showModal() }} onCancel={onClose}>
    <div className="modal-head"><h2>{title}</h2><button type="button" className="secondary" onClick={onClose}>Fechar</button></div>
    {children}
  </dialog>
}

type LoginMode = 'login' | 'signup' | 'recover' | 'reset'
function Login({ onSuccess, local, recoveryToken, expiredLink }: { onSuccess: () => Promise<void>; local: boolean; recoveryToken?: string; expiredLink?: boolean }) {
  const [error, setError] = useState(expiredLink ? 'O link de recuperação expirou ou é inválido. Solicite um novo link.' : '')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<LoginMode>(recoveryToken ? 'reset' : expiredLink ? 'recover' : 'login')
  const [visible, setVisible] = useState(false)
  const [email, setEmail] = useState('')
  const signup = mode === 'signup'
  const recovering = mode === 'recover'
  const resetting = mode === 'reset'
  function switchMode(next: LoginMode) {
    setMode(next)
    setVisible(false)
    setError('')
    setNotice('')
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    const values = formValues(event)
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const credentials = { email: values.get('email'), password: values.get('password') }
      if (recovering) {
        await request('/recover', { email: credentials.email })
        setNotice('Se houver uma conta com esse e-mail, você receberá um link para redefinir a senha. Confira também o spam.')
        return
      }
      if (resetting) {
        if (credentials.password !== values.get('confirmation')) {
          setError('As senhas precisam ser iguais.')
          return
        }
        await request('/reset-password', { accessToken: recoveryToken, password: credentials.password })
        switchMode('login')
        setNotice('Senha alterada. Entre com a nova senha.')
        return
      }
      if (signup) {
        const result = await request<{ confirmationRequired: boolean }>('/signup', credentials)
        if (result.confirmationRequired) {
          switchMode('login')
          setNotice('Confira seu e-mail. Se receber o link de confirmação, abra-o e depois entre com a senha criada.')
          return
        }
      } else {
        await request('/login', credentials)
      }
      await onSuccess()
    } catch (err) { setError(errorLabel(err)) }
    finally { setBusy(false) }
  }
  return <main className="login">
    <div className="brand"><span className="brand-mark"><Store size={22} /></span><strong>Shopee Manager IA</strong></div>
    <section className="card login-card">
      <h1>{{ login: 'Acesse seu escritório', signup: 'Crie sua conta', recover: 'Recuperar senha', reset: 'Definir nova senha' }[mode]}</h1>
      <p>{recovering ? 'Informe o e-mail da sua conta para receber um link de recuperação.' : signup || resetting ? 'Escolha uma senha com pelo menos 8 caracteres.' : 'Entre para acompanhar sua equipe e a operação da loja.'}</p>
      {notice && <p role="status" className="login-notice">{notice}</p>}
      <form key={mode} onSubmit={submit}>
        {!resetting && <label>E-mail<input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label>}
        {!recovering && <div className="password-field">
          <label htmlFor="account-password">{resetting ? 'Nova senha' : 'Senha'}</label>
          <div className="password-control">
            <input id="account-password" name="password" type={visible ? 'text' : 'password'} autoComplete={signup || resetting ? 'new-password' : 'current-password'} minLength={signup || resetting ? 8 : undefined} maxLength={256} required />
            <button type="button" className="password-toggle" onClick={() => setVisible(!visible)} aria-controls="account-password" aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'} title={visible ? 'Ocultar senha' : 'Mostrar senha'}>
              {visible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
            </button>
          </div>
        </div>}
        {resetting && <label>Confirme a nova senha<input name="confirmation" type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={256} required /></label>}
        {error && <p role="alert" className="error">{error}</p>}
        <button className="primary" disabled={busy}>{(busy
          ? { login: 'Entrando…', signup: 'Criando conta…', recover: 'Enviando…', reset: 'Salvando…' }
          : { login: 'Entrar', signup: 'Criar conta', recover: 'Enviar link', reset: 'Salvar nova senha' })[mode]}</button>
      </form>
      {!local && (mode === 'login' ? <>
        <p className="auth-choice"><button type="button" className="text-button" onClick={() => switchMode('recover')} disabled={busy}>Esqueci minha senha</button></p>
        <p className="auth-choice">Primeiro acesso? <button type="button" className="text-button" onClick={() => switchMode('signup')} disabled={busy}>Criar conta</button></p>
      </> : <p className="auth-choice"><button type="button" className="text-button" onClick={() => switchMode(resetting ? 'recover' : 'login')} disabled={busy}>{resetting ? 'Solicitar outro link' : 'Voltar para entrar'}</button></p>)}
      {local && <p className="login-demo"><strong>Conta local de demonstração</strong><br />demo@local.test · senha padrão <code>demonstracao</code></p>}
    </section>
  </main>
}

function Tasks({ data, writable, mutate, runId, onShowAll }: { data: Snapshot; writable: boolean; mutate: (path: string, body: unknown) => Promise<boolean>; runId: string | null; onShowAll: () => void }) {
  const runs = runId ? data.runs.filter((run) => run.id === runId) : data.runs
  return <Card title="Fluxos de trabalho" icon={<ClipboardList size={19} />}>
    {runId && <button className="text-button show-all-runs" onClick={onShowAll}>Todos os fluxos</button>}
    {!runs.length && <p className="empty">{runId ? 'Fluxo indisponível no histórico recente.' : 'Nenhuma tarefa registrada. Crie uma tarefa para iniciar um fluxo.'}</p>}
    <div className="runs">{runs.map((run) => {
      const { brief, segment } = splitMarketBrief(run.brief)
      return <article className="run" key={run.id}>
      <div className="run-head"><div><h3>{workflowLabels[run.workflow]}</h3><p>{brief}</p>{segment && <small>{segment.label}</small>}</div><small>{run.source === 'schedule' ? 'Rotina diária · ' : ''}{localeTime.format(new Date(run.created_at))}</small></div>
      <ol>{run.tasks.map((task) => <li key={task.id}>
        <div className="person"><Avatar id={task.agent} /><div><strong>{byId[task.agent].name}</strong><small>{byId[task.agent].role}</small></div><Badge status={task.status} /></div>
        {task.result && <TaskResult result={task.result} />}
        {task.error && <p className="error">{task.error} · {task.attempts} tentativa(s)</p>}
      </li>)}</ol>
      {writable && run.tasks.some((task) => task.status === 'blocked' || (task.status === 'failed' && task.attempts < 6)) && <button className="secondary" onClick={() => void mutate(`/runs/${run.id}/retry`, {})}>Reprocessar</button>}
    </article>})}</div>
  </Card>
}

function Sales({ data }: { data: Snapshot }) {
  const products = data.products
  const total = products.reduce((sum, item) => sum + Math.round(item.revenue * 100), 0) / 100
  return <>
    <div className="stats">
      <Metric icon={<Wallet size={20} />} label="Receita informada" value={products.length ? brl.format(total) : 'Indisponível'} note="Conjunto importado" />
      <Metric icon={<BriefcaseBusiness size={20} />} label="Produtos" value={products.length} note="SKUs cadastrados" />
      <Metric icon={<Activity size={20} />} label="Estoque baixo" value={products.filter((item) => item.stock < 5).length} note="Abaixo de 5 unidades" />
    </div>
    <Card title="Desempenho por produto" icon={<BarChart3 size={19} />}>
      <p className="muted">Fonte: {data.fixture ? 'conjunto de demonstração e importações locais' : data.shopee.connected ? 'Shopee e importações manuais' : 'importação manual'}. Conversão e queda de vendas dependem de dados de tráfego e períodos comparáveis.</p>
      <div className="table-scroll"><table><thead><tr><th>Produto</th><th>Estoque</th><th>Unidades vendidas</th><th>Receita</th><th>Margem unitária estimada</th></tr></thead><tbody>
        {products.map((item) => <tr key={item.sku}><td><strong>{item.name}</strong><small>{item.sku}</small></td><td>{item.stock}</td><td>{item.units}</td><td>{brl.format(item.revenue)}</td><td>{item.cost === null || item.fee === null ? 'Dados incompletos' : brl.format((Math.round(item.price * 100) - Math.round(item.cost * 100) - Math.round(item.fee * 100)) / 100)}</td></tr>)}
      </tbody></table></div>
      {!products.length && <p className="empty">Importe produtos para visualizar indicadores.</p>}
    </Card>
    <Card title="Histórico de vendas por dia" icon={<History size={19} />}>
      {data.salesHistory.length ? <div className="table-scroll"><table><thead><tr><th>Data de referência</th><th>SKUs</th><th>Unidades</th><th>Receita informada</th></tr></thead><tbody>
        {data.salesHistory.map((item) => <tr key={item.period}><td>{item.period.split('-').reverse().join('/')}</td><td>{item.skus}</td><td>{item.units}</td><td>{brl.format(item.revenue)}</td></tr>)}
      </tbody></table></div> : <p className="empty">Inclua a data de referência ao importar vendas diárias.</p>}
    </Card>
  </>
}

function recentProfitPeriod() {
  const brazilToday = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const dateBefore = (days: number) => new Date(Date.parse(brazilToday) - days * 86400000).toISOString().slice(0, 10)
  return { start: dateBefore(7), end: dateBefore(1) }
}

const financeFields = [
  { key: 'payout_cents', label: 'Valor final a receber (R$)', min: -1_000_000 },
  { key: 'refund_cents', label: 'Reembolsos (R$)', min: 0 },
  { key: 'fee_cents', label: 'Taxas e encargos (R$)', min: 0 },
  { key: 'cost_cents', label: 'Custo total dos produtos (R$)', min: 0 },
  { key: 'extra_cents', label: 'Outros custos do pedido (R$)', min: 0 },
] as const
const moneyFromCents = (cents: number | null) => cents === null ? '—' : brl.format(cents / 100)
function orderProfit(order: OrderFinance) {
  if (order.payout_cents === null || order.cost_cents === null) return null
  return order.payout_cents - order.cost_cents - order.extra_cents
}

function Profit() {
  const [period, setPeriod] = useState(recentProfitPeriod)
  const [result, setResult] = useState<{ rows: OrderFinance[] } | { error: string }>()
  const [editing, setEditing] = useState<OrderFinance>()
  const [saveError, setSaveError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    void request<OrderFinance[]>(`/profit?${new URLSearchParams(period)}`).then((rows) => {
      if (active) setResult({ rows })
    }, (error: unknown) => {
      if (active) setResult({ error: errorLabel(error) })
    })
    return () => { active = false }
  }, [period, revision])

  const rows = result && 'rows' in result ? result.rows : []
  const calculated = rows.filter((order) => orderProfit(order) !== null)
  const provisional = calculated.filter((order) => order.cost_provisional).length
  const net = calculated.reduce((sum, order) => sum + (orderProfit(order) ?? 0), 0)
  const settlements = rows.filter((order) => order.payout_cents !== null)
  const proceeds = settlements.reduce((sum, order) => sum + (order.payout_cents ?? 0), 0)
  async function save(event: FormEvent<HTMLFormElement>) {
    const data = formValues(event)
    if (!editing || saving) return
    setSaving(true)
    setSaveError(undefined)
    const amounts = Object.fromEntries(financeFields.map(({ key }) => {
      const value = data.get(key)
      return [key, value === '' && key !== 'extra_cents' ? null : Math.round(Number(value) * 100)]
    }))
    try {
      await request('/profit', { period: editing.period, order_sn: editing.order_sn, ...amounts, cost_provisional: data.has('cost_provisional') })
      setEditing(undefined)
      setResult(undefined)
      setRevision((value) => value + 1)
    } catch (error: unknown) {
      setSaveError(errorLabel(error))
    } finally { setSaving(false) }
  }

  return <>
    <Card title="Período dos pedidos">
      <form className="profit-period" onSubmit={(event) => {
        const data = formValues(event)
        setResult(undefined)
        setPeriod({ start: String(data.get('start')), end: String(data.get('end')) })
      }}>
        <label>De<input name="start" type="date" required defaultValue={period.start} /></label>
        <label>Até<input name="end" type="date" required defaultValue={period.end} /></label>
        <button className="secondary">Aplicar</button>
      </form>
    </Card>
    {result === undefined ? <p className="profit-status muted" role="status">Carregando pedidos…</p> : 'error' in result ? <p className="profit-status banner error" role="alert">{result.error}</p> : <>
      <div className="stats profit-stats">
        <Metric icon={<Wallet size={20} />} label={provisional ? 'Lucro provisório' : 'Lucro apurado'} value={moneyFromCents(calculated.length ? net : null)} note={provisional ? `${provisional} ${provisional === 1 ? 'pedido com custo provisório' : 'pedidos com custo provisório'}` : `${calculated.length} de ${rows.length} pedidos com lucro calculado`} />
        <Metric icon={<Store size={20} />} label="Valor a receber da Shopee" value={moneyFromCents(settlements.length ? proceeds : null)} note={`${settlements.length} pedidos com valor informado`} />
        <Metric icon={<ClipboardList size={20} />} label="Pedidos pendentes" value={rows.length - calculated.length} note="Falta o valor a receber ou o custo dos produtos" />
      </div>
      <Card title="Resultado por pedido">
        <p className="muted">O lucro considera o valor final da Shopee após taxas e reembolsos, menos o custo dos produtos e outros custos registrados. Os valores financeiros são lançados a partir da Central do Vendedor.</p>
        {rows.length === 0 ? <p className="empty">Nenhum pedido concluído sincronizado neste período.</p> : <div className="table-scroll"><table className="profit-table"><thead><tr>
          <th>Pedido</th><th>Venda</th><th>Reembolso</th><th>Taxas</th><th>A receber</th><th>Custos</th><th>Lucro</th><th>Ação</th>
        </tr></thead><tbody>{rows.map((order) => <tr key={`${order.period}:${order.order_sn}`}>
          <td><strong>{order.order_sn}</strong><small>{order.period.split('-').reverse().join('/')}</small>{order.products.map((product, index) => <small key={index}>{product.units} × {product.name}</small>)}</td>
          <td>{moneyFromCents(order.gross_cents)}</td><td>{moneyFromCents(order.refund_cents)}</td><td>{moneyFromCents(order.fee_cents)}</td><td>{moneyFromCents(order.payout_cents)}</td>
          <td>{moneyFromCents(order.cost_cents === null ? null : order.cost_cents + order.extra_cents)}</td>
          <td><strong>{orderProfit(order) === null ? 'Pendente' : moneyFromCents(orderProfit(order))}</strong>{order.cost_provisional && <small>Provisório</small>}</td>
          <td><button className="secondary" aria-label={`Editar valores do pedido ${order.order_sn}`} onClick={() => { setSaveError(undefined); setEditing(order) }}>Editar</button></td>
        </tr>)}</tbody></table></div>}
      </Card>
    </>}
    {editing && <Modal title="Valores do pedido" onClose={() => { if (!saving) setEditing(undefined) }}>
      <p className="muted">Informe o valor final já descontado pela Shopee. Em caso de reembolso, inclua no custo do pedido apenas os produtos cujo custo ficou com a loja.</p>
      <form className="form-grid" onSubmit={save}>
        {financeFields.map(({ key, label, min }) => <label key={key}>{label}<input type="number" name={key} min={min} max="1000000" step="0.01" defaultValue={editing[key] === null ? undefined : editing[key] / 100} /></label>)}
        <label className="check span"><input name="cost_provisional" type="checkbox" defaultChecked={editing.cost_provisional} />Custo provisório</label>
        {saveError && <p className="span banner error" role="alert">{saveError}</p>}
        <div className="span"><button className="primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar valores'}</button></div>
      </form>
    </Modal>}
  </>
}

function Reports({ data }: { data: Snapshot }) {
  return <Card title="Relatórios e alertas da loja" icon={<Bell size={19} />}>
    {!data.notifications.length && <p className="empty">Os relatórios e alertas aparecem após uma análise operacional concluída.</p>}
    {data.notifications.map((item) => <details className="audit" key={item.id}>
      <summary>{item.title} <small>{localeTime.format(new Date(item.created_at))}</small></summary>
      <p className="result">{item.body}</p>
    </details>)}
  </Card>
}

function Proposals({ data, writable, mutate }: { data: Snapshot; writable: boolean; mutate: (path: string, body: unknown) => Promise<boolean> }) {
  const confirmed = data.runs.flatMap((run) => run.tasks.filter((task) => task.status === 'done').map((task) => ({
    id: task.id, label: `${byId[task.agent].name} · ${splitMarketBrief(run.brief).brief.slice(0, 70)}`,
  })))
  async function submit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget
    const values = formValues(event)
    if (await mutate('/proposals', { sku: values.get('sku'), price: Number(values.get('price')), evidence: values.get('evidence'), sourceTask: values.get('sourceTask') || undefined })) form.reset()
  }
  return <>
    {writable && <Card title="Nova proposta de preço" icon={<Plus size={19} />}>
      <form onSubmit={submit} className="form-grid">
        <label>Produto<select name="sku" required defaultValue=""><option value="" disabled>Selecione um produto</option>{data.products.map((item) => <option key={item.sku} value={item.sku}>{item.name} ({item.sku})</option>)}</select></label>
        <label>Novo preço (R$)<input name="price" type="number" min="0.01" step="0.01" required /></label>
        {!!confirmed.length && <label className="span">Resultado da equipe (opcional)<select name="sourceTask"><option value="">Proposta manual</option>{confirmed.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
        <label className="span">Evidência e justificativa<textarea name="evidence" minLength={5} maxLength={2000} required /></label>
        <div><button className="primary">Registrar proposta</button></div>
      </form>
    </Card>}
    <Card title="Fila de aprovação" icon={<ShieldCheck size={19} />}>
      {!data.proposals.length && <p className="empty">Nenhuma proposta registrada.</p>}
      {data.proposals.map((item) => <article className="proposal" key={item.id}>
        <div><strong>{item.sku} · {brl.format(item.previous_price)} para {brl.format(item.price)}</strong><p>{item.evidence}</p><small>{item.recommended_by ? `Evidência de ${byId[item.recommended_by].name} · ` : ''}{localeTime.format(new Date(item.created_at))}</small></div>
        <div className="proposal-actions"><Badge status={item.status} label={item.status === 'applied' && !data.fixture ? 'Aplicada na Shopee' : undefined} />{item.status === 'pending' && data.shop.role === 'owner' && <>
          <button className="secondary" onClick={() => void mutate(`/proposals/${item.id}/decision`, { approve: false })}>Rejeitar</button>
          <button className="primary" onClick={() => void mutate(`/proposals/${item.id}/decision`, { approve: true })}>Aprovar</button>
        </>}</div>
      </article>)}
    </Card>
  </>
}

function parseCatalog(csv: string): Product[] {
  const lines = csv.trim().split(/\r?\n/u)
  if (lines.shift()?.replace(/^\uFEFF/u, '') !== 'sku;nome;preco;custo;taxa;estoque;unidades;receita') throw new Error('Use o cabeçalho e a ordem de colunas do modelo.')
  const numeric = (raw: string) => {
    if (!/^\d+(?:[.,]\d+)?$/u.test(raw)) throw new Error('Os valores numéricos devem ser preenchidos sem separador de milhar.')
    return Number(raw.replace(',', '.'))
  }
  return lines.filter((line) => line.trim()).map((line) => {
    const cells = line.split(';').map((cell) => cell.trim())
    if (cells.length !== 8) throw new Error('Cada linha deve ter oito colunas separadas por ponto e vírgula.')
    const [sku, name, price, cost, fee, stock, units, revenue] = cells
    return { sku, name, price: numeric(price), cost: cost === '' ? null : numeric(cost), fee: fee === '' ? null : numeric(fee), stock: numeric(stock), units: numeric(units), revenue: numeric(revenue) }
  })
}

function Connections({ data, writable, mutate }: { data: Snapshot; writable: boolean; mutate: (path: string, body: unknown) => Promise<boolean> }) {
  const [error, setError] = useState('')
  const shopee = data.shopee
  const [busy, setBusy] = useState(false)
  async function authorize() {
    setBusy(true)
    setError('')
    try { window.location.assign((await request<{ url: string }>('/shopee/authorize', {})).url) }
    catch (err) { setError(errorLabel(err)); setBusy(false) }
  }
  function synchronize(event: FormEvent<HTMLFormElement>) {
    const values = formValues(event)
    void mutate('/shopee/sync', { period: values.get('shopeePeriod') || undefined })
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    const values = formValues(event)
    let products: Product[]
    try { products = parseCatalog(String(values.get('catalog'))) }
    catch (err) { setError((err as Error).message); return }
    setError('')
    await mutate('/products/import', { products, period: values.get('period') || undefined })
  }
  return <>
    <Card title="Conexões" icon={<Layers3 size={19} />}>
      <div className="connection"><Store size={23} /><div><strong>Shopee Open Platform</strong><p>{shopee.mode === 'disabled' ? 'Configure o aplicativo parceiro no backend para autorizar uma loja.' : shopee.mode === 'sandbox' ? 'Ambiente de testes da Shopee' : 'Ambiente de produção da Shopee'}</p></div><span className={shopee.connected ? 'pill pill-done' : 'pill'}>{shopee.connected ? 'Conectada' : 'Pendente'}</span></div>
      {shopee.mode !== 'disabled' && data.shop.role === 'owner' && <button className="secondary" disabled={busy} onClick={() => void authorize()}>{shopee.connected ? 'Renovar autorização' : 'Autorizar loja'}</button>}
      {shopee.connected && <>
        <p className="muted">Atualizações de preço na Shopee {shopee.writes ? 'habilitadas mediante aprovação' : 'desabilitadas no backend'}.</p>
        {shopee.status && <p role="status">Sincronização {({ queued: 'na fila', running: 'em andamento', failed: 'interrompida', done: 'concluída' })[shopee.status]}{shopee.error ? ` · ${shopee.error}` : ''}</p>}
        {writable && <form className="sync-form" onSubmit={synchronize}>
          <label>Data de criação dos pedidos concluídos <input name="shopeePeriod" type="date" /></label>
          <button className="secondary" disabled={shopee.status === 'queued' || shopee.status === 'running'}>Sincronizar Shopee</button>
        </form>}
      </>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="connection"><Database size={23} /><div><strong>PostgreSQL</strong><p>{data.local ? 'Banco local persistente' : 'Banco do ambiente Supabase'}</p></div><span className="pill pill-done">Ativo</span></div>
      <div className="connection"><Gauge size={23} /><div><strong>Análise dos agentes</strong><p>{{ codex: 'Codex CLI executado pelo worker', gemini: 'Gemini configurado no backend', local: 'Regras locais com resultados a partir do briefing e dos dados disponíveis' }[data.provider]}</p></div><span className="pill pill-done">Ativo</span></div>
    </Card>
    {shopee.adsEnabled && <Card title="Desempenho de anúncios CPC" icon={<BarChart3 size={19} />}>
      {shopee.ads.length ? <div className="table-scroll"><table><thead><tr><th>Dia</th><th>Impressões</th><th>Cliques</th><th>Conversões diretas</th><th>Gasto</th></tr></thead><tbody>
        {shopee.ads.map((item) => <tr key={item.period}><td>{item.period.split('-').reverse().join('/')}</td><td>{item.impressions}</td><td>{item.clicks}</td><td>{item.conversions}</td><td>{brl.format(item.expense)}</td></tr>)}
      </tbody></table></div> : <p className="empty">Sincronize um dia com dados de anúncios e acesso ao escopo Ads.</p>}
    </Card>}
    {writable && <Card title="Importação manual de catálogo" icon={<FileText size={19} />}>
      <p className="muted">Cole até 1.000 linhas no formato abaixo. A importação atualiza os SKUs informados. Use custo e taxa unitários e deixe esses campos vazios se estiverem indisponíveis. Preencha a data apenas quando unidades e receita corresponderem a esse dia.</p>
      <form onSubmit={submit}>
        <label>Data de referência das vendas (opcional)<input name="period" type="date" /></label>
        <label>Catálogo CSV<textarea name="catalog" rows={6} spellCheck={false} required placeholder={'sku;nome;preco;custo;taxa;estoque;unidades;receita\nA01;Produto;19,90;6,00;3,50;12;4;79,60'} /></label>
        <button className="primary">Importar catálogo</button>
      </form>
    </Card>}
  </>
}

function Settings({ data, mutate }: { data: Snapshot; mutate: (path: string, body: unknown) => Promise<boolean> }) {
  const { settings, usage } = data
  const total = usage.reduce((sum, row) => sum + row.cost, 0)
  const today = day.format(new Date())
  const todayCost = usage.filter((row) => day.format(new Date(row.created_at)) === today).reduce((sum, row) => sum + row.cost, 0)
  async function saveMember(event: FormEvent<HTMLFormElement>) {
    const values = formValues(event)
    await mutate('/members', { user: values.get('user'), role: values.get('role') })
  }
  function save(event: FormEvent<HTMLFormElement>) {
    const values = formValues(event)
    void mutate('/settings', {
      daily: values.has('daily'), hour: Number(values.get('hour')), dailyLimit: Number(values.get('dailyLimit')), monthlyLimit: Number(values.get('monthlyLimit')),
      paused: values.getAll('paused'), instructions: Object.fromEntries(agents.map(({ id }) => [id, values.get(`instruction-${id}`)])),
    })
  }
  return <>
    <div className="stats">
      <Metric icon={<Wallet size={20} />} label="Orçamento do dia" value={usd.format(todayCost)} note={`Limite ${usd.format(settings.dailyLimit)}`} />
      <Metric icon={<Wallet size={20} />} label="Orçamento do mês" value={usd.format(total)} note={`Limite ${usd.format(settings.monthlyLimit)}`} />
      <Metric icon={<Clock3 size={20} />} label="Última verificação do worker" value={settings.lastWorker ? localeTime.format(new Date(settings.lastWorker)) : 'Aguardando'} note="Horário de São Paulo" />
    </div>
    <Card title="Rotinas, limites e equipe" icon={<Settings2 size={19} />}>
      <form onSubmit={save} className="form-grid" key={JSON.stringify({ ...settings, lastWorker: null })}>
        <label className="check span"><input type="checkbox" name="daily" defaultChecked={settings.daily} />Gerar relatório diário automaticamente</label>
        <label>Hora do dia (São Paulo)<input name="hour" type="number" min="0" max="23" defaultValue={settings.hour} required /></label>
        <div />
        <label>Limite diário (USD)<input name="dailyLimit" type="number" min="0" step="0.01" defaultValue={settings.dailyLimit} required /></label>
        <label>Limite mensal (USD)<input name="monthlyLimit" type="number" min="0" step="0.01" defaultValue={settings.monthlyLimit} required /></label>
        <details className="span"><summary>Configurar funcionários</summary>
          {agents.map((agent) => <div className="agent-setting" key={agent.id}>
            <label className="check"><input type="checkbox" name="paused" value={agent.id} defaultChecked={settings.paused.includes(agent.id)} />Pausar {agent.name}</label>
            <label>Instrução de {agent.name}<textarea name={`instruction-${agent.id}`} maxLength={1000} placeholder={agent.instruction} defaultValue={settings.instructions[agent.id] || ''} /></label>
          </div>)}
        </details>
        <div><button className="primary">Salvar configurações</button></div>
      </form>
    </Card>
    <Card title="Acesso à loja" icon={<Users size={19} />}>
      <div className="table-scroll"><table><thead><tr><th>Identificador do usuário</th><th>Papel</th></tr></thead><tbody>
        {data.members.map(({ user_id, role, self }) => <tr key={user_id}><td>{user_id}{self ? ' (você)' : ''}</td><td>{{ owner: 'Proprietário', operator: 'Operador', reader: 'Leitor' }[role]}</td></tr>)}
      </tbody></table></div>
      <form className="form-grid member-form" onSubmit={saveMember}>
        <label>{data.local ? 'Conta local' : 'UUID do usuário no Supabase'}<input name="user" required defaultValue={data.local ? 'local-reader' : undefined} readOnly={data.local} /></label>
        <label>Papel<select name="role" defaultValue="reader"><option value="reader">Leitor</option><option value="operator">Operador</option><option value="owner">Proprietário</option><option value="remove">Remover acesso</option></select></label>
        <div><button className="primary">Atualizar acesso</button></div>
      </form>
    </Card>
    <Card title="Uso de IA no mês" icon={<Wallet size={19} />}>
      {!usage.length && <p className="empty">Nenhum consumo registrado.</p>}
      {usage.length > 0 && <>
        <p className="muted">Os totais em USD incluem reservas e valores estimados pelas tarifas configuradas. O Codex CLI registra tokens. O consumo da conta Codex é acompanhado no próprio Codex.</p>
        <div className="table-scroll"><table><thead><tr><th>Funcionário</th><th>Tokens de entrada</th><th>Tokens de saída</th><th>Custo</th></tr></thead><tbody>{agents.map(({ id, name }) => {
          const records = usage.filter((row) => row.agent === id)
          return <tr key={id}><td>{name}</td><td>{records.reduce((sum, row) => sum + (row.input || 0), 0)}</td><td>{records.reduce((sum, row) => sum + (row.output || 0), 0)}</td><td>{usd.format(records.reduce((sum, row) => sum + row.cost, 0))}</td></tr>
        })}</tbody></table></div>
        <details><summary>Custos por tarefa e modelo</summary><div className="table-scroll"><table><thead><tr><th>Tarefa</th><th>Funcionário</th><th>Modelo</th><th>Custo</th><th>Estado</th></tr></thead><tbody>{usage.map((row, i) => <tr key={`${row.task_id}-${i}`}><td>{row.task_id.slice(0, 8)}</td><td>{byId[row.agent].name}</td><td>{row.model}</td><td>{row.model.startsWith('Codex CLI') ? 'Ver no Codex' : usd.format(row.cost)}</td><td>{{ reserved: 'Reservado', settled: 'Registrado', unknown: 'Incerto' }[row.status]}</td></tr>)}</tbody></table></div></details>
      </>}
    </Card>
    <Card title="Histórico de auditoria" icon={<History size={19} />}>
      {!data.audit.length && <p className="empty">Nenhum evento registrado.</p>}
      {data.audit.map((item) => <details className="audit" key={item.id}><summary>{item.event} <small>{item.actor} · {localeTime.format(new Date(item.created_at))}</small></summary><pre>{JSON.stringify(item.details, null, 2)}</pre></details>)}
    </Card>
  </>
}

function Metric({ icon, label, value, note }: { icon: ReactNode; label: string; value: string | number; note: string }) {
  return <div className="metric"><span className="metric-icon">{icon}</span><div><p>{label}</p><strong>{value}</strong><small>{note}</small></div></div>
}

function OfficeActivityPanel({ activity, openRun }: { activity: OfficeActivity[]; openRun: (id: string) => void }) {
  const current = activity.filter((entry) => entry.kind === 'task' && entry.status === 'running')
  const recent = activity.filter((entry) => entry.kind === 'handoff' || (entry.status !== 'running' && entry.status !== 'queued')).slice(0, 6)
  const queued = activity.filter((entry) => entry.kind === 'task' && entry.status === 'queued' && entry.ready).slice(0, 2)
  const visible = [...current, ...queued, ...recent].slice(0, Math.max(current.length + queued.length, 7))
  return <Card title="Atividade das tarefas" icon={<Activity size={19} />}>
    {!visible.length && <p className="muted">Assim que uma tarefa entrar na fila, ela aparecerá aqui.</p>}
    <ul className="office-activity" aria-label="Atividade das tarefas">
      {visible.map((entry) => <li key={entry.id} data-status={entry.kind === 'task' ? entry.status : 'handoff'}>
        <button onClick={() => openRun(entry.runId)}>
          <Avatar id={entry.agent} />
          <span><strong>{activityLabel(entry)}</strong><span className="activity-brief" title={entry.brief}>{entry.brief}</span><small>{entry.workflow} · Etapa {entry.stage}/{entry.stages}</small></span>
          <ChevronRight aria-hidden="true" size={16} />
        </button>
      </li>)}
    </ul>
  </Card>
}

function App() {
  const [data, setData] = useState<Snapshot>()
  const [loaded, setLoaded] = useState(false)
  const [local, setLocal] = useState(false)
  const [route, setRoute] = useState(currentRoute)
  const [profile, setProfile] = useState<AgentId>()
  const [newTask, setNewTask] = useState(false)
  const [newWorkflow, setNewWorkflow] = useState<Workflow>('oportunidade')
  const [message, setMessage] = useState<{ text: string; error?: boolean }>()
  const [submitting, setSubmitting] = useState(false)
  const [taskKey, setTaskKey] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const pendingRefresh = useRef<Promise<boolean> | undefined>(undefined)
  const signedIn = !!data
  const refresh = useCallback(() => {
    pendingRefresh.current ??= request<Snapshot>('/snapshot').then((snapshot) => {
      setData(snapshot)
      return true
    }).catch((error: unknown) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setData(undefined)
        setProfile(undefined)
        setNewTask(false)
        setMessage(error.status === 403 ? { text: error.message, error: true } : undefined)
        return false
      }
      throw error
    }).finally(() => { pendingRefresh.current = undefined })
    return pendingRefresh.current
  }, [])
  const go = useCallback((target: string, replace = false) => {
    if (currentRoute() === target) return
    if (replace) window.history.replaceState(null, '', target)
    else window.history.pushState(null, '', target)
    setRoute(currentRoute())
  }, [])
  useEffect(() => {
    const onPopState = () => setRoute(currentRoute())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const loginRoute = route.split('?')[0] === '/login'
  const requestedPage = pageFor(route)
  const canAdminister = data?.shop.role === 'owner'
  const page = ownerOnly(requestedPage) && !canAdminister ? 'office' : requestedPage ?? 'office'
  useEffect(() => {
    if (!loaded) return
    if (!signedIn && !loginRoute) {
      go(requestedPage ? `/login?${new URLSearchParams({ next: route })}` : '/login', true)
    } else if (signedIn && loginRoute) {
      const next = new URLSearchParams(route.slice(route.indexOf('?') + 1)).get('next') ?? ''
      const destination = pageFor(next)
      go(destination && (!ownerOnly(destination) || canAdminister) ? next : '/', true)
    } else if (signedIn && (!requestedPage || (ownerOnly(requestedPage) && !canAdminister))) {
      go('/', true)
    }
  }, [canAdminister, go, loaded, loginRoute, requestedPage, route, signedIn])
  useEffect(() => {
    void Promise.all([refresh(), request<{ local: boolean }>('/config').then((value) => setLocal(value.local))])
      .catch((error) => setMessage({ text: errorLabel(error), error: true })).finally(() => setLoaded(true))
  }, [refresh])
  useEffect(() => {
    if (!signedIn || signingOut) return
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh().catch(() => {})
    }, 1800)
    return () => window.clearInterval(interval)
  }, [refresh, signedIn, signingOut])
  const states = useMemo(() => {
    const running = new Set(data?.runs.flatMap((item) => item.tasks.filter((task) => task.status === 'running').map((task) => task.agent)))
    return Object.fromEntries(agents.map(({ id }) => [id, running.has(id) ? 'Trabalhando' : data?.settings.paused.includes(id) ? 'Em pausa' : 'Aguardando'])) as States
  }, [data])
  const activity = useMemo(() => officeActivity(data?.runs ?? []), [data])
  async function mutate(path: string, body: unknown) {
    setMessage(undefined)
    try {
      await request(path, body)
      if (!await refresh()) return false
      setMessage({ text: 'Operação registrada.' })
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await refresh().catch(() => {})
      else setMessage({ text: errorLabel(error), error: true })
      return false
    }
  }
  async function createTask(event: FormEvent<HTMLFormElement>) {
    const values = formValues(event)
    setSubmitting(true)
    const ok = await mutate('/runs', { workflow: values.get('workflow'), brief: values.get('brief'), key: taskKey, segment: values.get('segment') ?? undefined, query: values.get('query') ?? undefined })
    setSubmitting(false)
    if (ok) { setNewTask(false); if (page !== 'office') go('/tasks') }
  }
  function navigate(target: Page) { setMessage(undefined); go(pagePath(target)) }
  async function logout() {
    setSigningOut(true)
    try {
      await pendingRefresh.current?.catch(() => {})
      await request('/logout', {})
      setMessage(undefined)
    } catch (error) {
      setMessage({ text: errorLabel(error), error: true })
      if (!(error instanceof ApiError && error.status === 502)) return
    } finally {
      setSigningOut(false)
    }
    setData(undefined)
    setProfile(undefined)
    setNewTask(false)
    go('/login', true)
  }
  if (!loaded) return <p className="loading">Carregando escritório…</p>
  if (!data) return <>{message && <p role="alert" className="global-error">{message.text}</p>}<Login local={local} onSuccess={async () => { if (await refresh()) setMessage(undefined) }} /></>
  if (loginRoute) return <p className="loading">Carregando escritório…</p>
  const writable = data.shop.role !== 'reader'
  const employee = profile ? byId[profile] : undefined
  const tasks = data.runs.flatMap((run) => run.tasks)
  const working = agents.filter((item) => states[item.id] === 'Trabalhando').length
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Store size={22} /></span><div><strong>Shopee Manager</strong><small>Escritório IA</small></div></div>
      <div className="shop"><span className="shop-icon"><BriefcaseBusiness size={18} /></span><div><strong>{data.shop.name}</strong><small>{{ owner: 'Proprietário', operator: 'Operador', reader: 'Leitor' }[data.shop.role]}</small></div></div>
      <nav aria-label="Menu principal">{pages.filter((item) => !ownerOnly(item.id) || canAdminister).map(({ id, name, icon: Icon }) =>
        <button key={id} onClick={() => navigate(id)} aria-current={id === page ? 'page' : undefined}><Icon size={18} /><span>{name}</span>{id === page && <ChevronRight size={15} />}</button>,
      )}</nav>
      <button className="logout" disabled={signingOut} onClick={() => void logout()}><LogOut size={18} />Sair</button>
    </aside>
    <main className="main">
      <header className="topbar"><span>Workspace <ChevronRight size={14} /> {pages.find((item) => item.id === page)?.name}</span>{data.fixture && <span className="demo-tag">Demonstração</span>}</header>
      <div className="content">
        <div className="page-head"><div><h1>{page === 'office' ? 'Escritório virtual' : pages.find((item) => item.id === page)?.name}</h1>
          {page === 'office' && <p>Acompanhe o trabalho da sua equipe em um só lugar.</p>}</div>
          {writable && page !== 'profit' && <button className="primary" onClick={() => { setMessage(undefined); setTaskKey(crypto.randomUUID()); setNewWorkflow('oportunidade'); setNewTask(true) }}><Plus size={18} /> Nova tarefa</button>}
        </div>
        {message && <div className={message.error ? 'banner error' : 'banner success'} role={message.error ? 'alert' : 'status'}>{message.text}<button className="text-button" onClick={() => setMessage(undefined)}>Dispensar</button></div>}
        {page === 'office' && <>
          <div className="stats">
            <Metric icon={<Users size={20} />} label="Equipe" value={agents.length} note="Funcionários disponíveis" />
            <Metric icon={<Activity size={20} />} label="Em atividade" value={working} note="Executando agora" />
            <Metric icon={<CheckCircle2 size={20} />} label="Concluídas" value={tasks.filter((item) => item.status === 'done').length} note="Nas últimas 100 jornadas" />
          </div>
          <div className="office-grid">
            <Card title="Planta do escritório" icon={<Building2 size={19} />} className="office-card">
              <Office states={states} activity={activity} onSelect={setProfile} />
              <div className="office-legend"><span><i /> Mesas de trabalho</span><span><i /> Área de descanso</span><span><i /> Entrega de tarefa</span></div>
              <div className="office-note"><CircleHelp size={16} /> Selecione um funcionário para abrir seu perfil.</div>
            </Card>
            <OfficeActivityPanel activity={activity} openRun={(id) => go(`/tasks?run=${encodeURIComponent(id)}`)} />
            <Card title="Equipe" icon={<Users size={19} />} className="office-roster">
              <div className="roster">{agents.map((item) => <button className="person roster-person" key={item.id} onClick={() => setProfile(item.id)}>
                <Avatar id={item.id} /><span><strong>{item.name}</strong><small>{item.role}</small></span><span className="agent-status" data-working={states[item.id] === 'Trabalhando'}>{states[item.id]}</span>
              </button>)}</div>
            </Card>
          </div>
        </>}
        {page === 'tasks' && <Tasks data={data} writable={writable} mutate={mutate} runId={new URLSearchParams(route.split('?')[1]).get('run')} onShowAll={() => go('/tasks')} />}
        {page === 'sales' && <Sales data={data} />}
        {page === 'profit' && <Profit />}
        {page === 'reports' && <Reports data={data} />}
        {page === 'proposals' && <Proposals data={data} writable={writable} mutate={mutate} />}
        {page === 'connections' && <Connections data={data} writable={writable} mutate={mutate} />}
        {page === 'settings' && data.shop.role === 'owner' && <Settings data={data} mutate={mutate} />}
      </div>
    </main>
    {employee && <Modal title={employee.name} onClose={() => setProfile(undefined)}>
      <div className="person"><Avatar id={employee.id} /><div><strong>{employee.role}</strong><small>{employee.group} · {states[employee.id]}</small></div></div>
      <p>{employee.personality}</p><h3>Responsabilidade</h3><p>{data.settings.instructions[employee.id] || employee.instruction}</p>
      <h3>Ferramentas</h3><ul>{employee.tools.map((tool) => <li key={tool}>{tool}</li>)}</ul>
      <h3>Histórico de trabalho</h3>
      {tasks.filter((task) => task.agent === employee.id && task.result).slice(0, 5).map((task) => <TaskResult key={task.id} result={task.result!} />)}
      {!tasks.some((task) => task.agent === employee.id && task.result) && <p className="muted">Nenhum resultado registrado.</p>}
    </Modal>}
    {newTask && <Modal title="Nova tarefa" onClose={() => { if (!submitting) setNewTask(false) }}>
      <form onSubmit={createTask}>
        <label>Tipo de fluxo<select name="workflow" value={newWorkflow} onChange={(event) => setNewWorkflow(event.target.value as Workflow)}>{Object.entries(workflowLabels).map(([id, value]) => <option key={id} value={id as Workflow}>{value}</option>)}</select></label>
        {newWorkflow === 'oportunidade' && <>
          <label>Segmento<select name="segment">{marketSegments.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>Produto ou tema para pesquisar (opcional)<input name="query" maxLength={140} placeholder="Ex.: placas de MDF para decoração" /></label>
          <small>Use termos públicos nesse campo. Preços, frete e pedido mínimo ausentes ficam para cotação.</small>
        </>}
        <label>Briefing<textarea name="brief" required minLength={5} maxLength={2500} placeholder="Descreva o objetivo e os dados que a equipe pode usar." /></label>
        {message?.error && <p className="error" role="alert">{message.text}</p>}
        <button className="primary" disabled={submitting}>{submitting ? 'Enfileirando…' : 'Criar tarefa'}</button>
      </form>
    </Modal>}
  </div>
}

function readRecoveryLink() {
  const fragment = new URLSearchParams(location.hash.slice(1))
  const isRecovery = fragment.get('type') === 'recovery'
  if (!isRecovery && fragment.get('error_code') !== 'otp_expired') return
  history.replaceState(null, '', '/login')
  return { token: isRecovery ? fragment.get('access_token') || undefined : undefined }
}
const recoveryLink = readRecoveryLink()
createRoot(document.getElementById('root')!).render(<StrictMode>{recoveryLink
  ? <Login local={false} recoveryToken={recoveryLink.token} expiredLink={!recoveryLink.token} onSuccess={async () => { location.replace('/') }} />
  : <App />}</StrictMode>)

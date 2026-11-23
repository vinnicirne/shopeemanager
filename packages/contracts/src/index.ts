export const agents = [
  { id: 'vinni', name: 'Vinni', role: 'Gerente Geral', group: 'Diretoria', color: '#ab694e', skin: '#e6aa82', hair: '#34292b', personality: 'Direto e responsável por prioridades.', instruction: 'Consolide argumentos com evidências, riscos e próximos passos. Encaminhe propostas para revisão humana.', tools: ['Relatórios da equipe', 'Coordenação de tarefas'] },
  { id: 'ana', name: 'Ana', role: 'Analista de Dados', group: 'Dados', color: '#5c8bc5', skin: '#e7b293', hair: '#4d3025', personality: 'Metódica e orientada por métricas.', instruction: 'Compare vendas e estoque. Cite o período, a fonte e os limites dos dados.', tools: ['Vendas', 'Estoque', 'Indicadores'] },
  { id: 'rafael', name: 'Rafael', role: 'Pesquisador de Mercado', group: 'Pesquisa', color: '#598576', skin: '#bd7c57', hair: '#302722', personality: 'Investigativo e criterioso com fontes.', instruction: 'Analise evidências e referências autorizadas para tendências e concorrência. Indique o que falta confirmar.', tools: ['Evidências fornecidas', 'Pesquisa de oportunidades'] },
  { id: 'beatriz', name: 'Beatriz', role: 'Especialista em Produtos', group: 'Produtos', color: '#ba779c', skin: '#d89171', hair: '#593c57', personality: 'Criativa e pragmática.', instruction: 'Avalie novos produtos, complementos e kits usando catálogo, estoque e pesquisa registrada.', tools: ['Catálogo', 'Estoque', 'Descobertas'] },
  { id: 'gabriel', name: 'Gabriel', role: 'Estrategista Comercial', group: 'Comercial', color: '#a88651', skin: '#e8b593', hair: '#805334', personality: 'Experimental e orientado a resultado.', instruction: 'Planeje promoções, preços e lançamentos. Explicite metas, premissas e critérios de sucesso.', tools: ['Catálogo', 'Indicadores', 'Propostas'] },
  { id: 'mariana', name: 'Mariana', role: 'Atendimento', group: 'Atendimento', color: '#8676bc', skin: '#aa6c4b', hair: '#36293d', personality: 'Empática e objetiva.', instruction: 'Agrupe dúvidas fornecidas, prepare respostas para revisão e evite reproduzir dados pessoais.', tools: ['Dúvidas fornecidas', 'Rascunhos de atendimento'] },
  { id: 'eduardo', name: 'Eduardo', role: 'Diretor Financeiro', group: 'Financeiro', color: '#567d7a', skin: '#eac09f', hair: '#5b6464', personality: 'Conservador e preciso.', instruction: 'Use os cálculos fornecidos para explicar custos, taxas e margens. Sinalize custos ausentes.', tools: ['Custos', 'Taxas', 'Margens'] },
] as const

export type AgentId = typeof agents[number]['id']
export type Agent = typeof agents[number]
export type Role = 'owner' | 'operator' | 'reader'
export type Workflow = 'oportunidade' | 'diario' | 'atendimento'
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'blocked'

export const marketSegments = [
  { id: 'grafica', label: 'Gráfica, brindes personalizados e placas decorativas', profile: 'Linha atual. Considere materiais, técnicas de personalização, medidas e capacidade de expedição.' },
  { id: 'temperos', label: 'Temperos', profile: 'Linha atual. Compare peso, apresentação, validade e condições de fornecimento.' },
  { id: 'ferramentas', label: 'Ferramentas', profile: 'Linha em expansão, sem catálogo. Avalie peças de entrada, durabilidade, garantia e reposição.' },
  { id: 'baby', label: 'Baby', profile: 'Linha em expansão, sem catálogo. Destaque requisitos de segurança, certificação e adequação etária a verificar.' },
  { id: 'eletronicos', label: 'Eletrônicos', profile: 'Linha em expansão, sem catálogo. Verifique garantia, assistência, compatibilidade e homologações aplicáveis.' },
  { id: 'outros', label: 'Outras categorias', profile: 'Prospecção de uma categoria nova ou complementar.' },
] as const
export type MarketSegment = typeof marketSegments[number]['id']

const researchMarker = '\n\n--- Pesquisa pública ---\n'
export function marketBrief(brief: string, segment: MarketSegment, query: string) {
  return `${brief}${researchMarker}${segment}\n${query}`
}

export function splitMarketBrief(text: string) {
  const marker = text.lastIndexOf(researchMarker)
  if (marker < 0) return { brief: text, segment: undefined, query: '' }
  const [id, query = ''] = text.slice(marker + researchMarker.length).split('\n')
  const segment = marketSegments.find((entry) => entry.id === id)
  return segment ? { brief: text.slice(0, marker), segment, query } : { brief: text, segment: undefined, query: '' }
}

export const workflows: Record<Workflow, AgentId[][]> = {
  oportunidade: [['rafael'], ['beatriz'], ['eduardo'], ['gabriel'], ['vinni']],
  diario: [['ana', 'eduardo'], ['vinni']],
  atendimento: [['mariana'], ['vinni']],
}

export const workflowLabels: Record<Workflow, string> = {
  oportunidade: 'Pesquisa de oportunidade',
  diario: 'Análise operacional',
  atendimento: 'Análise de atendimento',
}

export interface Task {
  id: string
  agent: AgentId
  status: TaskStatus
  result: string | null
  error: string | null
  attempts: number
}

export interface Run {
  id: string
  workflow: Workflow
  brief: string
  created_at: string
  source: 'manual' | 'schedule'
  tasks: Task[]
}

export interface Product {
  sku: string
  name: string
  price: number
  cost: number | null
  fee: number | null
  stock: number
  units: number
  revenue: number
}

export interface Event {
  id: string
  event: string
  actor: string
  created_at: string
  details: Record<string, unknown>
}

export interface Usage {
  agent: AgentId
  task_id: string
  model: string
  input: number | null
  output: number | null
  cost: number
  status: 'reserved' | 'settled' | 'unknown'
  created_at: string
}

export interface Proposal {
  id: string
  sku: string
  price: number
  previous_price: number
  evidence: string
  author: string
  source_task_id: string | null
  recommended_by: AgentId | null
  decided_by: string | null
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'applied' | 'uncertain'
  created_at: string
}

export interface Snapshot {
  shop: { id: string; name: string; role: Role }
  local: boolean
  fixture: boolean
  provider: 'gemini' | 'local' | 'codex'
  shopee: {
    mode: 'disabled' | 'sandbox' | 'live'
    connected: boolean
    adsEnabled: boolean
    writes: boolean
    status: 'queued' | 'running' | 'failed' | 'done' | null
    updated: string | null
    error: string | null
    ads: { period: string; impressions: number; clicks: number; conversions: number; expense: number }[]
  }
  runs: Run[]
  products: Product[]
  audit: Event[]
  proposals: Proposal[]
  usage: Usage[]
  salesHistory: { period: string; revenue: number; units: number; skus: number }[]
  notifications: { id: string; kind: 'report' | 'stock' | 'sales'; title: string; body: string; created_at: string }[]
  members: { user_id: string; role: Role; self: boolean }[]
  settings: { daily: boolean; hour: number; dailyLimit: number; monthlyLimit: number; paused: AgentId[]; instructions: Partial<Record<AgentId, string>>; lastWorker: string | null }
}

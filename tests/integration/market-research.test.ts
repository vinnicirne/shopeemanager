import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agents, marketBrief, splitMarketBrief } from '../../packages/contracts/src/index'
import { marketResearch } from '../../server/market-research'
import type { Input } from '../../server/providers'

const brief = marketBrief('Valor interno da loja BRL 123456', 'grafica', 'Placas decorativas de MDF')
const input = (id: 'rafael' | 'beatriz', results: Input['results'] = []): Input => ({
  agent: agents.find((agent) => agent.id === id)!,
  instruction: 'texto interno', workflow: 'oportunidade', brief, results, products: [],
})
const identity = (value: string) => value

test('restringe pesquisa à categoria, consulta pública e achado estruturado', () => {
  assert.equal(splitMarketBrief(brief).segment?.id, 'grafica')
  assert.equal(splitMarketBrief('briefing anterior').brief, 'briefing anterior')
  const first = marketResearch(input('rafael'), identity)!
  assert.match(first.prompt, /Placas decorativas de MDF/)
  assert.doesNotMatch(first.prompt, /123456|texto interno/)
  assert.equal(marketResearch(input('beatriz'), identity), undefined)
  const result = first.format(JSON.stringify({ product: 'Placa MDF', specification: '20 × 10 cm', reason: 'Comparar demanda sazonal.', sources: [{ url: 'https://example.com/anuncio', evidence: 'Oferta sazonal' }, { url: 'https://example.org/vendas', evidence: 'Outra referência' }] }))
  const second = marketResearch(input('beatriz', [{ agent: 'rafael', result }]), identity)!
  assert.match(second.prompt, /20 × 10 cm/)
  assert.doesNotMatch(second.prompt, /123456|example.com/)
})

test('ordena preços comparáveis e mantém custos desconhecidos para cotação', () => {
  const research = marketResearch(input('beatriz', [{ agent: 'rafael', result: 'Produto: Placa MDF\nEspecificação: 20 × 10 cm' }]), identity)!
  const offer = { type: 'distribuidor', specification: '20 × 10 cm', dispatch: null, note: 'Valor por embalagem' }
  const result = research.format(JSON.stringify({ nextStep: 'Confirmar frete por região.', offers: [
    { ...offer, name: 'Fornecedor B', url: 'https://example.com/b', priceBRL: 30, unitsPerPack: 5, minimumPacks: null, freightBRL: null },
    { ...offer, name: 'Fornecedor A', url: 'https://example.com/a', priceBRL: 40, unitsPerPack: 10, minimumPacks: 2, freightBRL: 20 },
    { ...offer, name: 'Fornecedor C', url: 'https://example.com/c', priceBRL: null, unitsPerPack: null, minimumPacks: null, freightBRL: null },
    { ...offer, name: 'Fonte inválida', url: 'javascript:alert(1)', priceBRL: 1, unitsPerPack: 5, minimumPacks: null, freightBRL: null },
  ] }))
  assert.match(result, /1\. Fornecedor A/)
  assert.match(result, /2\. Fornecedor B/)
  assert.match(result, /3\. Fornecedor C/)
  assert.match(result, /Por unidade com frete no pedido mínimo: R\$\s*5,00/)
  assert.match(result, /Frete: a cotar/)
  assert.doesNotMatch(result, /Fonte inválida/)
})

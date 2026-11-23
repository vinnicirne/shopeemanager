import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agents } from '../../packages/contracts/src/index'
import { createProvider } from '../../server/providers'

test('Gemini recebe instruções do funcionário, contexto redigido e contabiliza tokens', async () => {
  const provider = createProvider({
    GEMINI_API_KEY: 'chave-do-teste',
    GEMINI_MODEL: 'gemini-example',
    GEMINI_INPUT_USD_PER_MILLION: '1',
    GEMINI_OUTPUT_USD_PER_MILLION: '3',
    GEMINI_RATE_DATE: '2026-11-22',
  }, async (url, init) => {
    assert.equal(String(url), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-example:generateContent')
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'chave-do-teste')
    const payload = JSON.parse(String(init?.body))
    assert.match(payload.systemInstruction.parts[0].text, /Mariana, Atendimento/)
    assert.match(payload.contents[0].parts[0].text, /e-mail removido/)
    assert.doesNotMatch(payload.contents[0].parts[0].text, /comprador@example\.test|Catálogo restrito/)
    return Response.json({
      candidates: [{ content: { parts: [{ thought: true, text: 'raciocínio interno' }, { text: 'Rascunho revisável.' }] } }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 350, thoughtsTokenCount: 150 },
    })
  })
  const agent = agents.find(({ id }) => id === 'mariana')!
  const result = await provider.run({ agent, instruction: agent.instruction, workflow: 'atendimento', brief: 'Dúvida recebida de comprador@example.test', results: [], products: [{ sku: '01', name: 'Catálogo restrito', price: 1, cost: null, fee: null, stock: 2, units: 0, revenue: 0 }] })
  assert.equal(result.result, 'Rascunho revisável.')
  assert.deepEqual([result.input, result.output, result.cost], [1000, 500, 0.0025])
})

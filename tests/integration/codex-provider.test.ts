import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readCodexOutput } from '../../server/codex-provider'
import { createProvider } from '../../server/providers'

const message = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Análise registrada.' } })
const usage = JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 250, output_tokens: 30, cached_input_tokens: 80 } })

test('valida resultado e tokens do Codex sem atribuir faturamento em USD', () => {
  assert.deepEqual(readCodexOutput(`${message}\n${usage}\n`), { result: 'Análise registrada.', input: 250, output: 30, cost: 0 })
  assert.equal(createProvider({ AI_PROVIDER: 'codex', CODEX_MODEL: 'test-model' }).model, 'Codex CLI · test-model')
  assert.equal(createProvider({ AI_PROVIDER: 'local', GEMINI_API_KEY: 'unused' }).kind, 'local')
})

test('descarta resultados incompletos, falhos ou acompanhados de ferramenta', () => {
  assert.throws(() => readCodexOutput(message), /consumo confirmados/)
  assert.throws(() => readCodexOutput(`${message}\n{"type":"turn.failed"}`), /reportou falha/)
  assert.throws(() => readCodexOutput(`{"type":"item.started","item":{"type":"command_execution"}}\n${message}\n${usage}`), /ferramenta não autorizado/)
})

test('exige busca concluída somente nas etapas de pesquisa web', () => {
  const search = '{"type":"item.completed","item":{"type":"web_search","query":"fornecedor Brasil"}}'
  assert.throws(() => readCodexOutput(`${message}\n${usage}`, true), /confirmar a pesquisa web/)
  assert.throws(() => readCodexOutput(`${search}\n${message}\n${usage}`), /ferramenta não autorizado/)
  assert.equal(readCodexOutput(`${search}\n${message}\n${usage}`, true).result, 'Análise registrada.')
})

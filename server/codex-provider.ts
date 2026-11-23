import { execFile } from 'node:child_process'
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

export const codexTimeoutMs = 110_000
export const codexResearchTimeoutMs = 180_000
const usageSchema = z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() })
const eventSchema = z.object({
  type: z.string(),
  item: z.object({ type: z.string(), text: z.string().optional() }).optional(),
  usage: usageSchema.optional(),
}).passthrough()
const allowedItemTypes = new Set(['agent_message', 'reasoning', 'plan', 'todo_list'])
const inheritedNames = new Set([
  'ALLUSERSPROFILE', 'APPDATA', 'CODEX_HOME', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'LOCALAPPDATA',
  'PATH', 'PATHEXT', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'SYSTEMDRIVE',
  'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'WINDIR',
])

export function readCodexOutput(stdout: string, web = false) {
  let result = ''
  let usage: z.infer<typeof usageSchema> | undefined
  let searches = 0
  for (const line of stdout.trim().split(/\r?\n/u)) {
    const event = eventSchema.parse(JSON.parse(line))
    if (event.type === 'turn.failed') throw new Error('O Codex reportou falha na tarefa.')
    if (event.item?.type === 'web_search' && web) {
      if (event.type === 'item.completed') searches++
    } else if (event.item && !allowedItemTypes.has(event.item.type)) {
      throw new Error('O Codex reportou uso de ferramenta não autorizado.')
    }
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') result = event.item.text?.trim() || result
    if (event.type === 'turn.completed') usage = event.usage
  }
  if (!result || !usage) throw new Error('O Codex terminou sem resultado e consumo confirmados.')
  if (web && !searches) throw new Error('O Codex terminou sem confirmar a pesquisa web.')
  return { result, input: usage.input_tokens, output: usage.output_tokens, cost: 0 }
}

export async function runCodex(prompt: string, env: NodeJS.ProcessEnv, model?: string, schema?: object) {
  const cwd = await mkdtemp(join(tmpdir(), 'shopee-manager-codex-'))
  const schemaPath = join(cwd, 'response.schema.json')
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => inheritedNames.has(key.toUpperCase())))
  const args = [
    'exec', '--json', '--color', 'never', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config',
    '--sandbox', 'read-only', '--disable', 'shell_tool', '--disable', 'shell_snapshot',
    '--disable', 'apps', '--disable', 'hooks', '--disable', 'view_image',
    '--disable', 'multi_agent', '--disable', 'multi_agent_v2',
    '-c', 'approval_policy="never"', '-c', schema ? 'web_search="live"' : 'web_search="disabled"', '-c', 'project_doc_max_bytes=0',
    '-c', 'model_reasoning_effort="low"',
    ...(schema ? ['--output-schema', schemaPath] : []),
    ...(model ? ['--model', model] : []), '-',
  ]
  try {
    if (schema) await writeFile(schemaPath, JSON.stringify(schema))
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(env.CODEX_BIN || 'codex', args, {
        cwd, env: childEnv, timeout: schema ? codexResearchTimeoutMs : codexTimeoutMs, maxBuffer: 1024 * 1024, windowsHide: true,
      }, (error, output) => {
        if (error) reject(new Error(error.code === 'ENOENT' ? 'Codex CLI não encontrado.' : 'Falha na execução do Codex CLI.'))
        else resolve(output)
      })
      child.stdin?.on('error', () => { /* O encerramento do processo é tratado pelo callback de execFile. */ })
      child.stdin?.end(prompt, 'utf8')
    })
    const output = readCodexOutput(stdout, Boolean(schema))
    return { ...output, result: schema ? output.result : output.result.slice(0, 8000) }
  } finally {
    if (schema) await unlink(schemaPath).catch(() => undefined)
    await rmdir(cwd).catch(() => undefined)
  }
}

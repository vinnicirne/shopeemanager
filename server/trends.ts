import { SaxesParser } from 'saxes'

export const trendsSource = 'https://trends.google.com/trending/rss?geo=BR'
export interface Trend { title: string; traffic: string; published: string; source: string }

export function parseTrends(xml: string): Trend[] {
  const parser = new SaxesParser({ xmlns: true })
  const result: Trend[] = []
  const stack: string[] = []
  let item: Trend | undefined
  parser.on('doctype', () => { throw new Error('DOCTYPE não permitido no feed') })
  parser.on('opentag', ({ local }) => {
    stack.push(local)
    if (local === 'item') item = { title: '', traffic: '', published: '', source: trendsSource }
  })
  function append(value: string) {
    if (!item || stack.at(-2) !== 'item') return
    switch (stack.at(-1)) {
      case 'title': item.title += value; break
      case 'approx_traffic': item.traffic += value; break
      case 'pubDate': item.published += value; break
    }
  }
  parser.on('text', append)
  parser.on('cdata', append)
  parser.on('closetag', ({ local }) => {
    if (local === 'item' && item?.title.trim()) {
      result.push({ ...item, title: item.title.trim().slice(0, 220), traffic: item.traffic.trim().slice(0, 24), published: item.published.trim().slice(0, 64) })
      item = undefined
    }
    stack.pop()
  })
  parser.write(xml).close()
  return result.slice(0, 200)
}

const words = (value: string) => value.normalize('NFD').replace(/\p{Mark}/gu, '').toLowerCase().match(/[a-z\d]{4,}/gu) || []
export async function researchTrends(brief: string, transport: typeof fetch = fetch): Promise<Trend[]> {
  const response = await transport(trendsSource, { redirect: 'error', signal: AbortSignal.timeout(4000) })
  if (!response.ok || !response.body) throw new Error('Feed de tendências indisponível')
  const reader = response.body.getReader()
  let size = 0
  const decoder = new TextDecoder()
  let body = ''
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > 1024 * 1024) {
      await reader.cancel()
      throw new Error('Feed maior que o limite de leitura')
    }
    body += decoder.decode(chunk.value, { stream: true })
  }
  body += decoder.decode()
  const seed = new Set(words(brief).filter((word) => !['dados', 'para', 'sobre', 'produto', 'produtos', 'pesquisar', 'pesquisa', 'avaliar', 'shopee'].includes(word)))
  return parseTrends(body).map((trend) => ({ trend, score: words(trend.title).filter((word) => seed.has(word)).length }))
    .filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map(({ trend }) => trend)
}

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseTrends, researchTrends, trendsSource } from '../../server/trends'

const fixture = `<?xml version="1.0"?>
<rss xmlns:ht="https://trends.google.com/trending/rss"><channel><title>Feed</title>
  <item><title>Organizador &amp; gavetas</title><ht:approx_traffic>500+</ht:approx_traffic><pubDate>21 Nov</pubDate></item>
  <item><title>Previsão do tempo</title></item>
</channel></rss>`

test('cruza buscas públicas localmente sem enviar o briefing à fonte', async () => {
  const found = await researchTrends('Avaliar organizador para gavetas', async (url) => {
    assert.equal(url, trendsSource)
    return new Response(fixture)
  })
  assert.deepEqual(found, [{ title: 'Organizador & gavetas', traffic: '500+', published: '21 Nov', source: trendsSource }])
  assert.throws(() => parseTrends('<!DOCTYPE rss><rss/>'), /DOCTYPE/)
})

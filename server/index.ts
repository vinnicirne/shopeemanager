import express from 'express'
import { resolve } from 'node:path'
import { app, config, db, provider, shopee } from './application.js'
import { tick } from './operations.js'

const dev = process.argv.includes('--vite')
if (dev) {
  const { createServer } = await import('vite')
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' })
  app.use(vite.middlewares)
} else {
  app.use(express.static(resolve('dist')))
  app.get(/.*/, (_req, res) => { res.sendFile(resolve('dist/index.html')) })
}

let worker: Promise<unknown> | undefined
const runWorker = () => {
  if (worker) return
  worker = tick(db, provider).catch((error: unknown) => {
    console.error('Worker indisponível', error instanceof Error ? error.name : 'unknown')
  }).finally(() => { worker = undefined })
}
const interval = setInterval(runWorker, Number(process.env.WORKER_INTERVAL_MS || 1200))
let shopeeWorker: Promise<void> | undefined
const shopeeService = shopee
const shopeeInterval = shopeeService ? setInterval(() => {
  if (shopeeWorker) return
  shopeeWorker = shopeeService.tick().catch((error: unknown) => {
    console.error('Worker Shopee indisponível', error instanceof Error ? error.name : 'unknown')
  }).finally(() => { shopeeWorker = undefined })
}, 5000) : undefined
const server = app.listen(config.port, config.host, () => { console.log(`Shopee Manager IA em http://${config.host}:${config.port}`) })
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  clearInterval(interval)
  clearInterval(shopeeInterval)
  server.close(async () => { await Promise.allSettled([worker, shopeeWorker]); await db.close(); process.exit(0) })
})

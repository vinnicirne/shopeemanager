import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'

export interface DatabaseQuery {
  query<T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}
export interface Database extends DatabaseQuery {
  transaction<T>(fn: (tx: DatabaseQuery) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export async function openDatabase(url?: string, path?: string, ca?: string): Promise<Database> {
  if (url) {
    const connection = new URL(url)
    if (ca) {
      for (const parameter of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert']) connection.searchParams.delete(parameter)
    }
    const pool = new pg.Pool({
      connectionString: connection.href,
      ssl: ca ? { ca, rejectUnauthorized: true } : undefined,
      max: 6,
      connectionTimeoutMillis: 8_000,
    })
    pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number)
    return {
      query: <T extends pg.QueryResultRow>(sql: string, params?: unknown[]) => pool.query<T>(sql, params),
      async transaction(fn) {
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          const result = await fn({ query: <T extends pg.QueryResultRow>(sql: string, params?: unknown[]) => client.query<T>(sql, params) })
          await client.query('COMMIT')
          return result
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally {
          client.release()
        }
      },
      close: () => pool.end(),
    }
  }
  const engine = await PGlite.create({ dataDir: path })
  const migrations = new URL('../supabase/migrations/', import.meta.url)
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort()) {
    await engine.exec(await readFile(new URL(file, migrations), 'utf8'))
  }
  return {
    query: (sql, params) => engine.query(sql, params),
    transaction: (fn) => engine.transaction(fn),
    close: () => engine.close(),
  }
}

export function forShop(db: Database, shop: string): Database {
  const transaction = <T>(fn: (tx: DatabaseQuery) => Promise<T>) => db.transaction(async (tx) => {
    await tx.query('SET LOCAL ROLE manager_app')
    await tx.query("SELECT set_config('manager.shop_id',$1,true)", [shop])
    return fn(tx)
  })
  return {
    query: (sql, params) => transaction((tx) => tx.query(sql, params)),
    transaction,
    close: () => Promise.resolve(),
  }
}

export async function record(db: DatabaseQuery, shop: string, event: string, actor: string, details: Record<string, unknown>) {
  await db.query('INSERT INTO manager.audit (shop_id,event,actor,details) VALUES ($1,$2,$3,$4)', [shop, event, actor, JSON.stringify(details)])
}

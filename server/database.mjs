import postgres from 'postgres';
import { fail } from './errors.mjs';

class Records {
  constructor(query, owner) { this.query = query; this.owner = owner; }
  async all() {
    return this.query('SELECT kind, id, data FROM essay_studio.records WHERE owner=$1 ORDER BY kind,id', [this.owner]);
  }
  async get(kind, id, required = true) {
    const rows = await this.query('SELECT data FROM essay_studio.records WHERE owner=$1 AND kind=$2 AND id=$3', [this.owner, kind, id]);
    if (!rows.length && required) throw fail('Not found.', 404);
    if (rows.length && (typeof rows[0].data !== 'object' || rows[0].data === null)) throw fail('Stored workspace record has an invalid format.', 500);
    return rows[0]?.data ?? null;
  }
  async list(kind) {
    const rows = await this.query('SELECT id, data FROM essay_studio.records WHERE owner=$1 AND kind=$2 ORDER BY created_at, id', [this.owner, kind]);
    return rows.map(row => ({ ...row.data, id: row.id }));
  }
  async put(kind, id, data) {
    await this.query('INSERT INTO essay_studio.records(owner,kind,id,data) VALUES($1,$2,$3,$4::text::jsonb) ON CONFLICT(owner,kind,id) DO UPDATE SET data=excluded.data', [this.owner, kind, id, JSON.stringify(data)]);
    return data;
  }
  async insert(kind, id, data) {
    await this.query('INSERT INTO essay_studio.records(owner,kind,id,data) VALUES($1,$2,$3,$4::text::jsonb)', [this.owner, kind, id, JSON.stringify(data)]);
    return data;
  }
}

// Serialize mutations per owner inside Postgres, across all Lambda instances.
// The browser and OAuth clients have no grants on this private schema.
export function postgresDatabase(url) {
  const sql = postgres(url, { max: 2, prepare: false, ssl: 'require', idle_timeout: 20, connect_timeout: 10 });
  return {
    transaction: (owner, callback) => sql.begin(async tx => {
      await tx`SELECT set_config('essay_studio.owner', ${owner}, true)`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`essay-studio:${owner}`}, 0))`;
      return callback(new Records((query, values) => tx.unsafe(query, values), owner));
    }),
    close: () => sql.end(),
  };
}

export function pgliteDatabase(pg) {
  return {
    transaction: (owner, callback) => pg.transaction(async tx => {
      await tx.query("SELECT set_config('essay_studio.owner', $1, true)", [owner]);
      return callback(new Records(async (query, values) => (await tx.query(query, values)).rows, owner));
    }),
    close: () => pg.close(),
  };
}

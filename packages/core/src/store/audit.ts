import type { Queryable } from '../db/pool.js';
import type { AuditEntry } from '../schema/index.js';

type AuditRow = {
  id: string;
  at: Date;
  action: string;
  target_kind: string;
  target_id: string;
  source: string | null;
  detail: Record<string, unknown>;
};

const COLUMNS = 'id, at, action, target_kind, target_id, source, detail';

function mapAudit(r: AuditRow): AuditEntry {
  return {
    id: r.id,
    at: r.at,
    action: r.action,
    targetKind: r.target_kind,
    targetId: r.target_id,
    source: r.source,
    detail: r.detail,
  };
}

export interface AppendAuditParams {
  action: string;
  targetKind: string;
  targetId: string;
  source?: string | null;
  detail?: Record<string, unknown>;
}

/** Append one append-only audit record. */
export async function appendAudit(q: Queryable, params: AppendAuditParams): Promise<void> {
  await q.query(
    `INSERT INTO audit_log (action, target_kind, target_id, source, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [params.action, params.targetKind, params.targetId, params.source ?? null, params.detail ?? {}],
  );
}

export interface ListAuditOptions {
  action?: string;
  targetKind?: string;
  targetId?: string;
  limit?: number;
}

export async function listAudit(q: Queryable, opts: ListAuditOptions = {}): Promise<AuditEntry[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (opts.action !== undefined) {
    values.push(opts.action);
    conditions.push(`action = $${values.length}`);
  }
  if (opts.targetKind !== undefined) {
    values.push(opts.targetKind);
    conditions.push(`target_kind = $${values.length}`);
  }
  if (opts.targetId !== undefined) {
    values.push(opts.targetId);
    conditions.push(`target_id = $${values.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  values.push(limit);
  const limitParam = `$${values.length}`;
  const res = await q.query<AuditRow>(
    `SELECT ${COLUMNS} FROM audit_log ${where} ORDER BY id DESC LIMIT ${limitParam}`,
    values,
  );
  return res.rows.map(mapAudit);
}

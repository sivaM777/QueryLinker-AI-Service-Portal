import crypto from "crypto";
import { pool } from "../../config/db.js";

type RootCauseTicketRow = {
  id: string;
  category: string | null;
  integration_metadata: any;
};

export type RootCauseCluster = {
  cluster_id: string;
  label: string;
  category: string;
  ticket_count: number;
  example_ticket_ids: string[];
};

function computeClusterId(category: string, keywords: string[]): string {
  const base = `${category}|${keywords.slice(0, 4).join(",")}`;
  return crypto.createHash("sha256").update(base).digest("hex").slice(0, 16);
}

function labelFrom(category: string, keywords: string[]): string {
  const top = keywords.slice(0, 3).join(", ");
  return top ? `${category}: ${top}` : category;
}

export async function computeRootCauseClusters(): Promise<void> {
  // Consider recent tickets (7d) that are still active
  const res = await pool.query<RootCauseTicketRow>(
    `SELECT id, category, integration_metadata
     FROM tickets
     WHERE created_at >= now() - interval '7 days'
       AND status IN ('OPEN','IN_PROGRESS','WAITING_FOR_CUSTOMER')`
  );

  for (const t of res.rows) {
    const category = t.category || "Uncategorized";
    const ai = t.integration_metadata?.ai || {};
    const kws = Array.isArray(ai.keywords) ? ai.keywords.filter((x: any) => typeof x === "string") : [];
    const keywords = kws.map((k: string) => k.toLowerCase()).slice(0, 6);

    const clusterId = computeClusterId(category, keywords);

    await pool.query(
      `UPDATE tickets
       SET integration_metadata = jsonb_set(
         COALESCE(integration_metadata, '{}'::jsonb),
         '{ai,root_cause_cluster_id}',
         to_jsonb($2::text),
         true
       )
       WHERE id = $1`,
      [t.id, clusterId]
    );

    await pool.query(
      `UPDATE tickets
       SET integration_metadata = jsonb_set(
         COALESCE(integration_metadata, '{}'::jsonb),
         '{ai,root_cause_cluster_label}',
         to_jsonb($2::text),
         true
       )
       WHERE id = $1`,
      [t.id, labelFrom(category, keywords)]
    );
  }
}

export async function getRootCauseClusters(organizationId?: string | null): Promise<RootCauseCluster[]> {
  const params = organizationId ? [organizationId] : [];
  const res = await pool.query<{
    cluster_id: string;
    label: string;
    category: string;
    ticket_count: string;
    example_ticket_ids: string[];
  }>(
    `SELECT
       (t.integration_metadata -> 'ai' ->> 'root_cause_cluster_id')::text AS cluster_id,
       (t.integration_metadata -> 'ai' ->> 'root_cause_cluster_label')::text AS label,
       COALESCE(t.category, 'Uncategorized') AS category,
       COUNT(*)::text AS ticket_count,
       ARRAY_AGG(t.id ORDER BY t.created_at DESC)[:5] AS example_ticket_ids
     FROM tickets t
     WHERE t.status IN ('OPEN','IN_PROGRESS','WAITING_FOR_CUSTOMER')
       AND (t.integration_metadata -> 'ai' ->> 'root_cause_cluster_id') IS NOT NULL
       ${organizationId ? "AND t.organization_id = $1" : ""}
     GROUP BY 1,2,3
     ORDER BY COUNT(*) DESC
     LIMIT 20`,
    params
  );

  return res.rows.map((r) => ({
    cluster_id: r.cluster_id,
    label: r.label || r.category,
    category: r.category,
    ticket_count: Number(r.ticket_count),
    example_ticket_ids: r.example_ticket_ids || [],
  }));
}

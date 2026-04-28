import { pool } from "../../config/db.js";

export type TicketTagRow = {
  id: string;
  name: string;
  normalized_name: string;
  color: string | null;
};

const normalizeTagName = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);

const normalizeTagKey = (value: string) => normalizeTagName(value).toLowerCase();

const pickColorForTag = (value: string) => {
  const palette = ["#2563eb", "#0f766e", "#ea580c", "#7c3aed", "#be185d", "#0891b2", "#4f46e5", "#059669"];
  const key = normalizeTagKey(value);
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length];
};

const readTicketTags = async (ticketId: string): Promise<TicketTagRow[]> => {
  const result = await pool.query<TicketTagRow>(
    `SELECT tt.id, tt.name, tt.normalized_name, tt.color
     FROM ticket_tag_links ttl
     JOIN ticket_tags tt ON tt.id = ttl.tag_id
     WHERE ttl.ticket_id = $1
     ORDER BY tt.name ASC`,
    [ticketId]
  );
  return result.rows;
};

export const getTicketTags = async (ticketId: string): Promise<TicketTagRow[]> => readTicketTags(ticketId);

export const setTicketTags = async (args: {
  ticketId: string;
  organizationId?: string | null;
  tagNames: string[];
  createdBy?: string | null;
}): Promise<TicketTagRow[]> => {
  const cleaned = Array.from(
    new Set(
      (args.tagNames || [])
        .map(normalizeTagName)
        .filter((value) => value.length > 0)
        .slice(0, 20)
    )
  );

  const normalized = cleaned.map((name) => normalizeTagKey(name));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = normalized.length
      ? await client.query<TicketTagRow>(
          `SELECT id, name, normalized_name, color
           FROM ticket_tags
           WHERE (organization_id IS NOT DISTINCT FROM $1)
             AND normalized_name = ANY($2::text[])`,
          [args.organizationId ?? null, normalized]
        )
      : { rows: [] as TicketTagRow[] };

    const byNormalized = new Map(existing.rows.map((row) => [row.normalized_name, row]));
    const tagIds: string[] = [];

    for (const name of cleaned) {
      const normalizedName = normalizeTagKey(name);
      let row = byNormalized.get(normalizedName) ?? null;
      if (!row) {
        const inserted = await client.query<TicketTagRow>(
          `INSERT INTO ticket_tags (organization_id, created_by, name, normalized_name, color)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_name)
           DO UPDATE SET name = EXCLUDED.name
           RETURNING id, name, normalized_name, color`,
          [
            args.organizationId ?? null,
            args.createdBy ?? null,
            name,
            normalizedName,
            pickColorForTag(name),
          ]
        );
        row = inserted.rows[0] ?? null;
        if (row) {
          byNormalized.set(normalizedName, row);
        }
      }
      if (row) {
        tagIds.push(row.id);
      }
    }

    if (tagIds.length > 0) {
      await client.query(
        `DELETE FROM ticket_tag_links
         WHERE ticket_id = $1
           AND tag_id <> ALL($2::uuid[])`,
        [args.ticketId, tagIds]
      );

      for (const tagId of tagIds) {
        await client.query(
          `INSERT INTO ticket_tag_links (ticket_id, tag_id)
           VALUES ($1, $2)
           ON CONFLICT (ticket_id, tag_id) DO NOTHING`,
          [args.ticketId, tagId]
        );
      }
    } else {
      await client.query(`DELETE FROM ticket_tag_links WHERE ticket_id = $1`, [args.ticketId]);
    }

    await client.query("COMMIT");
    return await readTicketTags(args.ticketId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

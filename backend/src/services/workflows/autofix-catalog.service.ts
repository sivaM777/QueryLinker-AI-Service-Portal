import { pool } from "../../config/db.js";
import { Workflow, WorkflowStep } from "./auto-resolution.service.js";

export type TicketPriority = "LOW" | "MEDIUM" | "HIGH";
export type AutofixMode = "AUTOMATION" | "GUIDED";
export type AutofixRisk = "LOW" | "MEDIUM" | "HIGH";

export type AutofixCatalogRow = {
  id: string;
  code: string;
  enabled: boolean;
  mode: AutofixMode;
  risk: AutofixRisk;
  match_intents: string[] | null;
  match_categories: string[] | null;
  match_keywords: string[] | null;
  min_confidence: number | null;
  eligible_priorities: string[];
  approval_required: boolean;
  approval_title: string;
  approval_body: string;
  user_title: string;
  user_description: string;
  workflow_steps: WorkflowStep[];
};

function normalizeUpper(s: string | null | undefined): string {
  return String(s || "").trim().toUpperCase();
}

function includesAny(haystack: string, needles: string[]): boolean {
  const h = haystack.toUpperCase();
  return needles.some((n) => h.includes(n.toUpperCase()));
}

function allKeywordsPresent(haystack: string, keywords: string[]): boolean {
  const h = haystack.toUpperCase();
  return keywords.every((k) => h.includes(k.toUpperCase()));
}

function stringToUUID(str: string): string {
  const hex = Buffer.from(str).toString("hex").padEnd(32, "0").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function ensureWorkflowForAutofix(args: {
  code: string;
  title: string;
  steps: WorkflowStep[];
  autoResolve: boolean;
}): Promise<Workflow> {
  const id = stringToUUID(`autofix_${args.code}`);

  await pool.query(
    `INSERT INTO workflows (id, name, description, enabled, priority, auto_resolve, create_ticket, steps)
     VALUES ($1, $2, $3, true, 200, $4, false, $5)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       enabled = true,
       priority = 200,
       auto_resolve = EXCLUDED.auto_resolve,
       steps = EXCLUDED.steps`,
    [
      id,
      args.title,
      `Auto-fix workflow for ${args.code}`,
      args.autoResolve,
      JSON.stringify(args.steps),
    ]
  );

  return {
    id,
    name: args.title,
    enabled: true,
    priority: 200,
    intent_filter: null,
    category_filter: null,
    keyword_filter: null,
    steps: args.steps,
    auto_resolve: args.autoResolve,
    create_ticket: false,
  };
}

export async function findBestAutofixPlaybook(args: {
  intent?: string;
  category?: string | null;
  keywords?: string[];
  confidence?: number | null;
  priority: TicketPriority;
  text: string;
}): Promise<AutofixCatalogRow | null> {
  const res = await pool.query<AutofixCatalogRow>(
    `SELECT
       id,
       code,
       enabled,
       mode,
       risk,
       match_intents,
       match_categories,
       match_keywords,
       min_confidence,
       eligible_priorities,
       approval_required,
       approval_title,
       approval_body,
       user_title,
       user_description,
       workflow_steps
     FROM autofix_catalog
     WHERE enabled = true`,
    []
  );

  const intentUpper = normalizeUpper(args.intent);
  const catUpper = normalizeUpper(args.category);
  const confidence = typeof args.confidence === "number" ? args.confidence : null;
  const textUpper = (args.text || "").toUpperCase();

  const candidates = res.rows.filter((row) => {
    if (!row.enabled) return false;

    if (Array.isArray(row.eligible_priorities) && row.eligible_priorities.length > 0) {
      if (!row.eligible_priorities.map(normalizeUpper).includes(args.priority)) return false;
    }

    if (typeof row.min_confidence === "number" && row.min_confidence !== null) {
      if (confidence === null || confidence < row.min_confidence) return false;
    }

    if (row.match_intents && row.match_intents.length > 0) {
      const ok = row.match_intents.map(normalizeUpper).includes(intentUpper);
      if (!ok) return false;
    }

    if (row.match_categories && row.match_categories.length > 0) {
      const ok = row.match_categories.map(normalizeUpper).includes(catUpper);
      if (!ok) return false;
    }

    if (row.match_keywords && row.match_keywords.length > 0) {
      if (!allKeywordsPresent(textUpper, row.match_keywords)) return false;
    }

    return true;
  });

  if (candidates.length === 0) return null;

  // Score: prefer higher min_confidence, more match conditions
  const scored = candidates
    .map((row) => {
      const specificity =
        (row.match_intents?.length ? 1 : 0) +
        (row.match_categories?.length ? 1 : 0) +
        (row.match_keywords?.length ? 1 : 0);
      const conf = typeof row.min_confidence === "number" ? row.min_confidence : 0;
      return { row, score: specificity * 10 + conf };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0].row;
}

export function isGuidedEligibleRule2(args: {
  ticketPriority: TicketPriority;
  playbookRisk: AutofixRisk;
}): boolean {
  if (args.ticketPriority === "HIGH") return false;
  if (args.playbookRisk === "HIGH") return false;
  return true;
}

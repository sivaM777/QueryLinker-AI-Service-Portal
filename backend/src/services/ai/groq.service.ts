import { z } from "zod";
import { env } from "../../config/env.js";

export type GroqMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export interface ExtractedTicketPayload {
  title: string;
  description: string;
  category?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH" | null;
  type?: "INCIDENT" | "SERVICE_REQUEST" | "CHANGE" | "PROBLEM" | null;
  urgency_reason?: string | null;
  model?: string | null;
  used_fallback?: boolean;
}

export interface GroqRoutingEnrichment {
  category?: string | null;
  intent?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH" | null;
  confidence?: number | null;
  keywords?: string[];
  summary?: string | null;
  entities?: Record<string, any> | null;
  sentiment_label?: "NEGATIVE" | "NEUTRAL" | "POSITIVE" | null;
  sentiment_score?: number | null;
  routing_action?: "KEEP" | "ASSIGN" | "REASSIGN" | "MANUAL_REVIEW" | null;
  change_summary?: string | null;
  issue_signature?: string | null;
  model?: string | null;
  used_fallback?: boolean;
}

export interface TicketReadinessAssessment {
  ready: boolean;
  missing_fields: string[];
  guidance: string;
}

type GroqStructuredResult<T> = {
  parsed: T;
  model: string;
  usedFallback: boolean;
};

type RoutingEnrichmentArgs = {
  text: string;
  currentCategory?: string | null;
  currentPriority?: "LOW" | "MEDIUM" | "HIGH" | null;
  mode?: "create" | "refresh";
  latestUpdate?: string | null;
};

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_EXTRACTION_MODEL = "openai/gpt-oss-120b";
const DEFAULT_EXTRACTION_FALLBACK_MODEL = "llama-3.3-70b-versatile";

const ROUTING_CATEGORIES = [
  "IDENTITY_ACCESS",
  "NETWORK_VPN_WIFI",
  "EMAIL_COLLAB",
  "ENDPOINT_DEVICE",
  "HARDWARE_PERIPHERAL",
  "SOFTWARE_INSTALL_LICENSE",
  "BUSINESS_APP_ERP_CRM",
  "SECURITY_INCIDENT",
  "KB_GENERAL",
  "OTHER",
] as const;

const ROUTING_INTENTS = [
  "INCIDENT",
  "SERVICE_REQUEST",
  "CHANGE",
  "PROBLEM",
  "HOW_TO",
  "SECURITY_REPORT",
  "PASSWORD_RESET",
  "ACCOUNT_UNLOCK",
  "UNKNOWN",
] as const;

const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
const TICKET_TYPES = ["INCIDENT", "SERVICE_REQUEST", "CHANGE", "PROBLEM"] as const;
const SENTIMENT_LABELS = ["NEGATIVE", "NEUTRAL", "POSITIVE"] as const;
const ROUTING_ACTIONS = ["KEEP", "ASSIGN", "REASSIGN", "MANUAL_REVIEW"] as const;

const normalizedString = () =>
  z
    .string()
    .trim()
    .transform((value) => value || null)
    .nullable()
    .optional();

const extractedTicketSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(4000),
  category: normalizedString(),
  priority: normalizedString(),
  type: normalizedString(),
  urgency_reason: normalizedString(),
});

const routingSchema = z.object({
  category: normalizedString(),
  intent: normalizedString(),
  priority: normalizedString(),
  confidence: z.coerce.number().min(0).max(1).nullable().optional(),
  keywords: z.array(z.string().trim()).max(20).optional().default([]),
  summary: normalizedString(),
  entities: z.record(z.any()).optional().default({}),
  sentiment_label: normalizedString(),
  sentiment_score: z.coerce.number().min(-1).max(1).nullable().optional(),
  routing_action: normalizedString(),
  change_summary: normalizedString(),
  issue_signature: normalizedString(),
});

export function isGroqConfigured(): boolean {
  return Boolean(env.GROQ_API_KEY);
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

export function getGroqExtractionModels(): string[] {
  return uniqueNonEmpty([
    env.GROQ_EXTRACTION_MODEL || DEFAULT_EXTRACTION_MODEL,
    env.GROQ_EXTRACTION_FALLBACK_MODEL || DEFAULT_EXTRACTION_FALLBACK_MODEL,
  ]);
}

async function groqChatCompletion(args: {
  model: string;
  messages: GroqMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: "json_object" };
}): Promise<string> {
  if (!env.GROQ_API_KEY) {
    throw new Error("Groq API key is not configured");
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      temperature: args.temperature ?? 0.2,
      max_tokens: args.maxTokens ?? 700,
      response_format: args.responseFormat,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Groq API error ${response.status}: ${body || response.statusText}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "";
}

export async function generateGroqRoleBasedChat(args: {
  messages: GroqMessage[];
}): Promise<string> {
  return groqChatCompletion({
    model: env.GROQ_CHAT_MODEL || "llama-3.1-8b-instant",
    messages: args.messages,
    temperature: 0.45,
    maxTokens: 700,
  });
}

function tryParseJsonObject(text: string): any | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeEnumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  aliases: Record<string, T[number]> = {}
): T[number] | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!raw) return null;

  if (aliases[raw]) return aliases[raw];
  return (allowed as readonly string[]).includes(raw) ? (raw as T[number]) : null;
}

const categoryAliases: Record<string, (typeof ROUTING_CATEGORIES)[number]> = {
  ACCESS_AUTHENTICATION: "IDENTITY_ACCESS",
  ACCESS_AUTH: "IDENTITY_ACCESS",
  ACCESS_MANAGEMENT: "IDENTITY_ACCESS",
  PASSWORD: "IDENTITY_ACCESS",
  ACCOUNT: "IDENTITY_ACCESS",
  VPN: "NETWORK_VPN_WIFI",
  NETWORK: "NETWORK_VPN_WIFI",
  WIFI: "NETWORK_VPN_WIFI",
  EMAIL: "EMAIL_COLLAB",
  OUTLOOK: "EMAIL_COLLAB",
  COLLABORATION: "EMAIL_COLLAB",
  DEVICE: "ENDPOINT_DEVICE",
  ENDPOINT: "ENDPOINT_DEVICE",
  LAPTOP: "ENDPOINT_DEVICE",
  DESKTOP: "ENDPOINT_DEVICE",
  PRINTER: "HARDWARE_PERIPHERAL",
  HARDWARE: "HARDWARE_PERIPHERAL",
  SOFTWARE: "SOFTWARE_INSTALL_LICENSE",
  LICENSE: "SOFTWARE_INSTALL_LICENSE",
  BUSINESS_APP: "BUSINESS_APP_ERP_CRM",
  ERP_CRM: "BUSINESS_APP_ERP_CRM",
  SECURITY: "SECURITY_INCIDENT",
  KNOWLEDGE_BASE: "KB_GENERAL",
  GENERAL: "KB_GENERAL",
};

const intentAliases: Record<string, (typeof ROUTING_INTENTS)[number]> = {
  SERVICE: "SERVICE_REQUEST",
  SERVICEREQUEST: "SERVICE_REQUEST",
  SECURITY_INCIDENT: "SECURITY_REPORT",
  PASSWORD: "PASSWORD_RESET",
  PASSWORD_ISSUE: "PASSWORD_RESET",
  UNLOCK: "ACCOUNT_UNLOCK",
  ACCOUNT_LOCKED: "ACCOUNT_UNLOCK",
};

function normalizeExtractedTicket(
  payload: any,
  fallbackTitle: string,
  fallbackDescription: string,
  model: string,
  usedFallback: boolean
): ExtractedTicketPayload {
  const parsed = extractedTicketSchema.parse(payload);
  return {
    title: parsed.title || fallbackTitle,
    description: parsed.description || fallbackDescription,
    category: normalizeEnumValue(parsed.category, ROUTING_CATEGORIES, categoryAliases),
    priority: normalizeEnumValue(parsed.priority, PRIORITIES),
    type: normalizeEnumValue(parsed.type, TICKET_TYPES),
    urgency_reason: parsed.urgency_reason,
    model,
    used_fallback: usedFallback,
  };
}

function normalizeRoutingEnrichment(
  payload: any,
  model: string,
  usedFallback: boolean
): GroqRoutingEnrichment {
  const parsed = routingSchema.parse(payload);
  return {
    category: normalizeEnumValue(parsed.category, ROUTING_CATEGORIES, categoryAliases),
    intent: normalizeEnumValue(parsed.intent, ROUTING_INTENTS, intentAliases),
    priority: normalizeEnumValue(parsed.priority, PRIORITIES),
    confidence: typeof parsed.confidence === "number" ? Number(parsed.confidence.toFixed(3)) : null,
    keywords: parsed.keywords
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 12),
    summary: parsed.summary,
    entities: parsed.entities ?? {},
    sentiment_label: normalizeEnumValue(parsed.sentiment_label, SENTIMENT_LABELS),
    sentiment_score: typeof parsed.sentiment_score === "number" ? Number(parsed.sentiment_score.toFixed(3)) : null,
    routing_action: normalizeEnumValue(parsed.routing_action, ROUTING_ACTIONS),
    change_summary: parsed.change_summary,
    issue_signature: parsed.issue_signature,
    model,
    used_fallback: usedFallback,
  };
}

async function runStructuredGroqWithFallback<T>(args: {
  models: string[];
  messages: GroqMessage[];
  maxTokens: number;
  validate: (payload: any, model: string, usedFallback: boolean) => T;
}): Promise<GroqStructuredResult<T>> {
  const failures: string[] = [];

  for (const [index, model] of args.models.entries()) {
    try {
      const content = await groqChatCompletion({
        model,
        messages: args.messages,
        temperature: 0.1,
        maxTokens: args.maxTokens,
        responseFormat: { type: "json_object" },
      });

      const parsed = tryParseJsonObject(content);
      if (!parsed) {
        throw new Error("Model did not return a valid JSON object");
      }

      return {
        parsed: args.validate(parsed, model, index > 0),
        model,
        usedFallback: index > 0,
      };
    } catch (error) {
      failures.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`All Groq extraction models failed. ${failures.join(" | ")}`);
}

export async function extractTicketFromConversation(args: {
  transcript: string;
  fallbackTitle: string;
  fallbackDescription: string;
}): Promise<ExtractedTicketPayload | null> {
  if (!env.GROQ_API_KEY) {
    return null;
  }

  const models = getGroqExtractionModels();

  const structured = await runStructuredGroqWithFallback({
    models,
    maxTokens: 900,
    messages: [
      {
        role: "system",
        content:
          "You extract a clean IT helpdesk ticket from a chat transcript. " +
          "Return only JSON using this schema: " +
          "{title:string, description:string, category:string|null, priority:'LOW'|'MEDIUM'|'HIGH'|null, " +
          "type:'INCIDENT'|'SERVICE_REQUEST'|'CHANGE'|'PROBLEM'|null, urgency_reason:string|null}. " +
          `Allowed category values: ${ROUTING_CATEGORIES.join(", ")}. ` +
          "Keep the title concise and professional. Expand the description into a support-ready summary.",
      },
      {
        role: "user",
        content: `Fallback title: ${args.fallbackTitle}
Fallback description: ${args.fallbackDescription}

Chat transcript:
${args.transcript}`,
      },
    ],
    validate: (payload, model, usedFallback) =>
      normalizeExtractedTicket(payload, args.fallbackTitle, args.fallbackDescription, model, usedFallback),
  });

  return structured.parsed;
}

export async function enrichTicketForRouting(
  args: string | RoutingEnrichmentArgs
): Promise<GroqRoutingEnrichment | null> {
  if (!env.GROQ_API_KEY) {
    return null;
  }

  const request =
    typeof args === "string"
      ? { text: args, mode: "create" as const }
      : { ...args, mode: args.mode || "create" };

  const models = getGroqExtractionModels();

  const structured = await runStructuredGroqWithFallback({
    models,
    maxTokens: 950,
    messages: [
      {
        role: "system",
        content:
          "You are an enterprise ITSM triage engine for ticket creation and routing. " +
          "Return only JSON using this exact schema: " +
          "{category:string|null,intent:string|null,priority:'LOW'|'MEDIUM'|'HIGH'|null,confidence:number|null," +
          "keywords:string[],summary:string|null,entities:object,sentiment_label:'NEGATIVE'|'NEUTRAL'|'POSITIVE'|null," +
          "sentiment_score:number|null,routing_action:'KEEP'|'ASSIGN'|'REASSIGN'|'MANUAL_REVIEW'|null," +
          "change_summary:string|null,issue_signature:string|null}. " +
          `Allowed category values: ${ROUTING_CATEGORIES.join(", ")}. ` +
          `Allowed intent values: ${ROUTING_INTENTS.join(", ")}. ` +
          "Confidence must be between 0 and 1. " +
          "For refreshes, keep the existing category and priority stable unless the new evidence strongly contradicts them. " +
          "Treat clarifications, logs, and added symptoms as the same issue unless the root cause or owning team has materially changed. " +
          "Use REASSIGN only when the core issue has genuinely shifted to a different domain or team. " +
          "Use MANUAL_REVIEW when the issue is ambiguous or confidence should remain low.",
      },
      {
        role: "user",
        content: `Mode: ${request.mode}
Current category: ${request.currentCategory || "UNSET"}
Current priority: ${request.currentPriority || "UNSET"}
Latest update: ${request.latestUpdate || "NONE"}

Ticket text:
${request.text}`,
      },
    ],
    validate: (payload, model, usedFallback) => normalizeRoutingEnrichment(payload, model, usedFallback),
  });

  return structured.parsed;
}

export async function assessTicketReadiness(args: {
  transcript: string;
  latestMessage: string;
}): Promise<TicketReadinessAssessment | null> {
  if (!env.GROQ_API_KEY) {
    return null;
  }

  const content = await groqChatCompletion({
    model: env.GROQ_CHAT_MODEL || "llama-3.1-8b-instant",
    temperature: 0.1,
    maxTokens: 500,
    responseFormat: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an IT helpdesk intake assistant. Return only a JSON object with keys: ready, missing_fields, guidance. " +
          "A ticket is ready only if the conversation contains enough detail for an IT agent to work: issue/problem, impact or symptom, and at least one of urgency, device/system, error message, or location. " +
          "missing_fields must be an array using simple labels like issue, impact, urgency, device, location, error_message. " +
          "guidance must be one short sentence telling the user what is still needed.",
      },
      {
        role: "user",
        content: `Latest user message:\n${args.latestMessage}\n\nConversation transcript:\n${args.transcript}`,
      },
    ],
  });

  const parsed = tryParseJsonObject(content);
  if (!parsed || typeof parsed !== "object") return null;

  return {
    ready: Boolean(parsed.ready),
    missing_fields: Array.isArray(parsed.missing_fields)
      ? parsed.missing_fields.filter((value: unknown): value is string => typeof value === "string").slice(0, 6)
      : [],
    guidance:
      typeof parsed.guidance === "string" && parsed.guidance.trim()
        ? parsed.guidance.trim()
        : "Please share a few more details before I create the ticket.",
  };
}

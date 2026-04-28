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
}

export interface TicketReadinessAssessment {
  ready: boolean;
  missing_fields: string[];
  guidance: string;
}

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export function isGroqConfigured(): boolean {
  return Boolean(env.GROQ_API_KEY);
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
      temperature: args.temperature ?? 0.4,
      max_tokens: args.maxTokens ?? 500,
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
    // Try to recover from extra text around the JSON object
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeExtractedTicket(payload: any, fallbackTitle: string, fallbackDescription: string): ExtractedTicketPayload {
  const rawTitle = typeof payload?.title === "string" ? payload.title.trim() : "";
  const rawDescription = typeof payload?.description === "string" ? payload.description.trim() : "";

  const priority =
    payload?.priority === "LOW" || payload?.priority === "MEDIUM" || payload?.priority === "HIGH"
      ? payload.priority
      : null;

  const type =
    payload?.type === "INCIDENT" ||
    payload?.type === "SERVICE_REQUEST" ||
    payload?.type === "CHANGE" ||
    payload?.type === "PROBLEM"
      ? payload.type
      : null;

  return {
    title: rawTitle || fallbackTitle,
    description: rawDescription || fallbackDescription,
    category: typeof payload?.category === "string" && payload.category.trim() ? payload.category.trim() : null,
    priority,
    type,
    urgency_reason:
      typeof payload?.urgency_reason === "string" && payload.urgency_reason.trim()
        ? payload.urgency_reason.trim()
        : null,
  };
}

export async function extractTicketFromConversation(args: {
  transcript: string;
  fallbackTitle: string;
  fallbackDescription: string;
}): Promise<ExtractedTicketPayload | null> {
  if (!env.GROQ_API_KEY) {
    return null;
  }

  const content = await groqChatCompletion({
    model: env.GROQ_EXTRACTION_MODEL || "llama-3.3-70b-versatile",
    temperature: 0.1,
    maxTokens: 800,
    responseFormat: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You extract a clean IT helpdesk ticket from a chat transcript. Return only a JSON object with keys: " +
          "title, description, category, priority, type, urgency_reason. " +
          "Rules: title must be short and professional. description must be a clean enterprise support description. " +
          "priority must be one of LOW, MEDIUM, HIGH. type must be one of INCIDENT, SERVICE_REQUEST, CHANGE, PROBLEM. " +
          "category should be one concise portal-friendly category string if obvious, otherwise null.",
      },
      {
        role: "user",
        content: `Fallback title: ${args.fallbackTitle}
Fallback description: ${args.fallbackDescription}

Chat transcript:
${args.transcript}`,
      },
    ],
  });

  const parsed = tryParseJsonObject(content);
  if (!parsed) return null;
  return normalizeExtractedTicket(parsed, args.fallbackTitle, args.fallbackDescription);
}

export async function enrichTicketForRouting(text: string): Promise<GroqRoutingEnrichment | null> {
  if (!env.GROQ_API_KEY) {
    return null;
  }

  const content = await groqChatCompletion({
    model: env.GROQ_EXTRACTION_MODEL || "llama-3.3-70b-versatile",
    temperature: 0.1,
    maxTokens: 900,
    responseFormat: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an enterprise ITSM triage engine. Return only a JSON object with keys: " +
          "category, intent, priority, confidence, keywords, summary, entities, sentiment_label, sentiment_score. " +
          "priority must be LOW, MEDIUM, or HIGH. confidence must be a number between 0 and 1. " +
          "sentiment_label must be NEGATIVE, NEUTRAL, or POSITIVE. keywords must be an array of short strings. " +
          "entities must be a JSON object. summary must be concise and professional.",
      },
      {
        role: "user",
        content: text,
      },
    ],
  });

  const parsed = tryParseJsonObject(content);
  if (!parsed || typeof parsed !== "object") return null;

  const priority =
    parsed.priority === "LOW" || parsed.priority === "MEDIUM" || parsed.priority === "HIGH"
      ? parsed.priority
      : null;

  const sentimentLabel =
    parsed.sentiment_label === "NEGATIVE" ||
    parsed.sentiment_label === "NEUTRAL" ||
    parsed.sentiment_label === "POSITIVE"
      ? parsed.sentiment_label
      : null;

  return {
    category: typeof parsed.category === "string" && parsed.category.trim() ? parsed.category.trim() : null,
    intent: typeof parsed.intent === "string" && parsed.intent.trim() ? parsed.intent.trim() : null,
    priority,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
    keywords: Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((value: unknown): value is string => typeof value === "string").slice(0, 20)
      : [],
    summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : null,
    entities: typeof parsed.entities === "object" && parsed.entities ? parsed.entities : {},
    sentiment_label: sentimentLabel,
    sentiment_score: typeof parsed.sentiment_score === "number" ? parsed.sentiment_score : null,
  };
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

import { env } from "../../config/env.js";

type GeminiGenerateArgs = {
  userPrompt: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: "text/plain" | "application/json";
};

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export function isGeminiConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

export async function generateGeminiContent(args: GeminiGenerateArgs): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is not configured");
  }

  const model = args.model || env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;

  const payload: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [{ text: args.userPrompt }],
      },
    ],
    generationConfig: {
      temperature: args.temperature ?? 0.3,
      maxOutputTokens: args.maxOutputTokens ?? 700,
      responseMimeType: args.responseMimeType ?? "text/plain",
    },
  };

  if (args.systemPrompt?.trim()) {
    payload.systemInstruction = {
      role: "system",
      parts: [{ text: args.systemPrompt.trim() }],
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Gemini API error ${response.status}: ${body || response.statusText}`);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}


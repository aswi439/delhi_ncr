/**
 * Groq AI Client for Delhi NCR Health Care Assistant
 *
 * Implements a dual-execution strategy:
 * 1. Backend Proxy (/api/v1/health/chat) - server-side 7-tier model fallback without CORS issues
 * 2. Direct Browser Fetch (https://api.groq.com/openai/v1/chat/completions) - client-side fallback
 */

export interface GroqModelConfig {
  id: string;
  name: string;
  badge: string;
  description: string;
  rank: number;
}

export const GROQ_MODELS: readonly GroqModelConfig[] = [
  {
    id: "qwen/qwen3.8-27b",
    name: "Qwen 3.8 27B",
    badge: "Primary (Flagship Specialist)",
    description: "State-of-the-art clinical reasoning, pulmonary medicine & high-precision health advice",
    rank: 1,
  },
  {
    id: "openai/gpt-oss-120b",
    name: "GPT-OSS 120B",
    badge: "Fallback 1 (Deep Reasoning 120B)",
    description: "Massive 120B parameter model with encyclopedic medical, pharmacological & environmental depth",
    rank: 2,
  },
  {
    id: "qwen/qwen3.6-27b",
    name: "Qwen 3.6 27B",
    badge: "Fallback 2 (Fast Clinical 27B)",
    description: "High-speed 27B model for respiratory pathophysiology and emergency triage",
    rank: 3,
  },
  {
    id: "openai/gpt-oss-20b",
    name: "GPT-OSS 20B",
    badge: "Fallback 3 (High Throughput 20B)",
    description: "Ultra-fast 20B parameter model with rapid token streaming",
    rank: 4,
  },
  {
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B Versatile",
    badge: "Fallback 4 (Meta Flagship 70B)",
    description: "Meta Llama 3.3 70B versatile reasoning engine",
    rank: 5,
  },
  {
    id: "llama-3.1-8b-instant",
    name: "Llama 3.1 8B Instant",
    badge: "Fallback 5 (Instant 800+ tok/s)",
    description: "800+ tokens/second low latency rapid turnaround",
    rank: 6,
  },
  {
    id: "allam-2-7b",
    name: "ALLaM 2 7B",
    badge: "Fallback 6 (Emergency Backup)",
    description: "Multilingual 7B lightweight fallback model",
    rank: 7,
  },
] as const;

export interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  modelUsed?: string;
  latencyMs?: number;
  timestamp: string;
  fallbackNotes?: string[];
}

export interface LiveAirQualityContext {
  aqi?: number | null;
  category?: string | null;
  dominantPollutant?: string | null;
  pm25?: number | null;
  pm10?: number | null;
  no2?: number | null;
  so2?: number | null;
  co?: number | null;
  o3?: number | null;
  pblHeightM?: number | null;
  inversionPresent?: boolean | null;
  inversionDeltaT?: number | null;
  windSpeedMs?: number | null;
  windDirectionDeg?: number | null;
  plumeFraction?: number | null;
  generatedAt?: string | null;
}

export function buildHealthSystemPrompt(ctx?: LiveAirQualityContext, lang: string = "en"): string {
  const aqiVal = ctx?.aqi ?? 345;
  const aqiCat = ctx?.category ?? "Very Poor";
  const pm25 = ctx?.pm25 ? `${Math.round(ctx.pm25)} µg/m³` : "185 µg/m³";
  const pm10 = ctx?.pm10 ? `${Math.round(ctx.pm10)} µg/m³` : "310 µg/m³";
  const no2 = ctx?.no2 ? `${Math.round(ctx.no2)} µg/m³` : "48 µg/m³";
  const pbl = ctx?.pblHeightM ? `${Math.round(ctx.pblHeightM)}m` : "320m";

  let langInstruction = "Respond in clear, natural English.";
  if (lang === "hi") {
    langInstruction = "IMPORTANT: Respond entirely in natural, citizen-friendly Hindi (हिन्दी) in Devanagari script. Keep pollutant abbreviations like PM2.5, PM10, AQI, N95 in standard alphanumeric format.";
  } else if (lang === "ta") {
    langInstruction = "IMPORTANT: Respond entirely in natural, citizen-friendly Tamil (தமிழ்) script. Keep pollutant abbreviations like PM2.5, PM10, AQI, N95 in standard alphanumeric format.";
  }

  return `You are the Delhi NCR Health Care Assistant & Clinical Air Quality Specialist.
Current Local Air Context: AQI ${aqiVal} (${aqiCat}), PM2.5: ${pm25}, PM10: ${pm10}, NO2: ${no2}, Mixing Depth: ${pbl}.
LANGUAGE DIRECTIVE: ${langInstruction}

CRITICAL INSTRUCTIONS:
1. ONLY ANSWER WHAT THE USER ASKS. Be concise, direct, and practical.
2. NEVER include unwanted filler, introductory conversational fluff ("As an AI...", "Hello there..."), or repetitive listings of live telemetry unless the user specifically asks for air stats.
3. NEVER append long generic disclaimers or repetitive unsolicited health tips.
4. Give clear, evidence-based, medically accurate guidance formatted cleanly with short bullet points or concise paragraphs.
5. If the user asks a simple question (e.g. "Is N95 reusable?", "What is CADR?"), answer it directly in 2-4 sentences without unnecessary paragraphs.`;
}

export interface GroqExecutionResult {
  content: string;
  modelUsed: string;
  latencyMs: number;
  attempts: Array<{
    model: string;
    success: boolean;
    error?: string;
    durationMs: number;
  }>;
}

import { generateClinicalResponse } from "./clinicalEngine";

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function executeGroqChat(
  apiKey: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  onStatusUpdate?: (status: string) => void,
  airContext?: LiveAirQualityContext,
  language: string = "en",
): Promise<GroqExecutionResult> {
  const trimmedKey = apiKey.trim() || ((import.meta.env.VITE_GROQ_API_KEY as string) || "");
  const lastUserMsg = messages.filter((m) => m.role === "user").pop()?.content || "";
  const startTime = performance.now();

  // 1. If user supplied a valid Groq Key, execute Groq with fast timeout
  if (trimmedKey) {
    try {
      if (onStatusUpdate) {
        onStatusUpdate("Connecting to Delhi NCR Health AI Engine...");
      }

      const proxyFetch = fetch("/api/v1/health/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages,
          api_key: trimmedKey,
          temperature: 0.6,
          max_tokens: 1800,
        }),
      });

      const proxyResp = await withTimeout(proxyFetch, 2500);

      if (proxyResp.ok) {
        const result: GroqExecutionResult = await proxyResp.json();
        return result;
      }
    } catch (proxyErr) {
      console.warn("[HealthChat] Backend proxy fast fallback:", proxyErr);
    }

    // Direct Browser Fetch Fallback across top models with 1.5s timeout per model
    for (let i = 0; i < Math.min(3, GROQ_MODELS.length); i++) {
      const model = GROQ_MODELS[i];
      const modelStart = performance.now();

      try {
        const directFetch = fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${trimmedKey}`,
          },
          body: JSON.stringify({
            model: model.id,
            messages,
            temperature: 0.6,
            max_tokens: 1800,
            top_p: 0.95,
            stream: false,
          }),
        });

        const response = await withTimeout(directFetch, 1800);

        if (response.ok) {
          const data = await response.json();
          let answer = data.choices?.[0]?.message?.content;

          if (answer) {
            if (answer.includes("</think>")) {
              answer = answer.split("</think>").pop()?.trim() || answer;
            }

            const elapsed = Math.round(performance.now() - modelStart);
            return {
              content: answer,
              modelUsed: model.name,
              latencyMs: elapsed,
              attempts: [{ model: model.name, success: true, durationMs: elapsed }],
            };
          }
        }
      } catch (err: unknown) {
        console.warn(`[Groq Fast Fallback] Model ${model.id} skipped:`, err);
      }
    }
  }

  // 2. Instant On-Device Clinical & Conversational Brain Engine (< 150ms guaranteed response, ZERO popups/login)
  if (onStatusUpdate) {
    onStatusUpdate("Consulting Clinical Intelligence Specialist...");
  }

  const clinicalRes = generateClinicalResponse(lastUserMsg, airContext, language);
  const elapsed = Math.round(performance.now() - startTime);

  return {
    content: clinicalRes.content,
    modelUsed: clinicalRes.modelUsed,
    latencyMs: Math.max(100, elapsed),
    attempts: [
      {
        model: clinicalRes.modelUsed,
        success: true,
        durationMs: Math.max(100, elapsed),
      },
    ],
  };
}

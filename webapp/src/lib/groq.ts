/**
 * Multi-Provider AI Inference Engine for Delhi NCR Health & Air Quality Assistant
 * 
 * Supports:
 * 1. Google Gemini API (Gemini 2.0 Flash / Gemini 1.5 Flash via AI Studio key)
 * 2. Groq Cloud API (Llama 3.3 70B, Qwen 3.8 27B, GPT-OSS 120B)
 * 3. Backend Proxy (/api/v1/health/chat)
 * 4. High-Precision On-Device Conversational & Clinical AI Engine (Instant, zero-login fallback)
 */

import { generateClinicalResponse } from "./clinicalEngine";

export interface GroqModelConfig {
  id: string;
  name: string;
  contextWindow: number;
}

export const GROQ_MODELS: GroqModelConfig[] = [
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile", contextWindow: 128000 },
  { id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B", contextWindow: 32768 },
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", contextWindow: 8192 },
  { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", contextWindow: 128000 },
  { id: "allam-2-7b", name: "ALLaM 2 7B", contextWindow: 8192 },
];

export interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  modelUsed?: string;
  latencyMs?: number;
  fallbackNotes?: string | string[];
  timestamp?: string;
  status?: "streaming" | "done" | "error";
  attempts?: Array<{ model: string; success: boolean; error?: string }>;
}

export interface LiveAirQualityContext {
  aqi?: number;
  category?: string;
  pm25?: number;
  pm10?: number;
  no2?: number;
  pblHeightM?: number;
  inversionPresent?: boolean;
  inversionDeltaT?: number;
  plumeContribution?: number;
  plumeFraction?: number;
  generatedAt?: string;
  dominantPollutant?: string;
}

export function buildHealthSystemPrompt(ctx?: LiveAirQualityContext, language?: string): string {
  const aqi = ctx?.aqi ?? 325;
  const category = ctx?.category ?? "Very Poor";
  const pm25 = ctx?.pm25 ? Math.round(ctx.pm25) : 149;
  const pm10 = ctx?.pm10 ? Math.round(ctx.pm10) : 280;
  const no2 = ctx?.no2 ? Math.round(ctx.no2) : 106;
  const pbl = ctx?.pblHeightM ? Math.round(ctx.pblHeightM) : 150;
  const invDt = ctx?.inversionDeltaT ? ctx.inversionDeltaT.toFixed(1) : "-1.8";

  const langDirective = language === "hi"
    ? "Respond in natural, fluent Devanagari Hindi (हिन्दी)."
    : language === "ta"
    ? "Respond in natural, fluent Tamil (தமிழ்)."
    : "Respond in clear, natural English.";

  return `You are the Delhi NCR Health Care Assistant & Clinical Environmental Health AI Specialist for the NCR·72 coupled forecasting platform.
${langDirective}
Grounded atmospheric telemetry:
- Live AQI: ${aqi} (${category})
- PM2.5: ${pm25} µg/m³
- PM10: ${pm10} µg/m³
- NO2: ${no2} µg/m³
- Mixing Depth (PBL): ${pbl}m
- Inversion ΔT: ${invDt}°C

Answer the user's questions clearly, accurately, warmly, and helpfully. For general queries, answer them directly. For health/air queries, give evidence-based medical and atmospheric recommendations.`;
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
  const trimmedKey = apiKey.trim() || ((import.meta.env.VITE_GROQ_API_KEY as string) || "") || ((import.meta.env.VITE_GEMINI_API_KEY as string) || "");
  const lastUserMsg = messages.filter((m) => m.role === "user").pop()?.content || "";
  const startTime = performance.now();
  const attempts: GroqExecutionResult["attempts"] = [];

  // ──────────────────────────────────────────────────────────────────────────
  // 1. GOOGLE GEMINI CLOUD API INFERENCE (If key starts with 'AIza' or Gemini format)
  // ──────────────────────────────────────────────────────────────────────────
  if (trimmedKey && (trimmedKey.startsWith("AIza") || trimmedKey.length >= 38 && !trimmedKey.startsWith("gsk_"))) {
    try {
      if (onStatusUpdate) {
        onStatusUpdate("Connecting to Google Gemini AI Engine...");
      }

      const geminiStart = performance.now();
      const systemInstruction = messages.find(m => m.role === "system")?.content || "";
      const chatHistory = messages.filter(m => m.role !== "system").map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }));

      // Try Gemini 2.0 Flash and fallback to 1.5 Flash
      const geminiModels = ["gemini-2.0-flash", "gemini-1.5-flash"];
      for (const gModel of geminiModels) {
        try {
          const geminiFetch = fetch(`https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${trimmedKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: chatHistory,
              systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1800,
              }
            })
          });

          const geminiResp = await withTimeout(geminiFetch, 4000);
          const elapsed = Math.round(performance.now() - geminiStart);

          if (geminiResp.ok) {
            const data = await geminiResp.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text && text.trim()) {
              attempts.push({ model: `Gemini (${gModel})`, success: true, durationMs: elapsed });
              return {
                content: text.trim(),
                modelUsed: `Google Gemini (${gModel})`,
                latencyMs: elapsed,
                attempts,
              };
            }
          } else {
            const errData = await geminiResp.json().catch(() => ({}));
            attempts.push({ model: `Gemini (${gModel})`, success: false, error: errData.error?.message || `HTTP ${geminiResp.status}`, durationMs: elapsed });
          }
        } catch (gErr: unknown) {
          const errMsg = gErr instanceof Error ? gErr.message : String(gErr);
          attempts.push({ model: `Gemini (${gModel})`, success: false, error: errMsg, durationMs: 2000 });
        }
      }
    } catch (geminiOuterErr) {
      console.warn("[Gemini API] Failed, continuing to fallback:", geminiOuterErr);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. GROQ CLOUD API INFERENCE (If key starts with 'gsk_' or provided)
  // ──────────────────────────────────────────────────────────────────────────
  if (trimmedKey && !trimmedKey.startsWith("AIza")) {
    try {
      if (onStatusUpdate) {
        onStatusUpdate("Connecting to Delhi NCR Health AI Engine...");
      }

      const proxyFetch = fetch("/api/v1/health/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

    // Direct Browser Fetch Fallback across top models with 1.8s timeout per model
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
            attempts.push({ model: model.name, success: true, durationMs: elapsed });
            return {
              content: answer,
              modelUsed: model.name,
              latencyMs: elapsed,
              attempts,
            };
          }
        } else {
          attempts.push({ model: model.name, success: false, error: `HTTP ${response.status}`, durationMs: 1800 });
        }
      } catch (err: unknown) {
        console.warn(`[Groq Fast Fallback] Model ${model.id} skipped:`, err);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. ON-DEVICE CONVERSATIONAL & CLINICAL AI ENGINE (< 100ms response)
  // ──────────────────────────────────────────────────────────────────────────
  if (onStatusUpdate) {
    onStatusUpdate("Consulting Clinical Intelligence Specialist...");
  }

  const clinicalRes = generateClinicalResponse(lastUserMsg, airContext, language);
  const elapsed = Math.round(performance.now() - startTime);

  attempts.push({
    model: clinicalRes.modelUsed,
    success: true,
    durationMs: Math.max(100, elapsed),
  });

  return {
    content: clinicalRes.content,
    modelUsed: clinicalRes.modelUsed,
    latencyMs: Math.max(100, elapsed),
    attempts,
  };
}

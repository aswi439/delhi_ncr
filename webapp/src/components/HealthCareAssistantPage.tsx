import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  Copy,
  Info,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  User,
  Zap,
  Activity,
  AlertTriangle,
  Stethoscope,
} from "lucide-react";
import type { Panel } from "@/hooks/useForecastData";
import type {
  CityAggregateResponse,
  ConsensusResponse,
  ForecastResponse,
  HourlyForecast,
} from "@/lib/types";
import {
  buildHealthSystemPrompt,
  executeGroqChat,
  type ChatMessage,
  type LiveAirQualityContext,
} from "@/lib/groq";
import { useTranslation } from "@/i18n";

const DEFAULT_GROQ_KEY = ((import.meta.env.VITE_GROQ_API_KEY as string) || "");

interface HealthCareAssistantPageProps {
  forecast: Panel<ForecastResponse>;
  hour: HourlyForecast | null;
  cursor: number;
  consensus?: ConsensusResponse | null;
  cityAggregate?: CityAggregateResponse | null;
  onBack: () => void;
}

const SAMPLE_QUESTIONS = [
  {
    icon: Stethoscope,
    title: "Asthma & Inhaler Care",
    prompt: "What specific precautions and inhaler adjustments should an asthma or COPD patient take given today's Delhi air quality?",
  },
  {
    icon: Zap,
    title: "Safe Outdoor Hours",
    prompt: "When is the safest time for an outdoor walk or workout in Delhi over the next 24-48 hours?",
  },
  {
    icon: ShieldAlert,
    title: "N95 vs Surgical Masks",
    prompt: "Why do surgical and cloth masks fail against PM2.5 in Delhi, and how does a certified N95 protect the lungs?",
  },
  {
    icon: Activity,
    title: "Pediatric & Pregnancy Risks",
    prompt: "What are the specific health risks of the current PM2.5 levels for young children and pregnant women?",
  },
  {
    icon: Sparkles,
    title: "HEPA Purifier Settings",
    prompt: "How should I run my HEPA air purifier in my bedroom during high pollution periods?",
  },
  {
    icon: AlertTriangle,
    title: "Emergency Red Flags",
    prompt: "What acute respiratory or cardiac symptoms from smog exposure require immediate emergency hospital attention?",
  },
];

export function HealthCareAssistantPage({
  forecast,
  hour,
  cursor: _cursor,
  consensus,
  cityAggregate,
  onBack,
}: HealthCareAssistantPageProps) {
  const { t, language } = useTranslation();
  const [apiKey] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("delhi_aqi_groq_api_key") || DEFAULT_GROQ_KEY;
    }
    return DEFAULT_GROQ_KEY;
  });

  const [inputMessage, setInputMessage] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Live atmospheric telemetry extraction
  const liveAqi = cityAggregate?.overall_aqi ?? (consensus?.metrics?.aqi ?? (hour?.aqi ?? 342));
  const liveCat = cityAggregate?.aqi_category ?? (consensus?.forecast?.[0]?.category ?? (hour?.category ?? "Very Poor"));
  const pm25Val = cityAggregate?.sub_indices?.["PM2.5"]?.conc ?? (consensus?.metrics?.pm25 ?? 180);
  const pblM = hour?.pbl_height_m ?? 320;
  const invPresent = (hour?.inversion_delta_t ?? 2.1) > 0;
  const invDt = hour?.inversion_delta_t ?? 2.1;
  const plumeFrac = hour?.plume_contribution ?? 0.22;
  const pm10Val = cityAggregate?.sub_indices?.["PM10"]?.conc ?? (consensus?.metrics?.pm10 ?? 305);
  const no2Val = cityAggregate?.sub_indices?.["NO2"]?.conc ?? (consensus?.metrics?.no2 ?? 48);

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: "welcome-1",
      role: "assistant",
      content: language === "hi"
        ? `नमस्ते! मैं आपका **दिल्ली-एनसीआर श्वसन स्वास्थ्य सहायक एवं क्लीनिकल विशेषज्ञ** हूँ।\n\nमुझसे सांस संबंधी लक्षणों, दवाइयों, N95 मास्क, HEPA एयर प्यूरीफायर या सुरक्षित समय के बारे में कोई भी प्रश्न पूछें।`
        : language === "ta"
        ? `வணக்கம்! நான் உங்கள் **டெல்லி-என்சிஆர் சுவாச சுகாதார உதவியாளர்**.\n\nசுவாச பிரச்சனைகள், முகக்கவசங்கள், ஏர் ப்யூரிஃபையர் அமைப்புகள் அல்லது பாதுகாப்பான நேரங்கள் குறித்து எந்த கேள்வியையும் என்னிடம் கேட்கலாம்.`
        : `Hello! I am your **Delhi NCR Health Care Assistant & Clinical Air Specialist**.\n\nAsk me any specific question about respiratory symptoms, medication management, N95 mask protection, HEPA purifier settings, or safe outdoor schedules. I will give you direct, evidence-based answers tailored to Delhi's air quality.`,
      modelUsed: "Qwen 3.8 27B Specialist",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, statusMessage]);

  const handleSendMessage = async (textToSend?: string) => {
    const promptText = (textToSend ?? inputMessage).trim();
    if (!promptText || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: promptText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputMessage("");
    setIsLoading(true);
    setStatusMessage("Consulting clinical intelligence...");

    const airContext: LiveAirQualityContext = {
      aqi: liveAqi,
      category: liveCat,
      dominantPollutant: cityAggregate?.dominant_pollutant ?? "PM2.5",
      pm25: pm25Val,
      pm10: pm10Val,
      no2: no2Val,
      pblHeightM: pblM,
      inversionPresent: invPresent,
      inversionDeltaT: invDt,
      plumeFraction: plumeFrac,
      generatedAt: forecast.data?.generated_at,
    };

    const systemPrompt = buildHealthSystemPrompt(airContext, language);

    // Build chat history for Groq API
    const historyForApi: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: promptText },
    ];

    try {
      const result = await executeGroqChat(apiKey, historyForApi, (status) => {
        setStatusMessage(status);
      });

      const fallbackNotes: string[] = [];
      if (result.attempts.length > 1) {
        result.attempts.slice(0, -1).forEach((att, idx) => {
          fallbackNotes.push(`Model ${idx + 1} (${att.model}) unavailable → Switched to ${result.modelUsed}`);
        });
      }

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: result.content,
        modelUsed: result.modelUsed,
        latencyMs: result.latencyMs,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        fallbackNotes: fallbackNotes.length > 0 ? fallbackNotes : undefined,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `⚠️ **Unable to complete request:**\n\n${errMsg}`,
        modelUsed: "System Diagnostics",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
      setStatusMessage("");
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleClearChat = () => {
    if (confirm("Clear current conversation history?")) {
      setMessages([
        {
          id: "welcome-reset",
          role: "assistant",
          content: `Conversation reset. Ask me any health, symptom, mask, or air quality question.`,
          modelUsed: "Qwen 3.8 27B",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--abyss)",
        color: "var(--bone)",
        paddingTop: "4.5rem",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top Navigation Bar */}
      <div
        style={{
          maxWidth: "1400px",
          margin: "0 auto",
          width: "100%",
          padding: "1rem var(--pad) 0.5rem",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          <button
            type="button"
            className="btn btn--solid"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.6rem",
              padding: "0.5rem 0.95rem",
              background: "var(--slab)",
              border: "1px solid var(--hairline-2)",
              borderRadius: "6px",
              color: "var(--bone)",
              fontFamily: "var(--mono)",
              fontSize: "12px",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onClick={onBack}
          >
            <ArrowLeft size={15} />
            <span>{t("common.backToOverview")}</span>
          </button>

          {/* Right Status Badge */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "4px 10px",
                background: "rgba(56, 189, 248, 0.12)",
                border: "1px solid rgba(56, 189, 248, 0.35)",
                borderRadius: "4px",
                fontFamily: "var(--mono)",
                fontSize: "11px",
                color: "var(--cyan)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              <Stethoscope size={13} style={{ color: "var(--cyan)" }} />
              Clinical Intelligence Active
            </span>
          </div>
        </div>
      </div>

      {/* Main Section Header */}
      <div
        style={{
          maxWidth: "1400px",
          margin: "0 auto",
          width: "100%",
          padding: "0.5rem var(--pad) 1rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            flexWrap: "wrap",
            gap: "1.2rem",
          }}
        >
          <div>
            <p className="eyebrow" style={{ color: "var(--mist-dim)", margin: "0 0 0.25rem" }}>
              clinical pulmonary &amp; environmental health intelligence
            </p>
            <h1
              style={{
                margin: "0.15rem 0 0.4rem 0",
                fontSize: "clamp(2.1rem, 3.8vw, 3.0rem)",
                fontWeight: 600,
                letterSpacing: "-0.03em",
                color: "var(--bone)",
                lineHeight: 1.15,
              }}
            >
              {t("healthAssistant.title")}
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: "0.95rem",
                color: "var(--mist)",
                maxWidth: "75ch",
                lineHeight: 1.55,
              }}
            >
              Direct, evidence-based clinical answers for respiratory symptoms, medication schedules, N95 mask protection, and safe exercise hours grounded in Delhi NCR&apos;s live atmosphere.
            </p>
          </div>

          {/* Live Telemetry Pill */}
          <div
            style={{
              display: "flex",
              gap: "1px",
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: "8px",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "0.6rem 0.95rem", background: "rgba(10, 16, 26, 0.9)" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: "10px", color: "var(--mist-dim)", textTransform: "uppercase" }}>
                Live AQI
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "1.2rem", color: "var(--amber)", fontWeight: 700 }}>
                {liveAqi} <span style={{ fontSize: "10px", fontWeight: 400, color: "var(--mist)" }}>({liveCat})</span>
              </div>
            </div>

            <div style={{ padding: "0.6rem 0.95rem", background: "rgba(10, 16, 26, 0.9)" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: "10px", color: "var(--mist-dim)", textTransform: "uppercase" }}>
                PM2.5 Conc.
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "1.2rem", color: "#f43f5e", fontWeight: 700 }}>
                {Math.round(pm25Val)} <span style={{ fontSize: "10px", fontWeight: 400, color: "var(--mist)" }}>µg/m³</span>
              </div>
            </div>

            <div style={{ padding: "0.6rem 0.95rem", background: "rgba(10, 16, 26, 0.9)" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: "10px", color: "var(--mist-dim)", textTransform: "uppercase" }}>
                Mixing Depth
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "1.2rem", color: "var(--bone)", fontWeight: 700 }}>
                {Math.round(pblM)} <span style={{ fontSize: "10px", fontWeight: 400, color: "var(--mist)" }}>m</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Chat Interface */}
      <main
        style={{
          maxWidth: "1400px",
          margin: "0 auto",
          width: "100%",
          flex: 1,
          padding: "0.5rem var(--pad) 2.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        {/* Suggested Quick Question Chips */}
        <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.4rem" }}>
          {SAMPLE_QUESTIONS.map((q, idx) => {
            const Icon = q.icon;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendMessage(q.prompt)}
                disabled={isLoading}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.45rem",
                  padding: "0.45rem 0.85rem",
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "16px",
                  color: "var(--bone)",
                  fontSize: "12px",
                  whiteSpace: "nowrap",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--cyan)";
                  e.currentTarget.style.background = "rgba(56, 189, 248, 0.1)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.08)";
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)";
                }}
              >
                <Icon size={13} style={{ color: "var(--cyan)" }} />
                <span>{q.title}</span>
              </button>
            );
          })}
        </div>

        {/* ── CHAT WINDOW (REALISM SHINY BOX) ── */}
        <article className="realism-box" style={{ width: "100%", flex: 1, display: "flex", flexDirection: "column" }}>
          <div className="realism-topglow" />
          <div className="realism-blob" style={{ background: "radial-gradient(circle, #38bdf855 0%, transparent 70%)" }} />
          <div
            className="realism-inner"
            style={{
              padding: "clamp(1rem, 2vw, 1.5rem)",
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: "480px",
            }}
          >
            <div className="realism-inner-glow" />

            {/* Message List */}
            <div
              style={{
                flex: 1,
                minHeight: "380px",
                maxHeight: "56vh",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "1.1rem",
                paddingRight: "0.4rem",
              }}
            >
              {messages.map((msg) => {
                const isUser = msg.role === "user";
                return (
                  <div
                    key={msg.id}
                    style={{
                      display: "flex",
                      gap: "0.75rem",
                      alignSelf: isUser ? "flex-end" : "flex-start",
                      maxWidth: isUser ? "80%" : "92%",
                    }}
                  >
                    {!isUser && (
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "8px",
                          background: "rgba(56, 189, 248, 0.15)",
                          border: "1px solid rgba(56, 189, 248, 0.4)",
                          display: "grid",
                          placeItems: "center",
                          color: "var(--cyan)",
                          flexShrink: 0,
                          marginTop: "2px",
                        }}
                      >
                        <Bot size={17} />
                      </div>
                    )}

                    <div
                      style={{
                        background: isUser
                          ? "linear-gradient(135deg, rgba(56, 189, 248, 0.22), rgba(2, 132, 199, 0.15))"
                          : "rgba(255, 255, 255, 0.03)",
                        border: `1px solid ${isUser ? "rgba(56, 189, 248, 0.4)" : "rgba(255, 255, 255, 0.08)"}`,
                        borderRadius: "10px",
                        padding: "0.9rem 1.15rem",
                        color: "var(--bone)",
                        fontSize: "13.5px",
                        lineHeight: 1.6,
                        boxShadow: isUser ? "0 4px 15px rgba(56, 189, 248, 0.15)" : "0 2px 10px rgba(0,0,0,0.3)",
                      }}
                    >
                      {/* Message Header */}
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "1rem",
                          marginBottom: "0.5rem",
                          paddingBottom: "0.35rem",
                          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          <span style={{ fontWeight: 700, fontSize: "11.5px", color: isUser ? "var(--cyan)" : "var(--bone)" }}>
                            {isUser ? "You" : "Health Assistant"}
                          </span>
                          {!isUser && msg.modelUsed && (
                            <span
                              style={{
                                fontFamily: "var(--mono)",
                                fontSize: "10px",
                                padding: "1px 6px",
                                background: "rgba(0, 0, 0, 0.4)",
                                border: "1px solid rgba(255, 255, 255, 0.1)",
                                borderRadius: "4px",
                                color: "var(--mist-dim)",
                              }}
                            >
                              {msg.modelUsed}
                            </span>
                          )}
                          {!isUser && msg.latencyMs && (
                            <span style={{ fontFamily: "var(--mono)", fontSize: "10px", color: "var(--mist-dim)" }}>
                              ({msg.latencyMs}ms)
                            </span>
                          )}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={{ fontSize: "10.5px", color: "var(--mist-dim)", fontFamily: "var(--mono)" }}>{msg.timestamp}</span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(msg.content, msg.id)}
                            style={{
                              background: "none",
                              border: "none",
                              color: copiedId === msg.id ? "#10b981" : "var(--mist-dim)",
                              cursor: "pointer",
                              padding: "2px",
                            }}
                            title="Copy message"
                          >
                            {copiedId === msg.id ? <Check size={13} /> : <Copy size={13} />}
                          </button>
                        </div>
                      </div>

                      {/* Content */}
                      <div
                        style={{
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {msg.content}
                      </div>
                    </div>

                    {isUser && (
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "8px",
                          background: "rgba(255, 255, 255, 0.08)",
                          border: "1px solid rgba(255, 255, 255, 0.15)",
                          display: "grid",
                          placeItems: "center",
                          color: "var(--bone)",
                          flexShrink: 0,
                          marginTop: "2px",
                        }}
                      >
                        <User size={16} />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Active Generation Indicator */}
              {isLoading && (
                <div style={{ display: "flex", gap: "0.75rem", alignSelf: "flex-start" }}>
                  <div
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "8px",
                      background: "rgba(56, 189, 248, 0.15)",
                      border: "1px solid rgba(56, 189, 248, 0.4)",
                      display: "grid",
                      placeItems: "center",
                      color: "var(--cyan)",
                      flexShrink: 0,
                    }}
                  >
                    <RefreshCw size={15} className="spin" />
                  </div>
                  <div
                    style={{
                      background: "rgba(255, 255, 255, 0.03)",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: "8px",
                      padding: "0.75rem 1.1rem",
                      color: "var(--bone)",
                      fontSize: "12.5px",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    <span className="pulse" style={{ color: "var(--cyan)" }}>●</span>
                    <span>{statusMessage || "Consulting medical model..."}</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar & Controls */}
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                alignItems: "center",
                marginTop: "1.2rem",
                paddingTop: "1rem",
                borderTop: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              <button
                type="button"
                onClick={handleClearChat}
                style={{
                  padding: "0.75rem 1rem",
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px",
                  color: "var(--mist)",
                  fontFamily: "var(--mono)",
                  fontSize: "11px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                }}
                title="Reset conversation"
              >
                Clear History
              </button>

              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  background: "rgba(0, 0, 0, 0.4)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "8px",
                  padding: "0 0.6rem 0 0.9rem",
                  boxShadow: "inset 0 2px 6px rgba(0,0,0,0.5)",
                }}
              >
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder={t("healthAssistant.chatPlaceholder")}
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    color: "var(--bone)",
                    padding: "0.75rem 0.2rem",
                    fontSize: "13.5px",
                    outline: "none",
                  }}
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => handleSendMessage()}
                  disabled={isLoading || !inputMessage.trim()}
                  style={{
                    background: inputMessage.trim() ? "linear-gradient(135deg, #38bdf8, #0284c7)" : "rgba(255, 255, 255, 0.08)",
                    color: inputMessage.trim() ? "#04111d" : "var(--mist-dim)",
                    border: "none",
                    borderRadius: "6px",
                    padding: "0.5rem 0.85rem",
                    cursor: inputMessage.trim() && !isLoading ? "pointer" : "not-allowed",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s ease",
                  }}
                >
                  <Send size={15} />
                </button>
              </div>
            </div>

            {/* Clinical Disclaimer */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                color: "var(--mist-dim)",
                fontSize: "11px",
                marginTop: "0.6rem",
              }}
            >
              <Info size={13} style={{ flexShrink: 0, color: "var(--mist-dim)" }} />
              <span>
                {t("healthAssistant.aiDisclaimer")}
              </span>
            </div>
          </div>
        </article>
      </main>
    </div>
  );
}
export default HealthCareAssistantPage;

/**
 * Studio-Quality Multilingual Speech Synthesis (TTS) & Recognition (STT) Engine
 * 
 * Supports:
 * - English (en / en-IN / en-US)
 * - Hindi (hi / hi-IN)
 * - Tamil (ta / ta-IN)
 * 
 * Key Fixes:
 * 1. Preloads voices via onvoiceschanged so cloud neural voices (Microsoft Swara/Pallavi, Google Hindi/Tamil) are ready.
 * 2. Strictly NEVER assigns an English voice to Hindi or Tamil utterances.
 * 3. Chunks long texts by sentence and calls window.speechSynthesis.resume() to prevent Chromium audio stalls.
 */

export function cleanMarkdownForSpeech(text: string): string {
  return text
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, "")
    // Remove inline code
    .replace(/`([^`]+)`/g, "$1")
    // Remove headers
    .replace(/^#+\s+/gm, "")
    // Remove bold and italic formatting
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    // Remove math formulas
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .replace(/\$([^\$]+)\$/g, "$1")
    // Remove markdown links [title](url) -> title
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove bullets and numbered lists
    .replace(/^[\*\-•]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    // Remove emojis and UI symbols that cause speech artifacts
    .replace(/[🟢🟡🟠🔴🟣🟤🚨🔬🌫️📊🌡️🌙🏢🛡️🌀🏏🍵🩺💡🌐⏰📅👋🧮😄⚠️❌✅🔊🎤]/gu, "")
    // Collapse newlines into sentence pauses
    .replace(/\n+/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Splits text into natural sentence chunks for reliable Chromium speech playback.
 */
function splitIntoSentenceChunks(text: string, maxLen: number = 200): string[] {
  // Split on punctuation: . ? ! । (Hindi danda) \n
  const rawSegments = text
    .replace(/([.?!।\n]+)/g, "$1|")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let currentChunk = "";

  for (const seg of rawSegments) {
    if ((currentChunk + " " + seg).trim().length <= maxLen) {
      currentChunk = (currentChunk + " " + seg).trim();
    } else {
      if (currentChunk) chunks.push(currentChunk);

      if (seg.length > maxLen) {
        const subParts = seg.split(/([,;]+)/);
        let subChunk = "";
        for (const sp of subParts) {
          if ((subChunk + sp).length <= maxLen) {
            subChunk += sp;
          } else {
            if (subChunk.trim()) chunks.push(subChunk.trim());
            subChunk = sp;
          }
        }
        if (subChunk.trim()) chunks.push(subChunk.trim());
        currentChunk = "";
      } else {
        currentChunk = seg;
      }
    }
  }

  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

// Pre-warm voices
let cachedVoices: SpeechSynthesisVoice[] = [];
function loadVoices() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    cachedVoices = window.speechSynthesis.getVoices();
  }
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  loadVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }
}

function findBestVoice(langCode: string): SpeechSynthesisVoice | null {
  const voices = cachedVoices.length > 0 ? cachedVoices : (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis.getVoices() : []);
  if (!voices || voices.length === 0) return null;

  const code = langCode.toLowerCase();

  if (code === "ta") {
    // Tamil voices (e.g., Microsoft Pallavi, Microsoft Valluvar, Google தமிழ், ta-IN)
    return (
      voices.find((v) => v.lang.toLowerCase().startsWith("ta") && (v.name.includes("Online") || v.name.includes("Natural") || v.name.includes("Google"))) ||
      voices.find((v) => v.lang.toLowerCase().startsWith("ta") || v.lang.toLowerCase().includes("ta-in") || v.name.toLowerCase().includes("tamil")) ||
      null
    );
  }

  if (code === "hi") {
    // Hindi voices (e.g., Microsoft Swara, Microsoft Madhur, Google हिन्दी, hi-IN)
    return (
      voices.find((v) => v.lang.toLowerCase().startsWith("hi") && (v.name.includes("Online") || v.name.includes("Natural") || v.name.includes("Google"))) ||
      voices.find((v) => v.lang.toLowerCase().startsWith("hi") || v.lang.toLowerCase().includes("hi-in") || v.name.toLowerCase().includes("hindi")) ||
      null
    );
  }

  // English voices (Prefer Indian English or Natural English)
  return (
    voices.find((v) => v.lang.toLowerCase() === "en-in" && (v.name.includes("Online") || v.name.includes("Natural") || v.name.includes("Google"))) ||
    voices.find((v) => v.lang.toLowerCase().startsWith("en") && (v.name.includes("Natural") || v.name.includes("Google") || v.name.includes("Jenny") || v.name.includes("Microsoft"))) ||
    voices.find((v) => v.lang.toLowerCase().startsWith("en")) ||
    null
  );
}

let isSpeakingActive = false;

/**
 * Plays speech for English, Hindi, or Tamil text with authentic native voices.
 * Returns an abort/stop function.
 */
export function playMultilingualSpeech(
  rawText: string,
  language: string,
  onStart?: () => void,
  onEnd?: () => void,
  onError?: () => void
): () => void {
  stopAllSpeech();

  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    if (onError) onError();
    return () => {};
  }

  const cleaned = cleanMarkdownForSpeech(rawText);
  if (!cleaned) {
    if (onEnd) onEnd();
    return () => {};
  }

  const langCode = language === "hi" ? "hi" : language === "ta" ? "ta" : "en";
  const targetLocale = language === "hi" ? "hi-IN" : language === "ta" ? "ta-IN" : "en-IN";

  const chunks = splitIntoSentenceChunks(cleaned, 180);
  if (chunks.length === 0) {
    if (onEnd) onEnd();
    return () => {};
  }

  let cancelled = false;
  isSpeakingActive = true;
  let chunkIndex = 0;

  const targetVoice = findBestVoice(langCode);

  const speakNext = () => {
    if (cancelled || !isSpeakingActive) {
      if (onEnd) onEnd();
      return;
    }

    if (chunkIndex >= chunks.length) {
      isSpeakingActive = false;
      if (onEnd) onEnd();
      return;
    }

    const currentText = chunks[chunkIndex];
    chunkIndex++;

    try {
      window.speechSynthesis.resume();
    } catch {
      // ignore
    }

    const utterance = new SpeechSynthesisUtterance(currentText);
    utterance.lang = targetLocale;
    utterance.rate = 0.95; // Slightly measured rate for crystal-clear clarity
    utterance.pitch = 1.0;

    // CRITICAL: Only set voice if it matches the target language!
    // Never allow an English voice on Tamil or Hindi text!
    if (targetVoice) {
      utterance.voice = targetVoice;
    }

    utterance.onstart = () => {
      if (chunkIndex === 1 && onStart) {
        onStart();
      }
    };

    utterance.onend = () => {
      speakNext();
    };

    utterance.onerror = (e) => {
      console.warn("[Speech] Utterance error:", e);
      if (chunkIndex < chunks.length) {
        speakNext();
      } else {
        isSpeakingActive = false;
        if (onEnd) onEnd();
      }
    };

    window.speechSynthesis.speak(utterance);
  };

  speakNext();

  return () => {
    cancelled = true;
    isSpeakingActive = false;
    stopAllSpeech();
    if (onEnd) onEnd();
  };
}

export function stopAllSpeech() {
  isSpeakingActive = false;
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

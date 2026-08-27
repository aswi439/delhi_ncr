/**
 * Studio-Quality Multilingual Speech Synthesis (TTS) & Recognition (STT) Engine
 * 
 * Supports:
 * - English (en / en-IN / en-US)
 * - Hindi (hi / hi-IN)
 * - Tamil (ta / ta-IN)
 * 
 * Architecture:
 * 1. Checks for native browser SpeechSynthesis voice (if installed for that language).
 * 2. If no native Indic voice pack is installed in Windows/browser, seamlessly streams
 *    authentic native pronunciation audio chunks via HTML5 Audio with queue management.
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
    // Remove emojis and UI icons that cause speech artifacts
    .replace(/[🟢🟡🟠🔴🟣🟤🚨🔬🌫️📊🌡️🌙🏢🛡️🌀🏏🍵🩺💡🌐⏰📅👋🧮😄⚠️]/gu, "")
    // Collapse spacing
    .replace(/\n+/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Splits text into natural sentence chunks (under 160 characters)
 * for seamless cloud audio playback.
 */
function splitIntoAudioChunks(text: string, maxLen: number = 150): string[] {
  // Split on sentence terminators: . ? ! । (danda) and newlines
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
        // Break segment on commas or spaces if too long
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

let activeAudio: HTMLAudioElement | null = null;
let isAudioPlaying = false;

/**
 * Plays speech for English, Hindi, or Tamil text.
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

  const cleaned = cleanMarkdownForSpeech(rawText);
  if (!cleaned) {
    if (onEnd) onEnd();
    return () => {};
  }

  const langCode = language === "hi" ? "hi" : language === "ta" ? "ta" : "en";
  const targetLocale = language === "hi" ? "hi-IN" : language === "ta" ? "ta-IN" : "en-US";

  // Check if the browser has a native voice installed for this specific language
  let nativeVoice: SpeechSynthesisVoice | null = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    const voices = window.speechSynthesis.getVoices();
    nativeVoice =
      voices.find((v) => v.lang.toLowerCase().replace("_", "-") === targetLocale.toLowerCase()) ||
      voices.find((v) => v.lang.toLowerCase().startsWith(langCode)) ||
      null;
  }

  let cancelled = false;

  // 1. If native voice exists and works for Indic language or English, use SpeechSynthesis
  if (nativeVoice && (langCode === "en" || nativeVoice.lang.toLowerCase().startsWith(langCode))) {
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.voice = nativeVoice;
    utterance.lang = targetLocale;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      if (!cancelled && onStart) onStart();
    };
    utterance.onend = () => {
      if (!cancelled && onEnd) onEnd();
    };
    utterance.onerror = () => {
      if (!cancelled && onError) onError();
    };

    window.speechSynthesis.speak(utterance);

    return () => {
      cancelled = true;
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }

  // 2. High-Fidelity Native Cloud Speech Audio Fallback (For Hindi / Tamil on Windows/Edge/Chrome)
  const chunks = splitIntoAudioChunks(cleaned, 150);
  if (chunks.length === 0) {
    if (onEnd) onEnd();
    return () => {};
  }

  let currentChunkIndex = 0;
  isAudioPlaying = true;
  if (onStart) onStart();

  const playNextChunk = () => {
    if (cancelled || !isAudioPlaying) {
      if (onEnd) onEnd();
      return;
    }

    if (currentChunkIndex >= chunks.length) {
      isAudioPlaying = false;
      if (onEnd) onEnd();
      return;
    }

    const chunkText = chunks[currentChunkIndex];
    currentChunkIndex++;

    const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunkText)}&tl=${langCode}&client=tw-ob`;
    const audio = new Audio(audioUrl);
    activeAudio = audio;

    audio.onended = () => {
      playNextChunk();
    };

    audio.onerror = (e) => {
      console.warn(`[TTS Audio] Chunk ${currentChunkIndex} failed, continuing:`, e);
      playNextChunk();
    };

    audio.play().catch((playErr) => {
      console.warn("[TTS Audio] Play interrupted:", playErr);
      isAudioPlaying = false;
      if (onError) onError();
    });
  };

  playNextChunk();

  return () => {
    cancelled = true;
    isAudioPlaying = false;
    stopAllSpeech();
    if (onEnd) onEnd();
  };
}

export function stopAllSpeech() {
  isAudioPlaying = false;
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.currentTime = 0;
    } catch {
      // ignore
    }
    activeAudio = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

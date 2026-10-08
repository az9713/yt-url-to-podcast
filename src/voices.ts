export interface KokoroVoice {
  engine: "kokoro";
  langCode: string;
  voice: string;
}

export interface ChatterboxVoice {
  engine: "chatterbox";
  languageId: string;
}

export type VoiceRoute = KokoroVoice | ChatterboxVoice;

const KOKORO: Record<string, KokoroVoice> = {
  en: { engine: "kokoro", langCode: "a", voice: "af_heart" },
  "en-gb": { engine: "kokoro", langCode: "b", voice: "bf_emma" },
  es: { engine: "kokoro", langCode: "e", voice: "ef_dora" },
  fr: { engine: "kokoro", langCode: "f", voice: "ff_siwis" },
  hi: { engine: "kokoro", langCode: "h", voice: "hf_alpha" },
  it: { engine: "kokoro", langCode: "i", voice: "if_sara" },
  ja: { engine: "kokoro", langCode: "j", voice: "jf_alpha" },
  pt: { engine: "kokoro", langCode: "p", voice: "pf_dora" },
  zh: { engine: "kokoro", langCode: "z", voice: "zf_xiaobei" },
};

const CHATTERBOX = new Set([
  "ar",
  "da",
  "de",
  "el",
  "fi",
  "he",
  "ko",
  "ms",
  "nl",
  "no",
  "pl",
  "ru",
  "sv",
  "sw",
  "tr",
]);

const CHATTERBOX_ALIAS: Record<string, string> = {
  nb: "no",
  nn: "no",
  iw: "he",
};

export function canonicalLanguage(language: string): string {
  return language.trim().toLowerCase().replace(/_/g, "-");
}

export function routeVoice(language: string): VoiceRoute {
  const code = canonicalLanguage(language);
  if (code === "en-gb") return KOKORO["en-gb"];
  const base = code.split("-")[0];
  if (base === "en") return KOKORO.en;
  if (base === "cmn" || base === "yue") return KOKORO.zh;
  const kokoro = KOKORO[base];
  if (kokoro) return kokoro;
  const chatter = CHATTERBOX_ALIAS[base] ?? base;
  if (CHATTERBOX.has(chatter)) return { engine: "chatterbox", languageId: chatter };
  throw new Error(
    `No publishable local voice for "${language}". Kokoro covers en, es, fr, hi, it, ja, pt, and zh. Chatterbox covers ar, da, de, el, fi, he, ko, ms, nl, no, pl, ru, sv, sw, and tr. The HTML summary is still written.`,
  );
}

export interface ScriptSegment {
  text: string;
  chapter: string;
}

const CHAPTER = /^---\s*chapter:\s*(.+?)\s*---$/i;

export function scriptToSegments(script: string, maxChars: number): ScriptSegment[] {
  if (maxChars < 1) throw new Error("maxChars must be positive");
  const segments: ScriptSegment[] = [];
  let chapter = "Episode";
  const blocks = script
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("```"));

  const pushPiece = (text: string) => {
    let rest = text.trim();
    while (rest.length > maxChars) {
      let end = rest.lastIndexOf(" ", maxChars);
      if (end < maxChars * 0.5) end = maxChars;
      const piece = rest.slice(0, end).trim();
      if (piece) segments.push({ text: piece, chapter });
      rest = rest.slice(end).trim();
    }
    if (rest) segments.push({ text: rest, chapter });
  };

  for (const block of blocks) {
    const marker = block.match(CHAPTER);
    if (marker) {
      chapter = marker[1].trim() || chapter;
      continue;
    }
    pushPiece(block);
  }
  return segments;
}

export function spokenText(script: string): string {
  return scriptToSegments(script, 100_000)
    .map((segment) => segment.text)
    .join("\n");
}

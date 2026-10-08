export interface SummarySection {
  heading: string;
  paragraphs: string[];
}

export interface SummaryDocument {
  title: string;
  language: string;
  dek: string;
  rights: string;
  sections: SummarySection[];
}

export interface SummarySource {
  url: string;
  videoTitle: string;
  channel: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function summaryPlainText(document: SummaryDocument): string {
  const parts = [document.title, document.dek];
  for (const section of document.sections) {
    parts.push(section.heading, ...section.paragraphs);
  }
  return parts.filter((part) => part.trim().length > 0).join("\n");
}

export function renderHtml(document: SummaryDocument, source: SummarySource): string {
  const language = document.language || "en";
  const title = document.title.trim() || source.videoTitle || "Video summary";
  const sections = document.sections
    .map((section) => {
      const paragraphs = section.paragraphs
        .filter((paragraph) => paragraph.trim().length > 0)
        .map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`)
        .join("\n");
      return `<section>\n<h2>${escapeHtml(section.heading.trim())}</h2>\n${paragraphs}\n</section>`;
    })
    .join("\n");
  const channel = source.channel ? ` · ${escapeHtml(source.channel)}` : "";
  const rights = document.rights.trim() || "Publish this episode only if you have the rights to the source video.";

  return `<!DOCTYPE html>
<html lang="${escapeHtml(language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f4f1ea; color: #1c1915; font: 1.05rem/1.65 Georgia, "Iowan Old Style", Palatino, serif; }
  main { max-width: 40rem; margin: 0 auto; padding: 3rem 1.25rem 4rem; }
  header p, footer { font-family: "Segoe UI", sans-serif; font-size: 0.85rem; color: #5c564c; }
  header p { letter-spacing: 0.04em; text-transform: uppercase; }
  a { color: #1f4d3a; }
  h1 { font-weight: 600; font-size: 2rem; line-height: 1.2; margin: 0.4rem 0 1rem; }
  .dek { font-size: 1.15rem; }
  h2 { font-size: 1.25rem; margin: 2rem 0 0.5rem; }
  footer { margin-top: 3rem; }
</style>
</head>
<body>
<main>
<header>
<p>Summary of <a href="${escapeHtml(source.url)}">${escapeHtml(source.videoTitle || source.url)}</a>${channel}</p>
<h1>${escapeHtml(title)}</h1>
<p class="dek">${escapeHtml(document.dek.trim())}</p>
</header>
${sections}
<footer>
<p>${escapeHtml(rights)}</p>
<p>The audio episode is a separate spoken retelling. It is not a reading of this page.</p>
</footer>
</main>
</body>
</html>
`;
}

export function parseSummary(value: unknown): SummaryDocument {
  if (!value || typeof value !== "object") throw new Error("Summary JSON was not an object");
  const record = value as Record<string, unknown>;
  const sectionsRaw = Array.isArray(record.sections) ? record.sections : [];
  const sections: SummarySection[] = [];
  for (const entry of sectionsRaw) {
    if (!entry || typeof entry !== "object") continue;
    const section = entry as Record<string, unknown>;
    const heading = typeof section.heading === "string" ? section.heading : "";
    const paragraphs = Array.isArray(section.paragraphs)
      ? section.paragraphs.filter((paragraph): paragraph is string => typeof paragraph === "string")
      : [];
    if (heading.trim() || paragraphs.length > 0) sections.push({ heading, paragraphs });
  }
  if (sections.length === 0) throw new Error("Summary JSON had no sections");
  return {
    title: typeof record.title === "string" ? record.title : "",
    language: typeof record.language === "string" ? record.language : "en",
    dek: typeof record.dek === "string" ? record.dek : "",
    rights: typeof record.rights === "string" ? record.rights : "",
    sections,
  };
}

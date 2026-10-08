function subtitleLang(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const withoutExt = base.replace(/\.vtt$/i, "");
  const parts = withoutExt.split(".");
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

export function pickSubtitle(names: string[], language: string | null): string | null {
  if (names.length === 0) return null;
  const wanted = language?.toLowerCase() ?? "";
  const wantedBase = wanted.split("-")[0];
  if (!wantedBase) return names[0];

  const scored = names.map((name) => {
    const code = subtitleLang(name);
    const base = code.split("-")[0];
    let score = 0;
    if (wanted && code === wanted) score = 3;
    else if (code === wantedBase) score = 2;
    else if (base === wantedBase) score = 1;
    return { name, score };
  });
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored[0].score > 0 ? scored[0].name : names[0];
}

export function vttToText(raw: string): string {
  const lines: string[] = [];
  let previous = "";
  for (const original of raw.split(/\r?\n/)) {
    let line = original.trim();
    if (!line) continue;
    if (/^WEBVTT/i.test(line) || /^(NOTE|STYLE|Kind:|Language:)/i.test(line)) continue;
    if (line.includes("-->")) continue;
    if (/^\d+$/.test(line)) continue;
    line = line.replace(/<[^>]+>/g, "");
    line = line.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
    line = line.replace(/\s+/g, " ").trim();
    if (!line || line === previous) continue;
    previous = line;
    lines.push(line);
  }
  return lines.join("\n");
}

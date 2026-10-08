const ID = /^[A-Za-z0-9_-]{11}$/;

function idFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  const markers = new Set(["shorts", "embed", "live", "v"]);
  for (let i = 0; i < parts.length - 1; i++) {
    if (markers.has(parts[i]) && ID.test(parts[i + 1])) return parts[i + 1];
  }
  if (parts.length === 1 && ID.test(parts[0])) return parts[0];
  return null;
}

export function videoIdFromUrl(input: string): string | null {
  const trimmed = input.trim().replace(/^["']|["']$/g, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && ID.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    const fromQuery = url.searchParams.get("v");
    if (fromQuery && ID.test(fromQuery)) return fromQuery;
    return idFromPath(url.pathname);
  }
  return null;
}

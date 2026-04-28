const decodeFallbackEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

export const htmlToPlainText = (value: string | null | undefined): string => {
  if (!value) return "";

  const normalized = String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/div>/gi, "\n")
    .replace(/<div[^>]*>/gi, "");

  if (typeof window !== "undefined" && typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(normalized, "text/html");
    const text = doc.documentElement.textContent || doc.body.textContent || "";
    return text.replace(/\n{3,}/g, "\n\n").trim();
  }

  return decodeFallbackEntities(normalized.replace(/<[^>]*>/g, ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

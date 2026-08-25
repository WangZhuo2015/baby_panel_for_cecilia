import type { ImageContent } from "@earendil-works/pi-ai";

const DATA_URL = /^data:(image\/(?:png|jpe?g|webp|heic|heif));base64,([A-Za-z0-9+/=]+)$/i;

export function parseDataImage(raw: unknown): ImageContent | undefined {
  if (typeof raw !== "string" || raw.length > 16_000_000) return undefined;
  const match = raw.match(DATA_URL);
  if (!match) return undefined;
  return { type: "image", data: match[2], mimeType: match[1].toLowerCase() };
}

/**
 * Private images need the browser's cookies. Next's default image optimizer
 * does not forward authentication headers to its source image.
 * This is a rendering policy, not URL authorization; the API still checks ACLs.
 */
export function shouldBypassImageOptimization(src: string): boolean {
  if (src.startsWith("data:") || src.startsWith("blob:")) return true;
  if (!src.startsWith("/") && !/^https?:\/\//i.test(src)) return false;
  try {
    const path = new URL(src, "https://test-image.invalid").pathname;
    return ["/uploads/", "/api/attachments/", "/api/legacy-attachments/"]
      .some(prefix => path.startsWith(prefix));
  } catch { return false; }
}

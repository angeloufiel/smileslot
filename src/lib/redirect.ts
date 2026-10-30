/**
 * Only allow redirects to paths on this site. Blocks open-redirect tricks such as
 * ?next=https://evil.com, ?next=//evil.com and ?next=/\evil.com.
 */
export function safeNext(next: unknown, fallback: string): string {
  const value = typeof next === "string" ? next : "";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}

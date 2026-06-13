export function normalizeHttpOrigin(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Origin must be an HTTP or HTTPS origin without credentials, path, query, or hash");
  }
  return url.origin;
}

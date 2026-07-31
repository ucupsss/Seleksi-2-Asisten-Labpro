export const bearerPrefix = "Bearer ";

export function readBearerToken(header: string | undefined): string | null {
  if (!header || !header.startsWith(bearerPrefix)) {
    return null;
  }

  return header.slice(bearerPrefix.length);
}

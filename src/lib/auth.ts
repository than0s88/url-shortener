// Constant-time string comparison to avoid timing attacks on the admin password.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function checkBasicAuth(authHeader: string | null): boolean {
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPass = process.env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPass) return false;
  if (!authHeader?.startsWith("Basic ")) return false;

  let decoded: string;
  try {
    decoded = atob(authHeader.slice("Basic ".length).trim());
  } catch {
    return false;
  }

  const sepIndex = decoded.indexOf(":");
  if (sepIndex === -1) return false;

  const user = decoded.slice(0, sepIndex);
  const pass = decoded.slice(sepIndex + 1);
  return timingSafeEqual(user, expectedUser) && timingSafeEqual(pass, expectedPass);
}

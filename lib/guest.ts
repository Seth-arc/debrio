import { createHash, randomBytes } from "node:crypto";

// A guest's private credential: 256 random bits, held only in their browser's
// HttpOnly cookie. The database stores and compares its SHA-256 hash.
export const newGuestCredential = () => randomBytes(32).toString("base64url");

export const credentialHash = (credential: string) =>
  createHash("sha256").update(credential).digest("hex");

export const guestCookieName = (sessionId: string) => `dg_${sessionId}`;

export const GUEST_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  // The database decides validity (session state and 90-day retention); this
  // only bounds how long the browser keeps the cookie.
  maxAge: 100 * 24 * 60 * 60,
} as const;

export const isSessionId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

export const isJoinKey = (value: string) => /^[0-9a-f]{32}$/.test(value);

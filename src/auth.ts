import axios from "axios";
import crypto from "crypto";

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

// Scopes available on the LinkedIn API
export const LINKEDIN_SCOPES = [
  "openid",
  "profile",
  "email",
  "w_member_social",
].join(" ");

// In-memory token store keyed by session/state
// For production use a database or encrypted cookie
const tokenStore = new Map<string, TokenData>();

export interface TokenData {
  accessToken: string;
  expiresAt: number;
  profileId?: string;
}

export function generateAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: LINKEDIN_SCOPES,
  });
  return `${LINKEDIN_AUTH_URL}?${params}`;
}

export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await axios.post(LINKEDIN_TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return {
    accessToken: res.data.access_token,
    expiresIn: res.data.expires_in,
  };
}

export function storeToken(sessionId: string, data: TokenData): void {
  tokenStore.set(sessionId, data);
}

export function getToken(sessionId: string): TokenData | undefined {
  const token = tokenStore.get(sessionId);
  if (!token) return undefined;
  if (Date.now() > token.expiresAt) {
    tokenStore.delete(sessionId);
    return undefined;
  }
  return token;
}

export function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

// Single global token when using a personal access token from env
let globalToken: TokenData | null = null;

export function setGlobalToken(accessToken: string, expiresIn = 5184000): void {
  globalToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export function getGlobalToken(): TokenData | null {
  if (!globalToken) return null;
  if (Date.now() > globalToken.expiresAt) {
    globalToken = null;
    return null;
  }
  return globalToken;
}

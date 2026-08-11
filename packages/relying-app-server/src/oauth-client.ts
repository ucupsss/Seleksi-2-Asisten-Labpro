import type { TokenResponse, UserInfoResponse } from "@sso/shared";
import { readBearerToken } from "@sso/shared";
import { HttpError } from "./errors.js";

export interface OAuthClient {
  exchangeCode(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<TokenResponse>;
  getUserInfo(accessToken: string): Promise<UserInfoResponse>;
}

export function createOAuthClient(authBaseUrl: string): OAuthClient {
  return {
    async exchangeCode(input) {
      const response = await fetch(new URL("/oauth/token", authBaseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code: input.code,
          client_id: input.clientId,
          redirect_uri: input.redirectUri,
          code_verifier: input.codeVerifier,
        }),
      });

      if (!response.ok) {
        throw new HttpError(502, "INTERNAL_ERROR", "Gagal menukar OAuth code");
      }

      return response.json() as Promise<TokenResponse>;
    },

    async getUserInfo(accessToken) {
      if (!readBearerToken(`Bearer ${accessToken}`)) {
        throw new HttpError(401, "UNAUTHORIZED", "Access token tidak valid");
      }

      const response = await fetch(new URL("/oauth/userinfo", authBaseUrl), {
        headers: { authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new HttpError(502, "INTERNAL_ERROR", "Gagal membaca userinfo");
      }

      return response.json() as Promise<UserInfoResponse>;
    },
  };
}

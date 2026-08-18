import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HttpError } from "../errors.js";
import type { OauthRepository } from "../services/oauth.service.js";
import { createOauthService } from "../services/oauth.service.js";
import type { PolicyService } from "../services/policy.service.js";

const user = {
  id: "user-1",
  name: "Student User",
  email: "student@example.com",
  status: "active" as const,
};

const application = {
  id: "app-1",
  name: "App A",
  clientId: "app-a-client",
  status: "active" as const,
};

function s256(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function createPolicyService(): PolicyService {
  return {
    evaluateApplicationAccess: async () => ({
      allowed: true,
      user,
      application,
    }),
  };
}

function createRepository() {
  const codes = new Map<
    string,
    {
      id: string;
      codeHash: string;
      userId: string;
      applicationId: string;
      ssoSessionId: string;
      redirectUri: string;
      codeChallenge: string;
      expiresAt: Date;
      usedAt: Date | null;
      application: typeof application;
      user: typeof user;
      ssoSession: {
        id: string;
        status: "active";
        expiresAt: Date;
        revokedAt: null;
      };
    }
  >();
  const tokens = new Map<
    string,
    {
      tokenHash: string;
      userId: string;
      applicationId: string;
      ssoSessionId: string;
      expiresAt: Date;
      status: "active";
      application: typeof application;
      user: typeof user;
      ssoSession: {
        id: string;
        status: "active";
        expiresAt: Date;
        revokedAt: null;
      };
      groups: string[];
    }
  >();
  const issuedTokens: string[] = [];
  let transactionQueue = Promise.resolve();

  const repository: OauthRepository = {
    async withTransaction(work) {
      const previousTransaction = transactionQueue;
      let releaseTransaction = () => {};
      transactionQueue = new Promise<void>((resolve) => {
        releaseTransaction = resolve;
      });
      await previousTransaction;

      const usedAtSnapshot = new Map(
        [...codes].map(([hash, code]) => [hash, code.usedAt]),
      );
      const tokenSnapshot = new Map(tokens);
      const issuedTokenCount = issuedTokens.length;
      try {
        return await work(repository);
      } catch (error) {
        for (const [hash, usedAt] of usedAtSnapshot) {
          const code = codes.get(hash);
          if (code) code.usedAt = usedAt;
        }
        tokens.clear();
        for (const [hash, token] of tokenSnapshot) tokens.set(hash, token);
        issuedTokens.length = issuedTokenCount;
        throw error;
      } finally {
        releaseTransaction();
      }
    },
    createAuthorizationCode: async (input) => {
      const code = {
        id: "code-1",
        codeHash: input.codeHash,
        userId: input.userId,
        applicationId: input.applicationId,
        ssoSessionId: input.ssoSessionId,
        redirectUri: input.redirectUri,
        codeChallenge: input.codeChallenge,
        expiresAt: input.expiresAt,
        usedAt: null,
        application,
        user,
        ssoSession: {
          id: input.ssoSessionId,
          status: "active" as const,
          expiresAt: new Date("2026-08-09T12:00:00.000Z"),
          revokedAt: null,
        },
      };
      codes.set(input.codeHash, code);
      return code;
    },
    findAuthorizationCodeByHash: async (codeHash) => codes.get(codeHash) ?? null,
    consumeAuthorizationCode: async (id, usedAt) => {
      for (const code of codes.values()) {
        if (code.id === id && code.usedAt === null) {
          code.usedAt = usedAt;
          return true;
        }
      }
      return false;
    },
    createAccessToken: async (input) => {
      const token = {
        tokenHash: input.tokenHash,
        userId: input.userId,
        applicationId: input.applicationId,
        ssoSessionId: input.ssoSessionId,
        expiresAt: input.expiresAt,
        status: "active" as const,
        application,
        user,
        ssoSession: {
          id: input.ssoSessionId,
          status: "active" as const,
          expiresAt: new Date("2026-08-09T12:00:00.000Z"),
          revokedAt: null,
        },
        groups: ["app-a-users"],
      };
      tokens.set(input.tokenHash, token);
      issuedTokens.push(input.tokenHash);
      return token;
    },
    findAccessTokenByHash: async (tokenHash) => tokens.get(tokenHash) ?? null,
    findUserGroups: async () => ["app-a-users"],
    createAuditLog: async () => {},
  };

  return { repository, codes, tokens, issuedTokens };
}

function createService(repository: OauthRepository) {
  return createOauthService({
    repository,
    policyService: createPolicyService(),
    generateCode: () => "raw-code",
    generateToken: () => "raw-access-token",
    now: () => new Date("2026-08-09T10:00:00.000Z"),
    authorizationCodeTtlMinutes: 5,
    accessTokenTtlMinutes: 30,
  });
}

describe("oauth service", () => {
  it("creates one-time authorization code for allowed request", async () => {
    const { repository, codes } = createRepository();
    const service = createService(repository);

    const result = await service.createAuthorizationCode({
      userId: "user-1",
      ssoSessionId: "session-1",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      state: "state-1",
      codeChallenge: s256("verifier-1"),
    });

    expect(result).toEqual({
      code: "raw-code",
      redirectTo:
        "http://localhost:4101/auth/callback?code=raw-code&state=state-1",
    });
    expect(codes.size).toBe(1);
  });

  it("exchanges valid code for opaque token", async () => {
    const { repository } = createRepository();
    const service = createService(repository);

    await service.createAuthorizationCode({
      userId: "user-1",
      ssoSessionId: "session-1",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      state: "state-1",
      codeChallenge: s256("verifier-1"),
    });

    const token = await service.exchangeAuthorizationCode({
      code: "raw-code",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      codeVerifier: "verifier-1",
    });

    expect(token).toEqual({
      access_token: "raw-access-token",
      token_type: "Bearer",
      expires_in: 1800,
    });
  });

  it("rejects reused code", async () => {
    const { repository } = createRepository();
    const service = createService(repository);

    await service.createAuthorizationCode({
      userId: "user-1",
      ssoSessionId: "session-1",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      state: "state-1",
      codeChallenge: s256("verifier-1"),
    });
    await service.exchangeAuthorizationCode({
      code: "raw-code",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      codeVerifier: "verifier-1",
    });

    await expect(
      service.exchangeAuthorizationCode({
        code: "raw-code",
        clientId: "app-a-client",
        redirectUri: "http://localhost:4101/auth/callback",
        codeVerifier: "verifier-1",
      }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("allows only one token when the same code is exchanged concurrently", async () => {
    const { repository, issuedTokens } = createRepository();
    const service = createService(repository);

    await service.createAuthorizationCode({
      userId: "user-1",
      ssoSessionId: "session-1",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      state: "state-1",
      codeChallenge: s256("verifier-1"),
    });
    const exchange = () =>
      service.exchangeAuthorizationCode({
        code: "raw-code",
        clientId: "app-a-client",
        redirectUri: "http://localhost:4101/auth/callback",
        codeVerifier: "verifier-1",
      });

    const results = await Promise.allSettled([exchange(), exchange()]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(issuedTokens).toHaveLength(1);
  });

  it("rolls back code consumption when token issuance fails", async () => {
    const { repository, codes } = createRepository();
    const service = createService(repository);
    const createAccessToken = repository.createAccessToken;
    let shouldFail = true;
    repository.createAccessToken = async (input) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("token insert failed");
      }
      return createAccessToken(input);
    };

    await service.createAuthorizationCode({
      userId: "user-1",
      ssoSessionId: "session-1",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      state: "state-1",
      codeChallenge: s256("verifier-1"),
    });
    const exchange = () =>
      service.exchangeAuthorizationCode({
        code: "raw-code",
        clientId: "app-a-client",
        redirectUri: "http://localhost:4101/auth/callback",
        codeVerifier: "verifier-1",
      });

    await expect(exchange()).rejects.toThrow("token insert failed");
    expect([...codes.values()][0]?.usedAt).toBeNull();
    await expect(exchange()).resolves.toMatchObject({
      access_token: "raw-access-token",
    });
  });

  it("rejects invalid pkce verifier", async () => {
    const { repository } = createRepository();
    const service = createService(repository);

    await service.createAuthorizationCode({
      userId: "user-1",
      ssoSessionId: "session-1",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      state: "state-1",
      codeChallenge: s256("verifier-1"),
    });

    await expect(
      service.exchangeAuthorizationCode({
        code: "raw-code",
        clientId: "app-a-client",
        redirectUri: "http://localhost:4101/auth/callback",
        codeVerifier: "wrong-verifier",
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_GRANT",
    });
  });

  it("rejects exchange when the application becomes inactive", async () => {
    const { repository, codes } = createRepository();
    const service = createService(repository);
    await service.createAuthorizationCode({
      userId: "user-1",
      ssoSessionId: "session-1",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      state: "state-1",
      codeChallenge: s256("verifier-1"),
    });
    const storedApplication = [...codes.values()][0]!.application as {
      status: "active" | "inactive";
    };
    storedApplication.status = "inactive";

    await expect(
      service.exchangeAuthorizationCode({
        code: "raw-code",
        clientId: "app-a-client",
        redirectUri: "http://localhost:4101/auth/callback",
        codeVerifier: "verifier-1",
      }),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_GRANT" });
    storedApplication.status = "active";
  });

  it("returns userinfo for valid token", async () => {
    const { repository } = createRepository();
    const service = createService(repository);

    await service.createAuthorizationCode({
      userId: "user-1",
      ssoSessionId: "session-1",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      state: "state-1",
      codeChallenge: s256("verifier-1"),
    });
    await service.exchangeAuthorizationCode({
      code: "raw-code",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      codeVerifier: "verifier-1",
    });

    await expect(service.getUserInfo("raw-access-token")).resolves.toEqual({
      sub: "user-1",
      name: "Student User",
      email: "student@example.com",
      groups: ["app-a-users"],
      centralSessionId: "session-1",
    });
  });
});

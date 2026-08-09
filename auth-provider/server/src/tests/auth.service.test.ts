import { describe, expect, it } from "vitest";
import { HttpError } from "../errors.js";
import type { AuthRepository } from "../services/auth.service.js";
import { createAuthService } from "../services/auth.service.js";

const activeUser = {
  id: "user-1",
  name: "Student User",
  email: "student@example.com",
  passwordHash: "hashed-password",
  status: "active" as const,
};

function createRepository(overrides: Partial<AuthRepository> = {}) {
  const sessions: Array<{
    id: string;
    userId: string;
    sessionTokenHash: string;
    expiresAt: Date;
  }> = [];
  const auditLogs: Array<{ eventType: string; result: string }> = [];

  const repository: AuthRepository = {
    findUserByEmail: async (email) =>
      email === activeUser.email ? activeUser : null,
    createSsoSession: async (input) => {
      const session = {
        id: `session-${sessions.length + 1}`,
        userId: input.userId,
        sessionTokenHash: input.sessionTokenHash,
        expiresAt: input.expiresAt,
      };
      sessions.push(session);
      return session;
    },
    findActiveSsoSessionByHash: async (sessionTokenHash) => {
      const session = sessions.find(
        (candidate) => candidate.sessionTokenHash === sessionTokenHash,
      );

      if (!session) return null;

      return {
        id: session.id,
        userId: session.userId,
        status: "active",
        expiresAt: session.expiresAt,
        revokedAt: null,
        user: activeUser,
      };
    },
    revokeSsoSessionByHash: async (sessionTokenHash, reason) => {
      const session = sessions.find(
        (candidate) => candidate.sessionTokenHash === sessionTokenHash,
      );
      return session
        ? { id: session.id, revokedAt: new Date("2026-08-09T10:00:00.000Z"), reason }
        : null;
    },
    createAuditLog: async (input) => {
      auditLogs.push({
        eventType: input.eventType,
        result: input.result,
      });
    },
    ...overrides,
  };

  return { repository, sessions, auditLogs };
}

function createService(repository: AuthRepository) {
  return createAuthService({
    repository,
    comparePassword: async (plainPassword, passwordHash) =>
      plainPassword === "password123" && passwordHash === "hashed-password",
    generateToken: () => "raw-session-token",
    now: () => new Date("2026-08-09T10:00:00.000Z"),
    sessionTtlMinutes: 60,
  });
}

describe("auth service", () => {
  it("creates central session for active user with correct password", async () => {
    const { repository, sessions, auditLogs } = createRepository();
    const service = createService(repository);

    const result = await service.loginWithPassword({
      email: "student@example.com",
      password: "password123",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });

    expect(result.sessionToken).toBe("raw-session-token");
    expect(result.user).toEqual({
      id: "user-1",
      name: "Student User",
      email: "student@example.com",
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionTokenHash).toBe(
      "e6c276c51996dfa4b71f39f34f5f1a5a8f116e29eb538fab6403dd689631c622",
    );
    expect(sessions[0]?.expiresAt.toISOString()).toBe(
      "2026-08-09T11:00:00.000Z",
    );
    expect(auditLogs).toContainEqual({
      eventType: "login_success",
      result: "success",
    });
  });

  it("rejects wrong password with generic error and audit log", async () => {
    const { repository, auditLogs } = createRepository();
    const service = createService(repository);

    await expect(
      service.loginWithPassword({
        email: "student@example.com",
        password: "wrong-password",
      }),
    ).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "Email atau password tidak valid",
    });
    expect(auditLogs).toContainEqual({
      eventType: "login_failed",
      result: "failed",
    });
  });

  it("rejects inactive users", async () => {
    const { repository } = createRepository({
      findUserByEmail: async () => ({
        ...activeUser,
        status: "inactive",
      }),
    });
    const service = createService(repository);

    await expect(
      service.loginWithPassword({
        email: "student@example.com",
        password: "password123",
      }),
    ).rejects.toBeInstanceOf(HttpError);
    await expect(
      service.loginWithPassword({
        email: "student@example.com",
        password: "password123",
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "User tidak aktif",
    });
  });

  it("returns current central session from a valid raw session token", async () => {
    const { repository } = createRepository();
    const service = createService(repository);

    await service.loginWithPassword({
      email: "student@example.com",
      password: "password123",
    });

    const session = await service.getCurrentSsoSession("raw-session-token");

    expect(session).toEqual({
      id: "session-1",
      user: {
        id: "user-1",
        name: "Student User",
        email: "student@example.com",
      },
    });
  });
});

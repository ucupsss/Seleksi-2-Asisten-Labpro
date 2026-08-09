import { describe, expect, it } from "vitest";
import type { PolicyRepository } from "../services/policy.service.js";
import { createPolicyService } from "../services/policy.service.js";

const activeUser = {
  id: "user-1",
  name: "Student User",
  email: "student@example.com",
  status: "active" as const,
};

const activeApplication = {
  id: "app-1",
  name: "App A",
  clientId: "app-a-client",
  status: "active" as const,
};

function createRepository(
  overrides: Partial<PolicyRepository> = {},
): PolicyRepository {
  return {
    findUserById: async () => activeUser,
    findApplicationByClientId: async () => activeApplication,
    hasRedirectUri: async () => true,
    findUserGroupIds: async () => ["group-app-a"],
    hasAllowPolicyForGroups: async () => true,
    createAuditLog: async () => {},
    ...overrides,
  };
}

describe("policy service", () => {
  it("allows active user with allowed group for active app and exact redirect uri", async () => {
    const service = createPolicyService({
      repository: createRepository(),
    });

    const decision = await service.evaluateApplicationAccess({
      userId: "user-1",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
    });

    expect(decision).toEqual({
      allowed: true,
      user: activeUser,
      application: activeApplication,
    });
  });

  it("denies inactive user", async () => {
    const service = createPolicyService({
      repository: createRepository({
        findUserById: async () => ({
          ...activeUser,
          status: "inactive",
        }),
      }),
    });

    const decision = await service.evaluateApplicationAccess({
      userId: "user-1",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "user_inactive",
    });
  });

  it("denies inactive app", async () => {
    const service = createPolicyService({
      repository: createRepository({
        findApplicationByClientId: async () => ({
          ...activeApplication,
          status: "inactive",
        }),
      }),
    });

    const decision = await service.evaluateApplicationAccess({
      userId: "user-1",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "application_inactive",
    });
  });

  it("denies exact redirect uri mismatch", async () => {
    const service = createPolicyService({
      repository: createRepository({
        hasRedirectUri: async () => false,
      }),
    });

    const decision = await service.evaluateApplicationAccess({
      userId: "user-1",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback/extra",
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "redirect_uri_mismatch",
    });
  });

  it("denies user without allowed group", async () => {
    const service = createPolicyService({
      repository: createRepository({
        hasAllowPolicyForGroups: async () => false,
      }),
    });

    const decision = await service.evaluateApplicationAccess({
      userId: "user-1",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "missing_allow_policy",
    });
  });
});

import request from "supertest";
import { describe, expect, it } from "vitest";
import { createAuthApp } from "../app.js";
import type { AuthService } from "../services/auth.service.js";
import type { SsoSessionContext } from "../services/auth.service.js";
import type { AdminService } from "../services/admin.service.js";
import type { OauthService } from "../services/oauth.service.js";
import { testAuthConfig } from "./test-config.js";

function createFakeAuthService(
  currentSession: SsoSessionContext | null = {
    id: "admin-session",
    user: {
      id: "admin-1",
      name: "Admin User",
      email: "admin@example.com",
      groups: ["administrators"],
    },
  },
  onSessionToken?: (sessionToken: string | undefined) => void,
): AuthService {
  return {
    loginWithPassword: async () => {
      throw new Error("unused");
    },
    getCurrentSsoSession: async (sessionToken) => {
      onSessionToken?.(sessionToken);
      return currentSession;
    },
    logout: async () => {},
  };
}

function createFakeOauthService(): OauthService {
  return {
    createAuthorizationCode: async () => {
      throw new Error("unused");
    },
    exchangeAuthorizationCode: async () => {
      throw new Error("unused");
    },
    getUserInfo: async () => {
      throw new Error("unused");
    },
  };
}

function createFakeAdminService(): AdminService {
  return {
    listUsers: async () => [
      {
        id: "user-1",
        name: "Student User",
        email: "student@example.com",
        status: "active",
      },
    ],
    createUser: async (input) => ({
      id: "user-2",
      name: input.name,
      email: input.email,
      status: input.status ?? "active",
    }),
    updateUser: async (id, input) => ({
      id,
      name: input.name ?? "Student User",
      email: input.email ?? "student@example.com",
      status: input.status ?? "active",
    }),
    listGroups: async () => [
      {
        id: "group-1",
        name: "app-a-users",
        description: "Users allowed to open App A",
      },
    ],
    createGroup: async (input) => ({
      id: "group-2",
      name: input.name,
      description: input.description ?? null,
    }),
    updateGroup: async (id, input) => ({
      id,
      name: input.name ?? "app-a-users",
      description: input.description ?? null,
    }),
    addUserToGroup: async () => {},
    removeUserFromGroup: async () => {},
    listMemberships: async () => [
      { userId: "user-1", groupId: "group-1" },
    ],
    listApplications: async () => [
      {
        id: "app-1",
        name: "App A",
        clientId: "app-a-client",
        status: "active",
        launchUrl: null,
        logoutNotificationUrl: "http://localhost:4101/auth/logout-events",
        redirectUris: ["http://localhost:4101/auth/callback"],
      },
    ],
    createApplication: async (input) => ({
      id: "app-2",
      name: input.name,
      clientId: input.clientId,
      status: input.status ?? "active",
      launchUrl: input.launchUrl ?? null,
      logoutNotificationUrl: input.logoutNotificationUrl,
      redirectUris: [input.redirectUri],
    }),
    updateApplication: async (id, input) => ({
      id,
      name: input.name ?? "App A",
      clientId: "app-a-client",
      status: input.status ?? "active",
      launchUrl: input.launchUrl ?? null,
      logoutNotificationUrl:
        input.logoutNotificationUrl ?? "http://localhost:4101/internal/logout",
      redirectUris: [
        input.redirectUri ?? "http://localhost:4101/auth/callback",
      ],
    }),
    addApplicationPolicy: async () => {},
    removeApplicationPolicy: async () => {},
    listApplicationPolicies: async () => [
      { applicationId: "app-1", groupId: "group-1", effect: "allow" },
    ],
    listAuditLogs: async () => [
      {
        id: "audit-1",
        eventType: "admin_user_created",
        result: "success",
        createdAt: new Date("2026-08-09T10:00:00.000Z"),
      },
    ],
    listEvents: async () => [
      {
        id: "event-1",
        eventType: "PasswordChanged",
        status: "pending",
        createdAt: new Date("2026-08-09T10:00:00.000Z"),
      },
    ],
  };
}

function createApp(authService = createFakeAuthService()) {
  return createAuthApp({
    config: testAuthConfig,
    authService,
    oauthService: createFakeOauthService(),
    adminService: createFakeAdminService(),
  });
}

describe("admin routes", () => {
  it("rejects an anonymous admin API request", async () => {
    const response = await request(createApp(createFakeAuthService(null))).get(
      "/admin/users",
    );

    expect(response.status).toBe(401);
    expect(response.body.error).toMatchObject({
      code: "UNAUTHORIZED",
      message: "Autentikasi diperlukan",
    });
  });

  it("rejects an authenticated user outside the administrators group", async () => {
    const response = await request(
      createApp(
        createFakeAuthService({
          id: "student-session",
          user: {
            id: "user-1",
            name: "Student User",
            email: "student@example.com",
            groups: ["app-a-users"],
          },
        }),
      ),
    ).get("/admin/users");

    expect(response.status).toBe(403);
    expect(response.body.error).toMatchObject({
      code: "FORBIDDEN",
      message: "Akses administrator diperlukan",
    });
  });

  it("returns the administrator session and reads the central cookie", async () => {
    let receivedSessionToken: string | undefined;
    const response = await request(
      createApp(
        createFakeAuthService(undefined, (sessionToken) => {
          receivedSessionToken = sessionToken;
        }),
      ),
    )
      .get("/admin/session")
      .set("Cookie", ["sso_session=admin-token"]);

    expect(response.status).toBe(200);
    expect(receivedSessionToken).toBe("admin-token");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.session.user).toMatchObject({
      email: "admin@example.com",
      groups: ["administrators"],
    });
  });

  it("returns users for control panel", async () => {
    const response = await request(createApp()).get("/admin/users");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      users: [
        {
          id: "user-1",
          name: "Student User",
          email: "student@example.com",
          status: "active",
        },
      ],
    });
  });

  it("creates user through control panel", async () => {
    const response = await request(createApp()).post("/admin/users").send({
      name: "New User",
      email: "new@example.com",
      password: "password123",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      user: {
        id: "user-2",
        name: "New User",
        email: "new@example.com",
        status: "active",
      },
    });
  });

  it("creates application allow policy for group", async () => {
    const response = await request(createApp())
      .post("/admin/applications/app-1/policies")
      .send({ groupId: "group-1" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ policy: { effect: "allow" } });
  });

  it("updates groups and application status through the control panel", async () => {
    const [group, application] = await Promise.all([
      request(createApp())
        .patch("/admin/groups/group-1")
        .send({ name: "renamed-group" }),
      request(createApp())
        .patch("/admin/applications/app-1")
        .send({ status: "inactive" }),
    ]);

    expect(group.status).toBe(200);
    expect(group.body.group.name).toBe("renamed-group");
    expect(application.status).toBe(200);
    expect(application.body.application.status).toBe("inactive");
  });

  it("removes memberships and policies through the control panel", async () => {
    const [membership, policy] = await Promise.all([
      request(createApp()).delete("/admin/groups/group-1/users/user-1"),
      request(createApp()).delete(
        "/admin/applications/app-1/policies/group-1",
      ),
    ]);

    expect(membership.status).toBe(204);
    expect(policy.status).toBe(204);
  });

  it("returns memberships and actual policies", async () => {
    const [membership, policy] = await Promise.all([
      request(createApp()).get("/admin/memberships"),
      request(createApp()).get("/admin/policies"),
    ]);

    expect(membership.body.memberships).toEqual([
      { userId: "user-1", groupId: "group-1" },
    ]);
    expect(policy.body.policies).toEqual([
      { applicationId: "app-1", groupId: "group-1", effect: "allow" },
    ]);
  });

  it("returns audit logs and events for operator visibility", async () => {
    const [auditResponse, eventResponse] = await Promise.all([
      request(createApp()).get("/admin/audit-logs"),
      request(createApp()).get("/admin/events"),
    ]);

    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.auditLogs).toHaveLength(1);
    expect(eventResponse.status).toBe(200);
    expect(eventResponse.body.events).toHaveLength(1);
  });
});

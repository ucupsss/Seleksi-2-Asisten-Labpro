import request from "supertest";
import { describe, expect, it } from "vitest";
import { createAuthApp } from "../app.js";
import type { AuthService } from "../services/auth.service.js";
import type { AdminService } from "../services/admin.service.js";
import type { OauthService } from "../services/oauth.service.js";

function createFakeAuthService(): AuthService {
  return {
    loginWithPassword: async () => {
      throw new Error("unused");
    },
    getCurrentSsoSession: async () => null,
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
    addUserToGroup: async () => {},
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
    addApplicationPolicy: async () => {},
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

function createApp() {
  return createAuthApp({
    authService: createFakeAuthService(),
    oauthService: createFakeOauthService(),
    adminService: createFakeAdminService(),
  });
}

describe("admin routes", () => {
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

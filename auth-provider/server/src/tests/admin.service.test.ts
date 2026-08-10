import { describe, expect, it } from "vitest";
import { HttpError } from "../errors.js";
import type {
  AdminRepository,
  AdminUserRecord,
  ApplicationSummary,
  GroupSummary,
} from "../services/admin.service.js";
import { createAdminService } from "../services/admin.service.js";

function createRepository() {
  const users = new Map<string, AdminUserRecord>();
  const groups = new Map<string, GroupSummary>();
  const applications = new Map<string, ApplicationSummary>();
  const auditLogs: Array<{ eventType: string; result: string }> = [];
  const events: Array<{ eventType: string; userId?: string }> = [];
  const revokedSessions: Array<{ userId: string; reason: string }> = [];
  const userGroups = new Set<string>();
  const applicationPolicies = new Set<string>();

  const repository: AdminRepository = {
    listUsers: async () => [...users.values()],
    findUserByEmail: async (email) =>
      [...users.values()].find((user) => user.email === email) ?? null,
    createUser: async (input) => {
      const user = {
        id: `user-${users.size + 1}`,
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
        status: input.status ?? "active",
      };
      users.set(user.id, user);
      return user;
    },
    updateUser: async (id, input) => {
      const user = users.get(id);
      if (!user) return null;

      const updated = {
        ...user,
        name: input.name ?? user.name,
        email: input.email ?? user.email,
        status: input.status ?? user.status,
        passwordHash: input.passwordHash ?? user.passwordHash,
      };
      users.set(id, updated);
      return updated;
    },
    revokeActiveSessionsForUser: async (userId, reason) => {
      revokedSessions.push({ userId, reason });
    },
    listGroups: async () => [...groups.values()],
    findGroupByName: async (name) =>
      [...groups.values()].find((group) => group.name === name) ?? null,
    createGroup: async (input) => {
      const group = {
        id: `group-${groups.size + 1}`,
        name: input.name,
        description: input.description ?? null,
      };
      groups.set(group.id, group);
      return group;
    },
    addUserToGroup: async (userId, groupId) => {
      userGroups.add(`${userId}:${groupId}`);
    },
    listApplications: async () => [...applications.values()],
    findApplicationByClientId: async (clientId) =>
      [...applications.values()].find((app) => app.clientId === clientId) ??
      null,
    createApplication: async (input) => {
      const application = {
        id: `app-${applications.size + 1}`,
        name: input.name,
        clientId: input.clientId,
        status: input.status ?? "active",
        launchUrl: input.launchUrl ?? null,
        logoutNotificationUrl: input.logoutNotificationUrl,
        redirectUris: [input.redirectUri],
      };
      applications.set(application.id, application);
      return application;
    },
    addApplicationPolicy: async (applicationId, groupId) => {
      applicationPolicies.add(`${applicationId}:${groupId}:allow`);
    },
    createAuditLog: async (input) => {
      auditLogs.push({ eventType: input.eventType, result: input.result });
    },
    createEvent: async (input) => {
      events.push({ eventType: input.eventType, userId: input.userId });
    },
    listAuditLogs: async () =>
      auditLogs.map((log, index) => ({
        id: `audit-${index + 1}`,
        eventType: log.eventType,
        result: log.result,
        createdAt: new Date("2026-08-09T10:00:00.000Z"),
      })),
    listEvents: async () =>
      events.map((event, index) => ({
        id: `event-${index + 1}`,
        eventType: event.eventType,
        status: "pending",
        createdAt: new Date("2026-08-09T10:00:00.000Z"),
      })),
  };

  return {
    repository,
    users,
    groups,
    applications,
    auditLogs,
    events,
    revokedSessions,
    userGroups,
    applicationPolicies,
  };
}

function createService(repository: AdminRepository) {
  return createAdminService({
    repository,
    hashPassword: async (plainPassword) => `hashed:${plainPassword}`,
    now: () => new Date("2026-08-09T10:00:00.000Z"),
  });
}

describe("admin service", () => {
  it("creates user with hashed password and hides password hash", async () => {
    const { repository, users, auditLogs } = createRepository();
    const service = createService(repository);

    const user = await service.createUser({
      name: "Student User",
      email: "student@example.com",
      password: "password123",
    });

    expect(user).toEqual({
      id: "user-1",
      name: "Student User",
      email: "student@example.com",
      status: "active",
    });
    expect(users.get("user-1")?.passwordHash).toBe("hashed:password123");
    expect(auditLogs).toContainEqual({
      eventType: "admin_user_created",
      result: "success",
    });
  });

  it("rejects duplicate user email", async () => {
    const { repository } = createRepository();
    const service = createService(repository);

    await service.createUser({
      name: "Student User",
      email: "student@example.com",
      password: "password123",
    });

    await expect(
      service.createUser({
        name: "Another User",
        email: "student@example.com",
        password: "password456",
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_REQUEST",
    });
  });

  it("revokes active sessions and emits event when password changes", async () => {
    const { repository, events, revokedSessions, users } = createRepository();
    const service = createService(repository);

    await service.createUser({
      name: "Student User",
      email: "student@example.com",
      password: "password123",
    });
    const updated = await service.updateUser("user-1", {
      password: "new-password",
    });

    expect(updated).toMatchObject({ id: "user-1", email: "student@example.com" });
    expect(users.get("user-1")?.passwordHash).toBe("hashed:new-password");
    expect(revokedSessions).toEqual([
      { userId: "user-1", reason: "password_changed" },
    ]);
    expect(events).toContainEqual({
      eventType: "PasswordChanged",
      userId: "user-1",
    });
  });

  it("throws not found when updating missing user", async () => {
    const { repository } = createRepository();
    const service = createService(repository);

    await expect(service.updateUser("missing-user", { status: "inactive" }))
      .rejects.toBeInstanceOf(HttpError);
  });

  it("creates group and adds user membership idempotently", async () => {
    const { repository, userGroups } = createRepository();
    const service = createService(repository);

    await service.createUser({
      name: "Student User",
      email: "student@example.com",
      password: "password123",
    });
    const group = await service.createGroup({
      name: "app-a-users",
      description: "Users allowed to open App A",
    });
    await service.addUserToGroup({ userId: "user-1", groupId: group.id });
    await service.addUserToGroup({ userId: "user-1", groupId: group.id });

    expect(group).toEqual({
      id: "group-1",
      name: "app-a-users",
      description: "Users allowed to open App A",
    });
    expect(userGroups).toEqual(new Set(["user-1:group-1"]));
  });

  it("creates application and allow policy for a group", async () => {
    const { repository, applicationPolicies } = createRepository();
    const service = createService(repository);

    const group = await service.createGroup({ name: "app-a-users" });
    const application = await service.createApplication({
      name: "App A",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      logoutNotificationUrl: "http://localhost:4101/auth/logout-events",
    });
    await service.addApplicationPolicy({
      applicationId: application.id,
      groupId: group.id,
    });

    expect(application).toEqual({
      id: "app-1",
      name: "App A",
      clientId: "app-a-client",
      status: "active",
      launchUrl: null,
      logoutNotificationUrl: "http://localhost:4101/auth/logout-events",
      redirectUris: ["http://localhost:4101/auth/callback"],
    });
    expect(applicationPolicies).toEqual(new Set(["app-1:group-1:allow"]));
  });
});

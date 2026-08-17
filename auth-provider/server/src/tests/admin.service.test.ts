import { describe, expect, it } from "vitest";
import type { RevocationEventPayload } from "@sso/shared";
import { HttpError } from "../errors.js";
import type {
  AdminRepository,
  AdminUserRecord,
  ApplicationSummary,
  ApplicationPolicySummary,
  GroupSummary,
  MembershipSummary,
} from "../services/admin.service.js";
import { createAdminService } from "../services/admin.service.js";

function createRepository() {
  const users = new Map<string, AdminUserRecord>();
  const groups = new Map<string, GroupSummary>();
  const applications = new Map<string, ApplicationSummary>();
  const auditLogs: Array<{ eventType: string; result: string }> = [];
  const events: Array<{
    id: string;
    eventType: string;
    userId: string;
    centralSessionId?: string | null;
    applicationId?: string | null;
    payload: RevocationEventPayload;
  }> = [];
  const eventDeliveries: Array<{ eventId: string; applicationId: string }> = [];
  const revokedSessions: Array<{
    userId: string;
    reason: string;
    revokedAt: Date;
  }> = [];
  const userGroups = new Set<string>();
  const applicationPolicies = new Set<string>();
  const activeSessions = new Map<string, string[]>();
  const revokedApplicationTokens: Array<{
    userId: string;
    applicationId: string;
    revokedAt: Date;
  }> = [];
  let transactionCount = 0;
  let failEventDelivery = false;

  const repository: AdminRepository = {
    withTransaction: async (work) => {
      transactionCount += 1;
      const userSnapshot = new Map(users);
      const eventLength = events.length;
      const deliveryLength = eventDeliveries.length;
      const auditLength = auditLogs.length;
      const revokedSessionLength = revokedSessions.length;
      const revokedTokenLength = revokedApplicationTokens.length;
      const membershipSnapshot = new Set(userGroups);
      const policySnapshot = new Set(applicationPolicies);
      const activeSessionSnapshot = new Map(
        [...activeSessions].map(([userId, sessionIds]) => [
          userId,
          [...sessionIds],
        ]),
      );
      try {
        return await work(repository);
      } catch (error) {
        users.clear();
        userSnapshot.forEach((user, id) => users.set(id, user));
        events.length = eventLength;
        eventDeliveries.length = deliveryLength;
        auditLogs.length = auditLength;
        revokedSessions.length = revokedSessionLength;
        revokedApplicationTokens.length = revokedTokenLength;
        userGroups.clear();
        membershipSnapshot.forEach((membership) => userGroups.add(membership));
        applicationPolicies.clear();
        policySnapshot.forEach((policy) => applicationPolicies.add(policy));
        activeSessions.clear();
        activeSessionSnapshot.forEach((sessionIds, userId) =>
          activeSessions.set(userId, sessionIds),
        );
        throw error;
      }
    },
    listUsers: async () => [...users.values()],
    findUserById: async (id) => users.get(id) ?? null,
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
    revokeActiveSessionsForUser: async (userId, reason, revokedAt) => {
      revokedSessions.push({ userId, reason, revokedAt });
      const sessionIds = activeSessions.get(userId) ?? [];
      activeSessions.set(userId, []);
      return sessionIds;
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
    removeUserFromGroup: async (userId, groupId) => {
      userGroups.delete(`${userId}:${groupId}`);
    },
    listMemberships: async () =>
      [...userGroups].map((membership): MembershipSummary => {
        const [userId, groupId] = membership.split(":");
        return { userId, groupId };
      }),
    listAccessibleApplicationsForUser: async (userId) => {
      if (users.get(userId)?.status !== "active") return [];
      return [...applications.values()].filter(
        (application) =>
          application.status === "active" &&
          [...applicationPolicies].some((policy) => {
          const [applicationId, groupId] = policy.split(":");
          return (
            applicationId === application.id &&
            userGroups.has(`${userId}:${groupId}`)
          );
          }),
      );
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
    removeApplicationPolicy: async (applicationId, groupId) => {
      applicationPolicies.delete(`${applicationId}:${groupId}:allow`);
    },
    listApplicationPolicies: async () =>
      [...applicationPolicies].map((policy): ApplicationPolicySummary => {
        const [applicationId, groupId] = policy.split(":");
        return { applicationId, groupId, effect: "allow" };
      }),
    listUsersWithAccessToApplication: async (applicationId) => {
      if (applications.get(applicationId)?.status !== "active") return [];
      return [...users.values()]
        .filter(
          (user) =>
            user.status === "active" &&
            [...applicationPolicies].some((policy) => {
              const [policyApplicationId, groupId] = policy.split(":");
              return (
                policyApplicationId === applicationId &&
                userGroups.has(`${user.id}:${groupId}`)
              );
            }),
        )
        .map((user) => user.id);
    },
    revokeAccessTokensForUserApplication: async (
      userId,
      applicationId,
      revokedAt,
    ) => {
      revokedApplicationTokens.push({ userId, applicationId, revokedAt });
    },
    createAuditLog: async (input) => {
      auditLogs.push({ eventType: input.eventType, result: input.result });
    },
    createEvent: async (input) => {
      events.push(input);
    },
    createEventDelivery: async (input) => {
      if (failEventDelivery) throw new Error("delivery insert failed");
      eventDeliveries.push(input);
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
    eventDeliveries,
    revokedSessions,
    activeSessions,
    revokedApplicationTokens,
    userGroups,
    applicationPolicies,
    getTransactionCount: () => transactionCount,
    failNextEventDelivery: () => {
      failEventDelivery = true;
    },
  };
}

function createService(
  repository: AdminRepository,
  eventIds = ["password-event-1"],
) {
  let eventIndex = 0;
  return createAdminService({
    repository,
    hashPassword: async (plainPassword) => `hashed:${plainPassword}`,
    now: () => new Date("2026-08-09T10:00:00.000Z"),
    generateEventId: () => eventIds[eventIndex++] ?? `event-${eventIndex}`,
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
    const {
      repository,
      events,
      eventDeliveries,
      revokedSessions,
      users,
      getTransactionCount,
    } = createRepository();
    const service = createService(repository);

    await service.createUser({
      name: "Student User",
      email: "student@example.com",
      password: "password123",
    });
    await service.createApplication({
      name: "App A",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      logoutNotificationUrl: "http://localhost:4101/internal/logout",
    });
    await service.createApplication({
      name: "App B",
      clientId: "app-b-client",
      redirectUri: "http://localhost:4201/auth/callback",
      logoutNotificationUrl: "http://localhost:4201/internal/logout",
    });
    const updated = await service.updateUser("user-1", {
      password: "new-password",
    });

    expect(updated).toMatchObject({ id: "user-1", email: "student@example.com" });
    expect(users.get("user-1")?.passwordHash).toBe("hashed:new-password");
    expect(revokedSessions).toEqual([
      {
        userId: "user-1",
        reason: "password_changed",
        revokedAt: new Date("2026-08-09T10:00:00.000Z"),
      },
    ]);
    expect(events).toEqual([
      {
        id: "password-event-1",
        eventType: "PasswordChanged",
        userId: "user-1",
        centralSessionId: null,
        applicationId: null,
        payload: {
          eventId: "password-event-1",
          eventType: "PasswordChanged",
          userId: "user-1",
          centralSessionId: null,
          applicationId: null,
          reason: "password_changed",
          occurredAt: "2026-08-09T10:00:00.000Z",
          metadata: {},
        },
      },
    ]);
    expect(eventDeliveries).toEqual([
      { eventId: "password-event-1", applicationId: "app-1" },
      { eventId: "password-event-1", applicationId: "app-2" },
    ]);
    expect(getTransactionCount()).toBe(1);
  });

  it("throws not found when updating missing user", async () => {
    const { repository } = createRepository();
    const service = createService(repository);

    await expect(service.updateUser("missing-user", { status: "inactive" }))
      .rejects.toBeInstanceOf(HttpError);
  });

  it("deactivates a user and emits one SessionRevoked event per active session", async () => {
    const {
      repository,
      activeSessions,
      events,
      eventDeliveries,
      revokedSessions,
      users,
      getTransactionCount,
    } = createRepository();
    const service = createService(repository, ["deactivate-1", "deactivate-2"]);

    await service.createUser({
      name: "Student User",
      email: "student@example.com",
      password: "password123",
    });
    await service.createApplication({
      name: "App A",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      logoutNotificationUrl: "http://localhost:4101/internal/logout",
    });
    await service.createApplication({
      name: "App B",
      clientId: "app-b-client",
      redirectUri: "http://localhost:4201/auth/callback",
      logoutNotificationUrl: "http://localhost:4201/internal/logout",
    });
    activeSessions.set("user-1", ["central-1", "central-2"]);

    await service.updateUser("user-1", { status: "inactive" });

    expect(users.get("user-1")?.status).toBe("inactive");
    expect(revokedSessions).toHaveLength(1);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.centralSessionId)).toEqual([
      "central-1",
      "central-2",
    ]);
    expect(events.map((event) => event.payload)).toMatchObject([
      {
        eventId: "deactivate-1",
        eventType: "SessionRevoked",
        centralSessionId: "central-1",
        reason: "user_deactivated",
      },
      {
        eventId: "deactivate-2",
        eventType: "SessionRevoked",
        centralSessionId: "central-2",
        reason: "user_deactivated",
      },
    ]);
    expect(eventDeliveries).toHaveLength(4);
    expect(getTransactionCount()).toBe(1);
  });

  it("reconciles active sessions that remain on an already inactive user", async () => {
    const { repository, users, activeSessions, events, revokedSessions } =
      createRepository();
    users.set("user-1", {
      id: "user-1",
      name: "Student User",
      email: "student@example.com",
      passwordHash: "hash",
      status: "inactive",
    });
    activeSessions.set("user-1", ["central-1"]);
    const service = createService(repository);

    await service.updateUser("user-1", { status: "inactive" });

    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      eventType: "SessionRevoked",
      centralSessionId: "central-1",
      reason: "user_deactivated",
    });
    expect(revokedSessions).toHaveLength(1);
    expect(activeSessions.get("user-1")).toEqual([]);
  });

  it("changes password and deactivates with one revocation pass", async () => {
    const {
      repository,
      activeSessions,
      events,
      eventDeliveries,
      revokedSessions,
      users,
    } = createRepository();
    const service = createService(repository, ["password-1", "session-1"]);
    await service.createUser({
      name: "Student User",
      email: "student@example.com",
      password: "password123",
    });
    await service.createApplication({
      name: "App A",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      logoutNotificationUrl: "http://localhost:4101/internal/logout",
    });
    activeSessions.set("user-1", ["central-1"]);

    await service.updateUser("user-1", {
      password: "new-password",
      status: "inactive",
    });

    expect(users.get("user-1")).toMatchObject({
      status: "inactive",
      passwordHash: "hashed:new-password",
    });
    expect(revokedSessions).toHaveLength(1);
    expect(events.map((event) => event.eventType)).toEqual([
      "PasswordChanged",
      "SessionRevoked",
    ]);
    expect(new Set(events.map((event) => event.id)).size).toBe(2);
    expect(eventDeliveries).toHaveLength(2);
  });

  it("rolls back deactivation when outbox delivery creation fails", async () => {
    const {
      repository,
      activeSessions,
      events,
      eventDeliveries,
      revokedSessions,
      users,
      failNextEventDelivery,
    } = createRepository();
    const service = createService(repository, ["session-1"]);
    await service.createUser({
      name: "Student User",
      email: "student@example.com",
      password: "password123",
    });
    await service.createApplication({
      name: "App A",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      logoutNotificationUrl: "http://localhost:4101/internal/logout",
    });
    activeSessions.set("user-1", ["central-1"]);
    failNextEventDelivery();

    await expect(
      service.updateUser("user-1", { status: "inactive" }),
    ).rejects.toThrow("delivery insert failed");

    expect(users.get("user-1")?.status).toBe("active");
    expect(activeSessions.get("user-1")).toEqual(["central-1"]);
    expect(events).toHaveLength(0);
    expect(eventDeliveries).toHaveLength(0);
    expect(revokedSessions).toHaveLength(0);
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

  it("emits AccessPolicyChanged only when membership removal loses access", async () => {
    const {
      repository,
      userGroups,
      applicationPolicies,
      events,
      eventDeliveries,
      revokedApplicationTokens,
      revokedSessions,
    } = createRepository();
    const service = createService(repository, ["policy-event-1"]);
    await service.createUser({
      name: "Student User",
      email: "student@example.com",
      password: "password123",
    });
    const group = await service.createGroup({ name: "app-a-users" });
    const fallbackGroup = await service.createGroup({ name: "app-a-fallback" });
    const application = await service.createApplication({
      name: "App A",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      logoutNotificationUrl: "http://localhost:4101/internal/logout",
    });
    userGroups.add(`user-1:${group.id}`);
    userGroups.add(`user-1:${fallbackGroup.id}`);
    applicationPolicies.add(`${application.id}:${group.id}:allow`);
    applicationPolicies.add(`${application.id}:${fallbackGroup.id}:allow`);

    await service.removeUserFromGroup({ userId: "user-1", groupId: group.id });
    expect(events).toHaveLength(0);

    await service.removeUserFromGroup({
      userId: "user-1",
      groupId: fallbackGroup.id,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "policy-event-1",
      eventType: "AccessPolicyChanged",
      userId: "user-1",
      centralSessionId: null,
      applicationId: application.id,
      payload: {
        applicationId: application.id,
        reason: "group_membership_removed",
      },
    });
    expect(eventDeliveries).toEqual([
      { eventId: "policy-event-1", applicationId: application.id },
    ]);
    expect(revokedApplicationTokens).toHaveLength(1);
    expect(revokedSessions).toHaveLength(1);
    expect(revokedSessions[0]?.reason).toBe("access_policy_changed");
  });

  it("emits AccessPolicyChanged for users who lose access when a policy is removed", async () => {
    const {
      repository,
      userGroups,
      applicationPolicies,
      events,
      eventDeliveries,
      revokedSessions,
    } = createRepository();
    const service = createService(repository, ["policy-event-1"]);
    await service.createUser({
      name: "Student User",
      email: "student@example.com",
      password: "password123",
    });
    const group = await service.createGroup({ name: "app-a-users" });
    const application = await service.createApplication({
      name: "App A",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      logoutNotificationUrl: "http://localhost:4101/internal/logout",
    });
    userGroups.add(`user-1:${group.id}`);
    applicationPolicies.add(`${application.id}:${group.id}:allow`);

    await service.removeApplicationPolicy({
      applicationId: application.id,
      groupId: group.id,
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      eventType: "AccessPolicyChanged",
      userId: "user-1",
      applicationId: application.id,
      reason: "application_policy_removed",
    });
    expect(eventDeliveries).toEqual([
      { eventId: "policy-event-1", applicationId: application.id },
    ]);
    expect(revokedSessions).toHaveLength(1);
    expect(revokedSessions[0]?.reason).toBe("access_policy_changed");
  });

  it("does not emit access-change events for inactive users or applications", async () => {
    const {
      repository,
      users,
      applications,
      userGroups,
      applicationPolicies,
      events,
    } = createRepository();
    const service = createService(repository);
    users.set("user-1", {
      id: "user-1",
      name: "Inactive User",
      email: "inactive@example.com",
      passwordHash: "hash",
      status: "inactive",
    });
    applications.set("app-1", {
      id: "app-1",
      name: "Inactive App",
      clientId: "inactive-client",
      status: "inactive",
      launchUrl: null,
      logoutNotificationUrl: "http://localhost/internal/logout",
      redirectUris: ["http://localhost/callback"],
    });
    userGroups.add("user-1:group-1");
    applicationPolicies.add("app-1:group-1:allow");

    await service.removeUserFromGroup({
      userId: "user-1",
      groupId: "group-1",
    });
    userGroups.add("user-1:group-1");
    await service.removeApplicationPolicy({
      applicationId: "app-1",
      groupId: "group-1",
    });

    expect(events).toHaveLength(0);
  });

  it("keeps access when another allow policy still applies", async () => {
    const {
      repository,
      userGroups,
      applicationPolicies,
      events,
      revokedSessions,
    } = createRepository();
    const service = createService(repository);
    await service.createUser({
      name: "Student User",
      email: "student@example.com",
      password: "password123",
    });
    const firstGroup = await service.createGroup({ name: "first-group" });
    const secondGroup = await service.createGroup({ name: "second-group" });
    const application = await service.createApplication({
      name: "App A",
      clientId: "app-a-client",
      redirectUri: "http://localhost:4101/auth/callback",
      logoutNotificationUrl: "http://localhost:4101/internal/logout",
    });
    userGroups.add(`user-1:${firstGroup.id}`);
    userGroups.add(`user-1:${secondGroup.id}`);
    applicationPolicies.add(`${application.id}:${firstGroup.id}:allow`);
    applicationPolicies.add(`${application.id}:${secondGroup.id}:allow`);

    await service.removeApplicationPolicy({
      applicationId: application.id,
      groupId: firstGroup.id,
    });

    expect(events).toHaveLength(0);
    expect(revokedSessions).toHaveLength(0);
  });
});

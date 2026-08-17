import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import type { RevocationEventPayload } from "@sso/shared";
import {
  Prisma,
  type PrismaClient,
} from "../../../../node_modules/.prisma/auth-client/index.js";
import { HttpError, notFoundError } from "../errors.js";

export type AdminUserStatus = "active" | "inactive";
export type AdminApplicationStatus = "active" | "inactive";

export interface AdminUserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  status: AdminUserStatus;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  status: AdminUserStatus;
}

export interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
}

export interface ApplicationSummary {
  id: string;
  name: string;
  clientId: string;
  status: AdminApplicationStatus;
  launchUrl: string | null;
  logoutNotificationUrl: string;
  redirectUris: string[];
}

export interface AuditLogSummary {
  id: string;
  eventType: string;
  result: string;
  createdAt: Date;
}

export interface EventSummary {
  id: string;
  eventType: string;
  status: string;
  createdAt: Date;
}

export interface MembershipSummary {
  userId: string;
  groupId: string;
}

export interface ApplicationPolicySummary {
  applicationId: string;
  groupId: string;
  effect: "allow";
}

export interface AdminRepository {
  withTransaction<T>(
    work: (repository: AdminRepository) => Promise<T>,
    options?: { isolationLevel?: "Serializable" },
  ): Promise<T>;
  listUsers(): Promise<AdminUserRecord[]>;
  findUserById(id: string): Promise<AdminUserRecord | null>;
  findUserByEmail(email: string): Promise<AdminUserRecord | null>;
  createUser(input: {
    name: string;
    email: string;
    passwordHash: string;
    status?: AdminUserStatus;
  }): Promise<AdminUserRecord>;
  updateUser(
    id: string,
    input: {
      name?: string;
      email?: string;
      passwordHash?: string;
      status?: AdminUserStatus;
    },
  ): Promise<AdminUserRecord | null>;
  revokeActiveSessionsForUser(
    userId: string,
    reason: string,
    revokedAt: Date,
  ): Promise<string[]>;
  listGroups(): Promise<GroupSummary[]>;
  findGroupByName(name: string): Promise<GroupSummary | null>;
  createGroup(input: {
    name: string;
    description?: string | null;
  }): Promise<GroupSummary>;
  addUserToGroup(userId: string, groupId: string): Promise<void>;
  removeUserFromGroup(userId: string, groupId: string): Promise<void>;
  listMemberships(): Promise<MembershipSummary[]>;
  listAccessibleApplicationsForUser(
    userId: string,
  ): Promise<ApplicationSummary[]>;
  listApplications(): Promise<ApplicationSummary[]>;
  findApplicationByClientId(
    clientId: string,
  ): Promise<ApplicationSummary | null>;
  createApplication(input: {
    name: string;
    clientId: string;
    status?: AdminApplicationStatus;
    launchUrl?: string | null;
    logoutNotificationUrl: string;
    redirectUri: string;
  }): Promise<ApplicationSummary>;
  addApplicationPolicy(applicationId: string, groupId: string): Promise<void>;
  removeApplicationPolicy(
    applicationId: string,
    groupId: string,
  ): Promise<void>;
  listApplicationPolicies(): Promise<ApplicationPolicySummary[]>;
  listUsersWithAccessToApplication(applicationId: string): Promise<string[]>;
  revokeAccessTokensForUserApplication(
    userId: string,
    applicationId: string,
    revokedAt: Date,
  ): Promise<void>;
  createAuditLog(input: {
    eventType: string;
    result: "success" | "failed";
    userId?: string;
    applicationId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  createEvent(input: {
    id: string;
    eventType: string;
    userId: string;
    centralSessionId?: string | null;
    applicationId?: string | null;
    payload: RevocationEventPayload;
  }): Promise<void>;
  createEventDelivery(input: {
    eventId: string;
    applicationId: string;
  }): Promise<void>;
  listAuditLogs(): Promise<AuditLogSummary[]>;
  listEvents(): Promise<EventSummary[]>;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  status?: AdminUserStatus;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  password?: string;
  status?: AdminUserStatus;
}

export interface CreateGroupInput {
  name: string;
  description?: string | null;
}

export interface CreateApplicationInput {
  name: string;
  clientId: string;
  status?: AdminApplicationStatus;
  launchUrl?: string | null;
  logoutNotificationUrl: string;
  redirectUri: string;
}

export interface AdminService {
  listUsers(): Promise<UserSummary[]>;
  createUser(input: CreateUserInput): Promise<UserSummary>;
  updateUser(id: string, input: UpdateUserInput): Promise<UserSummary>;
  listGroups(): Promise<GroupSummary[]>;
  createGroup(input: CreateGroupInput): Promise<GroupSummary>;
  addUserToGroup(input: { userId: string; groupId: string }): Promise<void>;
  removeUserFromGroup(input: { userId: string; groupId: string }): Promise<void>;
  listMemberships(): Promise<MembershipSummary[]>;
  listApplications(): Promise<ApplicationSummary[]>;
  createApplication(input: CreateApplicationInput): Promise<ApplicationSummary>;
  addApplicationPolicy(input: {
    applicationId: string;
    groupId: string;
  }): Promise<void>;
  removeApplicationPolicy(input: {
    applicationId: string;
    groupId: string;
  }): Promise<void>;
  listApplicationPolicies(): Promise<ApplicationPolicySummary[]>;
  listAuditLogs(): Promise<AuditLogSummary[]>;
  listEvents(): Promise<EventSummary[]>;
}

export interface AdminServiceDependencies {
  repository: AdminRepository;
  hashPassword?: (plainPassword: string) => Promise<string>;
  now?: () => Date;
  generateEventId?: () => string;
}

function toUserSummary(user: AdminUserRecord): UserSummary {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
  };
}

function duplicate(message: string) {
  return new HttpError(400, "INVALID_REQUEST", message);
}

export function createAdminService(deps: AdminServiceDependencies): AdminService {
  const hashPassword = deps.hashPassword ?? ((plain) => bcrypt.hash(plain, 12));
  const now = deps.now ?? (() => new Date());
  const generateEventId = deps.generateEventId ?? (() => randomUUID());

  async function withSerializableRetry<T>(
    work: (repository: AdminRepository) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await deps.repository.withTransaction(work, {
          isolationLevel: "Serializable",
        });
      } catch (error) {
        const isWriteConflict =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2034";
        if (!isWriteConflict || attempt === 3) throw error;
      }
    }
    throw new Error("Serializable transaction retry exhausted");
  }

  async function createEventWithDeliveries(
    repository: AdminRepository,
    payload: RevocationEventPayload,
    applicationIds: string[],
  ) {
    await repository.createEvent({
      id: payload.eventId,
      eventType: payload.eventType,
      userId: payload.userId,
      centralSessionId: payload.centralSessionId,
      applicationId: payload.applicationId,
      payload,
    });
    await Promise.all(
      applicationIds.map((applicationId) =>
        repository.createEventDelivery({
          eventId: payload.eventId,
          applicationId,
        }),
      ),
    );
  }

  async function createAccessPolicyChangedEvent(
    repository: AdminRepository,
    input: {
      userId: string;
      applicationId: string;
      groupId: string;
      reason: "group_membership_removed" | "application_policy_removed";
      occurredAt: Date;
    },
  ) {
    await repository.revokeAccessTokensForUserApplication(
      input.userId,
      input.applicationId,
      input.occurredAt,
    );
    const payload: RevocationEventPayload = {
      eventId: generateEventId(),
      eventType: "AccessPolicyChanged",
      userId: input.userId,
      centralSessionId: null,
      applicationId: input.applicationId,
      reason: input.reason,
      occurredAt: input.occurredAt.toISOString(),
      metadata: {
        groupId: input.groupId,
        applicationId: input.applicationId,
      },
    };
    await createEventWithDeliveries(repository, payload, [input.applicationId]);
  }

  return {
    async listUsers() {
      const users = await deps.repository.listUsers();
      return users.map(toUserSummary);
    },

    async createUser(input) {
      const existingUser = await deps.repository.findUserByEmail(input.email);

      if (existingUser) {
        throw duplicate("Email user sudah digunakan");
      }

      const user = await deps.repository.createUser({
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        status: input.status,
      });

      await deps.repository.createAuditLog({
        eventType: "admin_user_created",
        result: "success",
        userId: user.id,
      });

      return toUserSummary(user);
    },

    async updateUser(id, input) {
      const passwordHash = input.password
        ? await hashPassword(input.password)
        : undefined;
      return withSerializableRetry(async (repository) => {
        const existingUser = await repository.findUserById(id);
        if (!existingUser) {
          throw notFoundError();
        }
        const deactivating =
          existingUser.status === "active" && input.status === "inactive";
        const reconcilingInactive = input.status === "inactive";
        const user = await repository.updateUser(id, {
          name: input.name,
          email: input.email,
          passwordHash,
          status: input.status,
        });

        if (!user) throw notFoundError();

        if (passwordHash || reconcilingInactive) {
          const occurredAt = now();
          const revokedSessionIds = await repository.revokeActiveSessionsForUser(
            user.id,
            reconcilingInactive ? "user_deactivated" : "password_changed",
            occurredAt,
          );
          const applicationIds = (await repository.listApplications()).map(
            (application) => application.id,
          );

          if (passwordHash) {
            await createEventWithDeliveries(
              repository,
              {
                eventId: generateEventId(),
                eventType: "PasswordChanged",
                userId: user.id,
                centralSessionId: null,
                applicationId: null,
                reason: "password_changed",
                occurredAt: occurredAt.toISOString(),
                metadata: {},
              },
              applicationIds,
            );
          }

          if (reconcilingInactive) {
            for (const centralSessionId of revokedSessionIds) {
              await createEventWithDeliveries(
                repository,
                {
                  eventId: generateEventId(),
                  eventType: "SessionRevoked",
                  userId: user.id,
                  centralSessionId,
                  applicationId: null,
                  reason: "user_deactivated",
                  occurredAt: occurredAt.toISOString(),
                  metadata: { source: "admin" },
                },
                applicationIds,
              );
            }
          }
        }

        await repository.createAuditLog({
          eventType: "admin_user_updated",
          result: "success",
          userId: user.id,
        });

        return toUserSummary(user);
      });
    },

    async listGroups() {
      return deps.repository.listGroups();
    },

    async createGroup(input) {
      const existingGroup = await deps.repository.findGroupByName(input.name);

      if (existingGroup) {
        throw duplicate("Nama group sudah digunakan");
      }

      const group = await deps.repository.createGroup(input);
      await deps.repository.createAuditLog({
        eventType: "admin_group_created",
        result: "success",
        metadata: { groupId: group.id },
      });
      return group;
    },

    async addUserToGroup(input) {
      await deps.repository.addUserToGroup(input.userId, input.groupId);
      await deps.repository.createAuditLog({
        eventType: "admin_user_group_added",
        result: "success",
        userId: input.userId,
        metadata: { groupId: input.groupId },
      });
    },

    async removeUserFromGroup(input) {
      await withSerializableRetry(async (repository) => {
        const before = await repository.listAccessibleApplicationsForUser(
          input.userId,
        );
        await repository.removeUserFromGroup(input.userId, input.groupId);
        const afterIds = new Set(
          (await repository.listAccessibleApplicationsForUser(input.userId)).map(
            (application) => application.id,
          ),
        );
        const lostApplications = before.filter(
          (application) => !afterIds.has(application.id),
        );
        const occurredAt = now();
        if (lostApplications.length > 0) {
          await repository.revokeActiveSessionsForUser(
            input.userId,
            "access_policy_changed",
            occurredAt,
          );
        }
        for (const application of lostApplications) {
            await createAccessPolicyChangedEvent(repository, {
              userId: input.userId,
              applicationId: application.id,
              groupId: input.groupId,
              reason: "group_membership_removed",
              occurredAt,
            });
        }
        await repository.createAuditLog({
          eventType: "admin_user_group_removed",
          result: "success",
          userId: input.userId,
          metadata: { groupId: input.groupId },
        });
      });
    },

    async listMemberships() {
      return deps.repository.listMemberships();
    },

    async listApplications() {
      return deps.repository.listApplications();
    },

    async createApplication(input) {
      const existingApplication =
        await deps.repository.findApplicationByClientId(input.clientId);

      if (existingApplication) {
        throw duplicate("Client ID aplikasi sudah digunakan");
      }

      const application = await deps.repository.createApplication(input);
      await deps.repository.createAuditLog({
        eventType: "admin_application_created",
        result: "success",
        applicationId: application.id,
      });
      return application;
    },

    async addApplicationPolicy(input) {
      await deps.repository.addApplicationPolicy(
        input.applicationId,
        input.groupId,
      );
      await deps.repository.createAuditLog({
        eventType: "admin_application_policy_created",
        result: "success",
        applicationId: input.applicationId,
        metadata: { groupId: input.groupId, effect: "allow" },
      });
    },

    async removeApplicationPolicy(input) {
      await withSerializableRetry(async (repository) => {
        const before = await repository.listUsersWithAccessToApplication(
          input.applicationId,
        );
        await repository.removeApplicationPolicy(
          input.applicationId,
          input.groupId,
        );
        const afterIds = new Set(
          await repository.listUsersWithAccessToApplication(input.applicationId),
        );
        const occurredAt = now();
        for (const userId of before) {
          if (!afterIds.has(userId)) {
            await repository.revokeActiveSessionsForUser(
              userId,
              "access_policy_changed",
              occurredAt,
            );
            await createAccessPolicyChangedEvent(repository, {
              userId,
              applicationId: input.applicationId,
              groupId: input.groupId,
              reason: "application_policy_removed",
              occurredAt,
            });
          }
        }
        await repository.createAuditLog({
          eventType: "admin_application_policy_removed",
          result: "success",
          applicationId: input.applicationId,
          metadata: { groupId: input.groupId, effect: "allow" },
        });
      });
    },

    async listApplicationPolicies() {
      return deps.repository.listApplicationPolicies();
    },

    async listAuditLogs() {
      return deps.repository.listAuditLogs();
    },

    async listEvents() {
      return deps.repository.listEvents();
    },
  };
}

function toApplicationSummary(application: {
  id: string;
  name: string;
  clientId: string;
  status: AdminApplicationStatus;
  launchUrl: string | null;
  logoutNotificationUrl: string;
  redirectUris: Array<{ redirectUri: string }>;
}): ApplicationSummary {
  return {
    id: application.id,
    name: application.name,
    clientId: application.clientId,
    status: application.status,
    launchUrl: application.launchUrl,
    logoutNotificationUrl: application.logoutNotificationUrl,
    redirectUris: application.redirectUris.map((redirect) => redirect.redirectUri),
  };
}

export function createPrismaAdminRepository(
  prisma: PrismaClient | Prisma.TransactionClient,
): AdminRepository {
  const repository: AdminRepository = {
    async withTransaction(work, options) {
      if (!("$transaction" in prisma)) {
        return work(repository);
      }

      return prisma.$transaction(
        async (transaction) => work(createPrismaAdminRepository(transaction)),
        options?.isolationLevel
          ? { isolationLevel: options.isolationLevel }
          : undefined,
      );
    },
    async listUsers() {
      return prisma.user.findMany({
        orderBy: { createdAt: "asc" },
      });
    },

    async findUserById(id) {
      return prisma.user.findUnique({ where: { id } });
    },

    async findUserByEmail(email) {
      return prisma.user.findUnique({ where: { email } });
    },

    async createUser(input) {
      return prisma.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash: input.passwordHash,
          status: input.status,
        },
      });
    },

    async updateUser(id, input) {
      try {
        return await prisma.user.update({
          where: { id },
          data: {
            name: input.name,
            email: input.email,
            passwordHash: input.passwordHash,
            status: input.status,
          },
        });
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2025"
        ) {
          return null;
        }
        throw error;
      }
    },

    async revokeActiveSessionsForUser(userId, reason, revokedAt) {
      await prisma.accessToken.updateMany({
        where: {
          userId,
          status: "active",
          revokedAt: null,
        },
        data: {
          status: "revoked",
          revokedAt,
        },
      });
      const sessions = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE "SsoSession"
        SET "status" = 'revoked',
            "revokedAt" = ${revokedAt},
            "revokeReason" = ${reason}
        WHERE "userId" = ${userId}
          AND "status" = 'active'
          AND "revokedAt" IS NULL
        RETURNING "id"
      `);
      return sessions.map((session) => session.id);
    },

    async listGroups() {
      return prisma.group.findMany({
        orderBy: { createdAt: "asc" },
      });
    },

    async findGroupByName(name) {
      return prisma.group.findUnique({ where: { name } });
    },

    async createGroup(input) {
      return prisma.group.create({
        data: {
          name: input.name,
          description: input.description,
        },
      });
    },

    async addUserToGroup(userId, groupId) {
      await prisma.userGroup.upsert({
        where: {
          userId_groupId: {
            userId,
            groupId,
          },
        },
        create: {
          userId,
          groupId,
        },
        update: {},
      });
    },

    async removeUserFromGroup(userId, groupId) {
      await prisma.userGroup.deleteMany({ where: { userId, groupId } });
    },

    async listMemberships() {
      return prisma.userGroup.findMany({
        select: { userId: true, groupId: true },
        orderBy: [{ userId: "asc" }, { groupId: "asc" }],
      });
    },

    async listAccessibleApplicationsForUser(userId) {
      const applications = await prisma.application.findMany({
        where: {
          status: "active",
          policies: {
            some: {
              effect: "allow",
              group: {
                users: {
                  some: { userId, user: { status: "active" } },
                },
              },
            },
          },
        },
        include: { redirectUris: true },
        orderBy: { createdAt: "asc" },
      });
      return applications.map(toApplicationSummary);
    },

    async listApplications() {
      const applications = await prisma.application.findMany({
        include: { redirectUris: true },
        orderBy: { createdAt: "asc" },
      });
      return applications.map(toApplicationSummary);
    },

    async findApplicationByClientId(clientId) {
      const application = await prisma.application.findUnique({
        where: { clientId },
        include: { redirectUris: true },
      });
      return application ? toApplicationSummary(application) : null;
    },

    async createApplication(input) {
      const application = await prisma.application.create({
        data: {
          name: input.name,
          clientId: input.clientId,
          status: input.status,
          launchUrl: input.launchUrl,
          logoutNotificationUrl: input.logoutNotificationUrl,
          redirectUris: {
            create: {
              redirectUri: input.redirectUri,
            },
          },
        },
        include: { redirectUris: true },
      });
      return toApplicationSummary(application);
    },

    async addApplicationPolicy(applicationId, groupId) {
      await prisma.applicationGroupPolicy.upsert({
        where: {
          applicationId_groupId_effect: {
            applicationId,
            groupId,
            effect: "allow",
          },
        },
        create: {
          applicationId,
          groupId,
          effect: "allow",
        },
        update: {},
      });
    },

    async removeApplicationPolicy(applicationId, groupId) {
      await prisma.applicationGroupPolicy.deleteMany({
        where: { applicationId, groupId, effect: "allow" },
      });
    },

    async listApplicationPolicies() {
      return prisma.applicationGroupPolicy.findMany({
        select: { applicationId: true, groupId: true, effect: true },
        orderBy: [{ applicationId: "asc" }, { groupId: "asc" }],
      });
    },

    async listUsersWithAccessToApplication(applicationId) {
      const users = await prisma.user.findMany({
        where: {
          status: "active",
          groups: {
            some: {
              group: {
                policies: {
                  some: {
                    applicationId,
                    effect: "allow",
                    application: { status: "active" },
                  },
                },
              },
            },
          },
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      return users.map((user) => user.id);
    },

    async revokeAccessTokensForUserApplication(
      userId,
      applicationId,
      revokedAt,
    ) {
      await prisma.accessToken.updateMany({
        where: {
          userId,
          applicationId,
          status: "active",
          revokedAt: null,
        },
        data: { status: "revoked", revokedAt },
      });
    },

    async createAuditLog(input) {
      await prisma.auditLog.create({
        data: {
          eventType: input.eventType,
          result: input.result,
          userId: input.userId,
          applicationId: input.applicationId,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });
    },

    async createEvent(input) {
      await prisma.event.create({
        data: {
          id: input.id,
          eventType: input.eventType,
          userId: input.userId,
          centralSessionId: input.centralSessionId,
          applicationId: input.applicationId,
          payload: input.payload as unknown as Prisma.InputJsonValue,
        },
      });
    },

    async createEventDelivery(input) {
      await prisma.eventDelivery.create({ data: input });
    },

    async listAuditLogs() {
      return prisma.auditLog.findMany({
        select: {
          id: true,
          eventType: true,
          result: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    },

    async listEvents() {
      return prisma.event.findMany({
        select: {
          id: true,
          eventType: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    },
  };

  return repository;
}

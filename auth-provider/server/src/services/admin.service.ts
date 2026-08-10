import bcrypt from "bcrypt";
import type {
  Prisma,
  PrismaClient,
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

export interface AdminRepository {
  listUsers(): Promise<AdminUserRecord[]>;
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
  revokeActiveSessionsForUser(userId: string, reason: string): Promise<void>;
  listGroups(): Promise<GroupSummary[]>;
  findGroupByName(name: string): Promise<GroupSummary | null>;
  createGroup(input: {
    name: string;
    description?: string | null;
  }): Promise<GroupSummary>;
  addUserToGroup(userId: string, groupId: string): Promise<void>;
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
  createAuditLog(input: {
    eventType: string;
    result: "success" | "failed";
    userId?: string;
    applicationId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  createEvent(input: {
    eventType: string;
    userId: string;
    applicationId?: string;
    payload: Record<string, unknown>;
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
  listApplications(): Promise<ApplicationSummary[]>;
  createApplication(input: CreateApplicationInput): Promise<ApplicationSummary>;
  addApplicationPolicy(input: {
    applicationId: string;
    groupId: string;
  }): Promise<void>;
  listAuditLogs(): Promise<AuditLogSummary[]>;
  listEvents(): Promise<EventSummary[]>;
}

export interface AdminServiceDependencies {
  repository: AdminRepository;
  hashPassword?: (plainPassword: string) => Promise<string>;
  now?: () => Date;
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
      const user = await deps.repository.updateUser(id, {
        name: input.name,
        email: input.email,
        passwordHash,
        status: input.status,
      });

      if (!user) {
        throw notFoundError();
      }

      if (passwordHash) {
        const occurredAt = now();
        await deps.repository.revokeActiveSessionsForUser(
          user.id,
          "password_changed",
        );
        await deps.repository.createEvent({
          eventType: "PasswordChanged",
          userId: user.id,
          payload: {
            eventType: "PasswordChanged",
            userId: user.id,
            centralSessionId: null,
            applicationId: null,
            reason: "password_changed",
            occurredAt: occurredAt.toISOString(),
            metadata: {},
          },
        });
      }

      await deps.repository.createAuditLog({
        eventType: "admin_user_updated",
        result: "success",
        userId: user.id,
      });

      return toUserSummary(user);
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
  prisma: PrismaClient,
): AdminRepository {
  return {
    async listUsers() {
      return prisma.user.findMany({
        orderBy: { createdAt: "asc" },
      });
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

    async revokeActiveSessionsForUser(userId, reason) {
      await prisma.ssoSession.updateMany({
        where: {
          userId,
          status: "active",
          revokedAt: null,
        },
        data: {
          status: "revoked",
          revokedAt: new Date(),
          revokeReason: reason,
        },
      });
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
          eventType: input.eventType,
          userId: input.userId,
          applicationId: input.applicationId,
          payload: input.payload as Prisma.InputJsonValue,
        },
      });
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
}

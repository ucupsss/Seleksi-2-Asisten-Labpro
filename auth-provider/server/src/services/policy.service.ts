import type {
  Prisma,
  PrismaClient,
} from "../../../../node_modules/.prisma/auth-client/index.js";

export interface PolicyUserRecord {
  id: string;
  name: string;
  email: string;
  status: "active" | "inactive";
}

export interface PolicyApplicationRecord {
  id: string;
  name: string;
  clientId: string;
  status: "active" | "inactive";
}

export type PolicyDenyReason =
  | "user_not_found"
  | "application_not_found"
  | "user_inactive"
  | "application_inactive"
  | "redirect_uri_mismatch"
  | "missing_allow_policy";

export type PolicyDecision =
  | {
      allowed: true;
      user: PolicyUserRecord;
      application: PolicyApplicationRecord;
    }
  | {
      allowed: false;
      reason: PolicyDenyReason;
      user?: PolicyUserRecord;
      application?: PolicyApplicationRecord;
    };

export interface PolicyRepository {
  findUserById(userId: string): Promise<PolicyUserRecord | null>;
  findApplicationByClientId(
    clientId: string,
  ): Promise<PolicyApplicationRecord | null>;
  hasRedirectUri(applicationId: string, redirectUri: string): Promise<boolean>;
  findUserGroupIds(userId: string): Promise<string[]>;
  hasAllowPolicyForGroups(
    applicationId: string,
    groupIds: string[],
  ): Promise<boolean>;
  createAuditLog(input: {
    eventType: string;
    result: "success" | "failed";
    userId?: string;
    applicationId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export interface EvaluateApplicationAccessInput {
  userId: string;
  clientId: string;
  redirectUri: string;
}

export interface PolicyService {
  evaluateApplicationAccess(
    input: EvaluateApplicationAccessInput,
  ): Promise<PolicyDecision>;
}

export function createPolicyService(input: {
  repository: PolicyRepository;
}): PolicyService {
  const { repository } = input;

  async function deny(
    reason: PolicyDenyReason,
    user?: PolicyUserRecord,
    application?: PolicyApplicationRecord,
  ): Promise<PolicyDecision> {
    await repository.createAuditLog({
      eventType: "PolicyDenied",
      result: "failed",
      userId: user?.id,
      applicationId: application?.id,
      metadata: { reason },
    });
    return { allowed: false, reason, user, application };
  }

  return {
    async evaluateApplicationAccess(input) {
      const user = await repository.findUserById(input.userId);

      if (!user) {
        return deny("user_not_found");
      }

      const application = await repository.findApplicationByClientId(
        input.clientId,
      );

      if (!application) {
        return deny("application_not_found", user);
      }

      if (user.status !== "active") {
        return deny("user_inactive", user, application);
      }

      if (application.status !== "active") {
        return deny("application_inactive", user, application);
      }

      const redirectUriIsValid = await repository.hasRedirectUri(
        application.id,
        input.redirectUri,
      );

      if (!redirectUriIsValid) {
        return deny("redirect_uri_mismatch", user, application);
      }

      const groupIds = await repository.findUserGroupIds(user.id);
      const hasAllowPolicy = await repository.hasAllowPolicyForGroups(
        application.id,
        groupIds,
      );

      if (!hasAllowPolicy) {
        return deny("missing_allow_policy", user, application);
      }

      return {
        allowed: true,
        user,
        application,
      };
    },
  };
}

export function createPrismaPolicyRepository(
  prisma: PrismaClient,
): PolicyRepository {
  return {
    async findUserById(userId) {
      return prisma.user.findUnique({ where: { id: userId } });
    },

    async findApplicationByClientId(clientId) {
      return prisma.application.findUnique({ where: { clientId } });
    },

    async hasRedirectUri(applicationId, redirectUri) {
      const redirect = await prisma.applicationRedirectUri.findUnique({
        where: {
          applicationId_redirectUri: {
            applicationId,
            redirectUri,
          },
        },
      });
      return Boolean(redirect);
    },

    async findUserGroupIds(userId) {
      const userGroups = await prisma.userGroup.findMany({
        where: { userId },
        select: { groupId: true },
      });
      return userGroups.map((userGroup) => userGroup.groupId);
    },

    async hasAllowPolicyForGroups(applicationId, groupIds) {
      if (groupIds.length === 0) {
        return false;
      }

      const policy = await prisma.applicationGroupPolicy.findFirst({
        where: {
          applicationId,
          effect: "allow",
          groupId: { in: groupIds },
        },
      });
      return Boolean(policy);
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
  };
}

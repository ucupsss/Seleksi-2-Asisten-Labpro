import bcrypt from "bcrypt";
import { PrismaClient } from "../../node_modules/.prisma/auth-client/index.js";

const prisma = new PrismaClient();

const password = "password123";
const saltRounds = 12;

async function upsertUser(input: {
  email: string;
  name: string;
  status?: "active" | "inactive";
}) {
  const passwordHash = await bcrypt.hash(password, saltRounds);

  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      name: input.name,
      passwordHash,
      status: input.status ?? "active",
    },
    create: {
      email: input.email,
      name: input.name,
      passwordHash,
      status: input.status ?? "active",
    },
  });
}

async function upsertGroup(name: string, description: string) {
  return prisma.group.upsert({
    where: { name },
    update: { description },
    create: { name, description },
  });
}

async function connectUserGroup(userId: string, groupId: string) {
  await prisma.userGroup.upsert({
    where: { userId_groupId: { userId, groupId } },
    update: {},
    create: { userId, groupId },
  });
}

async function upsertApplication(input: {
  name: string;
  clientId: string;
  launchUrl: string;
  logoutNotificationUrl: string;
  redirectUri: string;
}) {
  const application = await prisma.application.upsert({
    where: { clientId: input.clientId },
    update: {
      name: input.name,
      launchUrl: input.launchUrl,
      logoutNotificationUrl: input.logoutNotificationUrl,
      status: "active",
    },
    create: {
      name: input.name,
      clientId: input.clientId,
      launchUrl: input.launchUrl,
      logoutNotificationUrl: input.logoutNotificationUrl,
      status: "active",
    },
  });

  await prisma.applicationRedirectUri.upsert({
    where: {
      applicationId_redirectUri: {
        applicationId: application.id,
        redirectUri: input.redirectUri,
      },
    },
    update: {},
    create: {
      applicationId: application.id,
      redirectUri: input.redirectUri,
    },
  });

  return application;
}

async function connectPolicy(applicationId: string, groupId: string) {
  await prisma.applicationGroupPolicy.upsert({
    where: {
      applicationId_groupId_effect: {
        applicationId,
        groupId,
        effect: "allow",
      },
    },
    update: {},
    create: {
      applicationId,
      groupId,
      effect: "allow",
    },
  });
}

async function main() {
  const admin = await upsertUser({
    email: "admin@example.com",
    name: "Admin User",
  });
  const student = await upsertUser({
    email: "student@example.com",
    name: "Student User",
  });

  const administrators = await upsertGroup(
    "administrators",
    "Users allowed to operate the Auth Provider control panel.",
  );
  const appAUsers = await upsertGroup(
    "app-a-users",
    "Users allowed to access App A.",
  );
  const appBUsers = await upsertGroup(
    "app-b-users",
    "Users allowed to access App B.",
  );

  await connectUserGroup(admin.id, administrators.id);
  await connectUserGroup(student.id, appAUsers.id);
  await connectUserGroup(student.id, appBUsers.id);

  const appA = await upsertApplication({
    name: "App A",
    clientId: "app-a-client",
    launchUrl: "http://localhost:4100",
    logoutNotificationUrl:
      process.env.APP_A_LOGOUT_NOTIFICATION_URL ??
      "http://localhost:4101/internal/logout",
    redirectUri: "http://localhost:4101/auth/callback",
  });
  const appB = await upsertApplication({
    name: "App B",
    clientId: "app-b-client",
    launchUrl: "http://localhost:4200",
    logoutNotificationUrl:
      process.env.APP_B_LOGOUT_NOTIFICATION_URL ??
      "http://localhost:4201/internal/logout",
    redirectUri: "http://localhost:4201/auth/callback",
  });

  await connectPolicy(appA.id, appAUsers.id);
  await connectPolicy(appB.id, appBUsers.id);

  await prisma.auditLog.create({
    data: {
      eventType: "seed_completed",
      result: "success",
      metadata: {
        users: ["admin@example.com", "student@example.com"],
        seededGroups: ["administrators", "app-a-users", "app-b-users"],
      },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

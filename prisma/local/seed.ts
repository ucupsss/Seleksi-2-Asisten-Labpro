import { PrismaClient } from "../../node_modules/.prisma/local-client/index.js";

const prisma = new PrismaClient();

async function main() {
  await prisma.activityLog.deleteMany({
    where: {
      eventType: "seed_completed",
      appKey: { in: ["app-a", "app-b"] },
    },
  });

  await prisma.activityLog.createMany({
    data: [
      {
        appKey: "app-a",
        eventType: "seed_completed",
        message: "Local DB seed completed for App A.",
      },
      {
        appKey: "app-b",
        eventType: "seed_completed",
        message: "Local DB seed completed for App B.",
      },
    ],
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

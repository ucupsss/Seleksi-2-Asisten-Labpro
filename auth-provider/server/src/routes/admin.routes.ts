import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors.js";
import type { AdminService } from "../services/admin.service.js";

const userStatusSchema = z.enum(["active", "inactive"]);
const applicationStatusSchema = z.enum(["active", "inactive"]);

const createUserBodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  status: userStatusSchema.optional(),
});

const updateUserBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8).optional(),
    status: userStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

const createGroupBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).nullable().optional(),
});

const addUserToGroupBodySchema = z.object({
  userId: z.string().min(1),
});

const createApplicationBodySchema = z.object({
  name: z.string().min(1),
  clientId: z.string().min(1),
  status: applicationStatusSchema.optional(),
  launchUrl: z.string().url().nullable().optional(),
  logoutNotificationUrl: z.string().url(),
  redirectUri: z.string().url(),
});

const addApplicationPolicyBodySchema = z.object({
  groupId: z.string().min(1),
});

function invalidRequest(message: string) {
  return new HttpError(400, "INVALID_REQUEST", message);
}

export function createAdminRoutes(adminService: AdminService) {
  const router = Router();

  router.get("/admin/users", async (_req, res, next) => {
    try {
      const users = await adminService.listUsers();
      res.json({ users });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/users", async (req, res, next) => {
    try {
      const parsed = createUserBodySchema.safeParse(req.body);

      if (!parsed.success) {
        throw invalidRequest("Data user tidak valid");
      }

      const user = await adminService.createUser(parsed.data);
      res.status(201).json({ user });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/users/:id", async (req, res, next) => {
    try {
      const parsed = updateUserBodySchema.safeParse(req.body);

      if (!parsed.success) {
        throw invalidRequest("Data update user tidak valid");
      }

      const user = await adminService.updateUser(req.params.id, parsed.data);
      res.json({ user });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/groups", async (_req, res, next) => {
    try {
      const groups = await adminService.listGroups();
      res.json({ groups });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/groups", async (req, res, next) => {
    try {
      const parsed = createGroupBodySchema.safeParse(req.body);

      if (!parsed.success) {
        throw invalidRequest("Data group tidak valid");
      }

      const group = await adminService.createGroup(parsed.data);
      res.status(201).json({ group });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/groups/:id/users", async (req, res, next) => {
    try {
      const parsed = addUserToGroupBodySchema.safeParse(req.body);

      if (!parsed.success) {
        throw invalidRequest("Data membership group tidak valid");
      }

      await adminService.addUserToGroup({
        userId: parsed.data.userId,
        groupId: req.params.id,
      });
      res.status(201).json({ membership: { status: "active" } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/memberships", async (_req, res, next) => {
    try {
      const memberships = await adminService.listMemberships();
      res.json({ memberships });
    } catch (error) {
      next(error);
    }
  });

  router.delete(
    "/admin/groups/:groupId/users/:userId",
    async (req, res, next) => {
      try {
        await adminService.removeUserFromGroup({
          userId: req.params.userId,
          groupId: req.params.groupId,
        });
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/admin/applications", async (_req, res, next) => {
    try {
      const applications = await adminService.listApplications();
      res.json({ applications });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/applications", async (req, res, next) => {
    try {
      const parsed = createApplicationBodySchema.safeParse(req.body);

      if (!parsed.success) {
        throw invalidRequest("Data aplikasi tidak valid");
      }

      const application = await adminService.createApplication(parsed.data);
      res.status(201).json({ application });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/applications/:id/policies", async (req, res, next) => {
    try {
      const parsed = addApplicationPolicyBodySchema.safeParse(req.body);

      if (!parsed.success) {
        throw invalidRequest("Data policy aplikasi tidak valid");
      }

      await adminService.addApplicationPolicy({
        applicationId: req.params.id,
        groupId: parsed.data.groupId,
      });
      res.status(201).json({ policy: { effect: "allow" } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/policies", async (_req, res, next) => {
    try {
      const policies = await adminService.listApplicationPolicies();
      res.json({ policies });
    } catch (error) {
      next(error);
    }
  });

  router.delete(
    "/admin/applications/:applicationId/policies/:groupId",
    async (req, res, next) => {
      try {
        await adminService.removeApplicationPolicy({
          applicationId: req.params.applicationId,
          groupId: req.params.groupId,
        });
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/admin/audit-logs", async (_req, res, next) => {
    try {
      const auditLogs = await adminService.listAuditLogs();
      res.json({ auditLogs });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/events", async (_req, res, next) => {
    try {
      const events = await adminService.listEvents();
      res.json({ events });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

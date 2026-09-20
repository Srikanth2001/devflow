import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient, Role, TaskStatus, Priority } from "@prisma/client";
import { z } from "zod";
import { createServer } from "http";
import { Server } from "socket.io";
import Redis from "ioredis";
import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";

const prisma = new PrismaClient();

const app = express();

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "*"
  }
});

const redis = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379"
);

app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173"
  })
);

app.use(express.json());

app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120
  })
);

const accessSecret =
  process.env.JWT_ACCESS_SECRET || "dev-access";

const refreshSecret =
  process.env.JWT_REFRESH_SECRET || "dev-refresh";

function signAccess(userId: string) {
  return jwt.sign(
    { sub: userId },
    accessSecret,
    { expiresIn: "15m" }
  );
}

function signRefresh(userId: string) {
  return jwt.sign(
    { sub: userId },
    refreshSecret,
    { expiresIn: "7d" }
  );
}

type AuthedRequest = express.Request & {
  userId?: string;
};

function auth(
  req: AuthedRequest,
  res: express.Response,
  next: express.NextFunction
) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ message: "Missing token" });
  }

  try {
    const payload = jwt.verify(
      header.slice(7),
      accessSecret
    ) as jwt.JwtPayload;

    req.userId = String(payload.sub);

    next();
  } catch {
    return res
      .status(401)
      .json({ message: "Invalid or expired token" });
  }
}

async function membership(
  userId: string,
  organizationId: string
) {
  return prisma.membership.findUnique({
    where: {
      userId_organizationId: {
        userId,
        organizationId
      }
    }
  });
}

/* =========================
   HEALTH
========================= */

app.get(
  "/api/health",
  (_, res) =>
    res.json({
      status: "ok",
      service: "devflow-api"
    })
);

/* =========================
   AUTH
========================= */

app.post(
  "/api/auth/register",
  async (req, res) => {
    const schema = z.object({
      name: z.string().min(2),
      email: z.email(),
      password: z.string().min(8)
    });

    const parsed = schema.safeParse(req.body);

    if (!parsed.success) {
      return res
        .status(400)
        .json({
          message: "Invalid registration data"
        });
    }

    const {
      name,
      email,
      password
    } = parsed.data;

    const exists =
      await prisma.user.findUnique({
        where: { email }
      });

    if (exists) {
      return res
        .status(409)
        .json({
          message: "Email already registered"
        });
    }

    const user =
      await prisma.user.create({
        data: {
          name,
          email,
          passwordHash:
            await bcrypt.hash(password, 12)
        }
      });

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      },
      accessToken: signAccess(user.id),
      refreshToken: signRefresh(user.id)
    });
  }
);

app.post(
  "/api/auth/login",
  async (req, res) => {
    const parsed = z
      .object({
        email: z.email(),
        password: z.string()
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res
        .status(400)
        .json({
          message: "Invalid credentials"
        });
    }

    const user =
      await prisma.user.findUnique({
        where: {
          email: parsed.data.email
        }
      });

    if (
      !user ||
      !(await bcrypt.compare(
        parsed.data.password,
        user.passwordHash
      ))
    ) {
      return res
        .status(401)
        .json({
          message: "Invalid credentials"
        });
    }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      },
      accessToken: signAccess(user.id),
      refreshToken: signRefresh(user.id)
    });
  }
);

app.post(
  "/api/auth/refresh",
  (req, res) => {
    try {
      const payload = jwt.verify(
        req.body.refreshToken,
        refreshSecret
      ) as jwt.JwtPayload;

      res.json({
        accessToken: signAccess(
          String(payload.sub)
        )
      });
    } catch {
      res
        .status(401)
        .json({
          message: "Invalid refresh token"
        });
    }
  }
);

/* =========================
   PROJECTS
========================= */

app.get(
  "/api/projects",
  auth,
  async (req: AuthedRequest, res) => {
    const memberships =
      await prisma.membership.findMany({
        where: {
          userId: req.userId
        },
        select: {
          organizationId: true
        }
      });

    const ids = memberships.map(
      (m) => m.organizationId
    );

    const cached = await redis.get(
      `projects:${req.userId}`
    );

    if (cached) {
      return res.json(
        JSON.parse(cached)
      );
    }

    const projects =
      await prisma.project.findMany({
        where: {
          organizationId: {
            in: ids
          }
        },
        include: {
          _count: {
            select: {
              tasks: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      });

    await redis.setex(
      `projects:${req.userId}`,
      30,
      JSON.stringify(projects)
    );

    res.json(projects);
  }
);

app.post(
  "/api/projects",
  auth,
  async (req: AuthedRequest, res) => {
    const parsed = z
      .object({
        organizationId: z.string(),
        name: z.string().min(2),
        key: z.string().min(2).max(10),
        description: z.string().optional()
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res
        .status(400)
        .json({
          message: "Invalid project data"
        });
    }

    const member = await membership(
      req.userId!,
      parsed.data.organizationId
    );

    const allowedRoles: Role[] = [
      Role.OWNER,
      Role.ADMIN,
      Role.PROJECT_MANAGER
    ];

    if (
      !member ||
      !allowedRoles.includes(member.role)
    ) {
      return res
        .status(403)
        .json({
          message: "Insufficient permissions"
        });
    }

    const project =
      await prisma.project.create({
        data: parsed.data
      });

    await redis.del(
      `projects:${req.userId}`
    );

    res.status(201).json(project);
  }
);

/* =========================
   TASKS
========================= */

app.get(
  "/api/tasks",
  auth,
  async (req: AuthedRequest, res) => {
    const projectId = String(
      req.query.projectId || ""
    );

    if (!projectId) {
      return res
        .status(400)
        .json({
          message: "projectId is required"
        });
    }

    const project =
      await prisma.project.findUnique({
        where: {
          id: projectId
        }
      });

    if (!project) {
      return res
        .status(404)
        .json({
          message: "Project not found"
        });
    }

    const member = await membership(
      req.userId!,
      project.organizationId
    );

    if (!member) {
      return res
        .status(403)
        .json({
          message: "Forbidden"
        });
    }

    const tasks =
      await prisma.task.findMany({
        where: {
          projectId
        },
        include: {
          assignee: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          comments: {
            include: {
              author: {
                select: {
                  name: true
                }
              }
            },
            orderBy: {
              createdAt: "asc"
            }
          }
        },
        orderBy: {
          updatedAt: "desc"
        }
      });

    res.json(tasks);
  }
);

app.post(
  "/api/tasks",
  auth,
  async (req: AuthedRequest, res) => {
    const parsed = z
      .object({
        projectId: z.string(),
        title: z.string().min(2),
        description: z.string().optional(),
        priority: z
          .nativeEnum(Priority)
          .optional(),
        assigneeId: z.string().optional()
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res
        .status(400)
        .json({
          message: "Invalid task data"
        });
    }

    const project =
      await prisma.project.findUnique({
        where: {
          id: parsed.data.projectId
        }
      });

    if (!project) {
      return res
        .status(404)
        .json({
          message: "Project not found"
        });
    }

    if (
      !(await membership(
        req.userId!,
        project.organizationId
      ))
    ) {
      return res
        .status(403)
        .json({
          message: "Forbidden"
        });
    }

    const task =
      await prisma.task.create({
        data: parsed.data
      });

    await prisma.activity.create({
      data: {
        action: "TASK_CREATED",
        details: task.title,
        projectId: project.id,
        actorId: req.userId!
      }
    });

    io.to(
      `project:${project.id}`
    ).emit(
      "task:created",
      task
    );

    res.status(201).json(task);
  }
);

/* =========================
   UPDATE TASK
========================= */

app.patch(
  "/api/tasks/:id",
  auth,
  async (req: AuthedRequest, res) => {
    const parsed = z
      .object({
        title: z.string().min(2).optional(),
        description: z.string().optional(),
        status: z
          .nativeEnum(TaskStatus)
          .optional(),
        priority: z
          .nativeEnum(Priority)
          .optional(),
        assigneeId: z
          .string()
          .nullable()
          .optional()
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res
        .status(400)
        .json({
          message: "Invalid update"
        });
    }

    const taskId = String(
      req.params.id
    );

    const task =
      await prisma.task.findUnique({
        where: {
          id: taskId
        }
      });

    if (!task) {
      return res
        .status(404)
        .json({
          message: "Task not found"
        });
    }

    const project =
      await prisma.project.findUnique({
        where: {
          id: task.projectId
        }
      });

    if (
      !project ||
      !(await membership(
        req.userId!,
        project.organizationId
      ))
    ) {
      return res
        .status(403)
        .json({
          message: "Forbidden"
        });
    }

    const updated =
      await prisma.task.update({
        where: {
          id: task.id
        },
        data: parsed.data
      });

    await prisma.activity.create({
      data: {
        action: "TASK_UPDATED",
        details: `${task.title}: ${task.status} -> ${updated.status}`,
        projectId: task.projectId,
        actorId: req.userId!
      }
    });

    io.to(
      `project:${task.projectId}`
    ).emit(
      "task:updated",
      updated
    );

    res.json(updated);
  }
);

/* =========================
   TASK COMMENTS
========================= */

app.post(
  "/api/tasks/:id/comments",
  auth,
  async (req: AuthedRequest, res) => {
    const parsed = z
      .object({
        body: z.string().min(1).max(2000)
      })
      .safeParse(req.body);

    if (!parsed.success) {
      return res
        .status(400)
        .json({
          message: "Invalid comment"
        });
    }

    const taskId = String(
      req.params.id
    );

    const task =
      await prisma.task.findUnique({
        where: {
          id: taskId
        }
      });

    if (!task) {
      return res
        .status(403)
        .json({
          message: "Forbidden"
        });
    }

    const project =
      await prisma.project.findUnique({
        where: {
          id: task.projectId
        }
      });

    if (
      !project ||
      !(await membership(
        req.userId!,
        project.organizationId
      ))
    ) {
      return res
        .status(403)
        .json({
          message: "Forbidden"
        });
    }

    const comment =
      await prisma.comment.create({
        data: {
          body: parsed.data.body,
          taskId: task.id,
          authorId: req.userId!
        },
        include: {
          author: {
            select: {
              name: true
            }
          }
        }
      });

    io.to(
      `project:${task.projectId}`
    ).emit(
      "comment:created",
      comment
    );

    res.status(201).json(comment);
  }
);

/* =========================
   PROJECT ACTIVITY
========================= */

app.get(
  "/api/projects/:id/activity",
  auth,
  async (req: AuthedRequest, res) => {
    const projectId = String(
      req.params.id
    );

    const project =
      await prisma.project.findUnique({
        where: {
          id: projectId
        }
      });

    if (
      !project ||
      !(await membership(
        req.userId!,
        project.organizationId
      ))
    ) {
      return res
        .status(403)
        .json({
          message: "Forbidden"
        });
    }

    const activity =
      await prisma.activity.findMany({
        where: {
          projectId: project.id
        },
        include: {
          actor: {
            select: {
              name: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 50
      });

    res.json(activity);
  }
);

/* =========================
   SOCKET.IO
========================= */

io.on(
  "connection",
  (socket) => {
    socket.on(
      "project:join",
      (projectId: string) => {
        socket.join(
          `project:${projectId}`
        );
      }
    );
  }
);

/* =========================
   SWAGGER
========================= */

const swaggerSpec =
  swaggerJsdoc({
    definition: {
      openapi: "3.0.0",
      info: {
        title: "DevFlow API",
        version: "1.0.0"
      }
    },
    apis: []
  });

app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(
    swaggerSpec
  )
);

/* =========================
   SERVER
========================= */

const port = Number(
  process.env.PORT || 5000
);

httpServer.listen(
  port,
  () =>
    console.log(
      `DevFlow API running on :${port}`
    )
);
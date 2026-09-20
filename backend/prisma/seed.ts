import { PrismaClient, Role, TaskStatus, Priority } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await prisma.user.upsert({
    where: { email: "demo@devflow.local" },
    update: {},
    create: { name: "Demo Developer", email: "demo@devflow.local", passwordHash }
  });

  const org = await prisma.organization.upsert({
    where: { id: "demo-org" },
    update: {},
    create: { id: "demo-org", name: "Acme Engineering" }
  });

  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    update: { role: Role.OWNER },
    create: { userId: user.id, organizationId: org.id, role: Role.OWNER }
  });

  const project = await prisma.project.upsert({
    where: { organizationId_key: { organizationId: org.id, key: "DEV" } },
    update: {},
    create: { organizationId: org.id, name: "DevFlow Platform", key: "DEV", description: "Core engineering platform" }
  });

  const count = await prisma.task.count({ where: { projectId: project.id } });
  if (!count) {
    await prisma.task.createMany({
      data: [
        { title: "Implement authentication", projectId: project.id, assigneeId: user.id, status: TaskStatus.DONE, priority: Priority.HIGH },
        { title: "Build Kanban board", projectId: project.id, assigneeId: user.id, status: TaskStatus.IN_PROGRESS, priority: Priority.HIGH },
        { title: "Add real-time notifications", projectId: project.id, status: TaskStatus.TODO, priority: Priority.MEDIUM }
      ]
    });
  }
}

main().finally(() => prisma.$disconnect());

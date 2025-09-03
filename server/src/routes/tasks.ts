import express from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  projectId: z.string(),
  assigneeId: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  dueDate: z.string().datetime().optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assigneeId: z.string().optional(),
  dueDate: z.string().datetime().optional(),
});

router.get('/project/:projectId', async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const { status, assigneeId } = req.query;

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: req.user!.id },
          {
            members: {
              some: { userId: req.user!.id }
            }
          }
        ]
      }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const whereClause: any = { projectId };
    
    if (status && typeof status === 'string') {
      whereClause.status = status;
    }
    
    if (assigneeId && typeof assigneeId === 'string') {
      whereClause.assigneeId = assigneeId;
    }

    const tasks = await prisma.task.findMany({
      where: whereClause,
      include: {
        assignee: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        },
        creator: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        },
        _count: {
          select: {
            comments: true,
          }
        }
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const task = await prisma.task.findFirst({
      where: {
        id,
        project: {
          OR: [
            { ownerId: req.user!.id },
            {
              members: {
                some: { userId: req.user!.id }
              }
            }
          ]
        }
      },
      include: {
        assignee: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        },
        creator: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        },
        comments: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                avatar: true,
              }
            }
          },
          orderBy: {
            createdAt: 'asc'
          }
        },
        project: {
          select: {
            id: true,
            name: true,
          }
        }
      }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(task);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

router.post('/', async (req: AuthRequest, res) => {
  try {
    const data = createTaskSchema.parse(req.body);

    const project = await prisma.project.findFirst({
      where: {
        id: data.projectId,
        OR: [
          { ownerId: req.user!.id },
          {
            members: {
              some: {
                userId: req.user!.id,
                role: { in: ['OWNER', 'ADMIN', 'MEMBER'] }
              }
            }
          }
        ]
      }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found or insufficient permissions' });
    }

    if (data.assigneeId) {
      const assignee = await prisma.projectMember.findFirst({
        where: {
          userId: data.assigneeId,
          projectId: data.projectId
        }
      });

      if (!assignee) {
        return res.status(400).json({ error: 'Assignee is not a member of this project' });
      }
    }

    const task = await prisma.task.create({
      data: {
        ...data,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        creatorId: req.user!.id,
      },
      include: {
        assignee: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        },
        creator: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        }
      }
    });

    res.status(201).json(task);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: 'Failed to create task' });
  }
});

router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const data = updateTaskSchema.parse(req.body);

    const task = await prisma.task.findFirst({
      where: {
        id,
        project: {
          OR: [
            { ownerId: req.user!.id },
            {
              members: {
                some: {
                  userId: req.user!.id,
                  role: { in: ['OWNER', 'ADMIN', 'MEMBER'] }
                }
              }
            }
          ]
        }
      }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found or insufficient permissions' });
    }

    const updatedTask = await prisma.task.update({
      where: { id },
      data: {
        ...data,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      },
      include: {
        assignee: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        },
        creator: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        }
      }
    });

    res.json(updatedTask);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: 'Failed to update task' });
  }
});

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const task = await prisma.task.findFirst({
      where: {
        id,
        OR: [
          { creatorId: req.user!.id },
          {
            project: {
              OR: [
                { ownerId: req.user!.id },
                {
                  members: {
                    some: {
                      userId: req.user!.id,
                      role: { in: ['OWNER', 'ADMIN'] }
                    }
                  }
                }
              ]
            }
          }
        ]
      }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found or insufficient permissions' });
    }

    await prisma.task.delete({
      where: { id }
    });

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

router.post('/:id/comments', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { content } = z.object({ content: z.string().min(1) }).parse(req.body);

    const task = await prisma.task.findFirst({
      where: {
        id,
        project: {
          OR: [
            { ownerId: req.user!.id },
            {
              members: {
                some: { userId: req.user!.id }
              }
            }
          ]
        }
      }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const comment = await prisma.comment.create({
      data: {
        content,
        userId: req.user!.id,
        taskId: id,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        }
      }
    });

    res.status(201).json(comment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

export default router;
import express from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
});

const updateProjectSchema = createProjectSchema.partial();

router.get('/', async (req: AuthRequest, res) => {
  try {
    const projects = await prisma.project.findMany({
      where: {
        OR: [
          { ownerId: req.user!.id },
          {
            members: {
              some: {
                userId: req.user!.id
              }
            }
          }
        ]
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        },
        members: {
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
        },
        _count: {
          select: {
            tasks: true,
            members: true,
          }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const project = await prisma.project.findFirst({
      where: {
        id,
        OR: [
          { ownerId: req.user!.id },
          {
            members: {
              some: {
                userId: req.user!.id
              }
            }
          }
        ]
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        },
        members: {
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
        },
        tasks: {
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
            _count: {
              select: {
                comments: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json(project);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

router.post('/', async (req: AuthRequest, res) => {
  try {
    const data = createProjectSchema.parse(req.body);

    const project = await prisma.project.create({
      data: {
        ...data,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        ownerId: req.user!.id,
        members: {
          create: {
            userId: req.user!.id,
            role: 'OWNER'
          }
        }
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        },
        members: {
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
        }
      }
    });

    res.status(201).json(project);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: 'Failed to create project' });
  }
});

router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const data = updateProjectSchema.parse(req.body);

    const project = await prisma.project.findFirst({
      where: {
        id,
        OR: [
          { ownerId: req.user!.id },
          {
            members: {
              some: {
                userId: req.user!.id,
                role: {
                  in: ['OWNER', 'ADMIN']
                }
              }
            }
          }
        ]
      }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found or insufficient permissions' });
    }

    const updatedProject = await prisma.project.update({
      where: { id },
      data: {
        ...data,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        },
        members: {
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
        }
      }
    });

    res.json(updatedProject);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: 'Failed to update project' });
  }
});

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const project = await prisma.project.findFirst({
      where: {
        id,
        ownerId: req.user!.id
      }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found or insufficient permissions' });
    }

    await prisma.project.delete({
      where: { id }
    });

    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;
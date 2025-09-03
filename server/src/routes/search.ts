import express from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

const searchSchema = z.object({
  q: z.string().min(1),
  type: z.enum(['all', 'projects', 'tasks', 'users']).default('all'),
  projectId: z.string().optional(),
  filters: z.object({
    status: z.string().optional(),
    priority: z.string().optional(),
    assigneeId: z.string().optional(),
    dateRange: z.object({
      start: z.string().datetime().optional(),
      end: z.string().datetime().optional(),
    }).optional(),
  }).optional(),
});

router.post('/global', async (req: AuthRequest, res) => {
  try {
    const { q, type, projectId, filters } = searchSchema.parse(req.body);

    const userProjects = await prisma.projectMember.findMany({
      where: { userId: req.user!.id },
      select: { projectId: true }
    });

    const accessibleProjectIds = userProjects.map(p => p.projectId);

    const results: any = {
      projects: [],
      tasks: [],
      users: [],
      total: 0
    };

    if (type === 'all' || type === 'projects') {
      const projects = await prisma.project.findMany({
        where: {
          id: { in: accessibleProjectIds },
          OR: [
            {
              name: {
                contains: q,
                mode: 'insensitive'
              }
            },
            {
              description: {
                contains: q,
                mode: 'insensitive'
              }
            }
          ]
        },
        include: {
          owner: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true
            }
          },
          _count: {
            select: {
              tasks: true,
              members: true
            }
          }
        },
        take: 10
      });

      results.projects = projects;
    }

    if (type === 'all' || type === 'tasks') {
      const whereClause: any = {
        projectId: projectId ? projectId : { in: accessibleProjectIds },
        OR: [
          {
            title: {
              contains: q,
              mode: 'insensitive'
            }
          },
          {
            description: {
              contains: q,
              mode: 'insensitive'
            }
          }
        ]
      };

      if (filters?.status) {
        whereClause.status = filters.status;
      }

      if (filters?.priority) {
        whereClause.priority = filters.priority;
      }

      if (filters?.assigneeId) {
        whereClause.assigneeId = filters.assigneeId;
      }

      if (filters?.dateRange?.start || filters?.dateRange?.end) {
        whereClause.createdAt = {};
        if (filters.dateRange.start) {
          whereClause.createdAt.gte = new Date(filters.dateRange.start);
        }
        if (filters.dateRange.end) {
          whereClause.createdAt.lte = new Date(filters.dateRange.end);
        }
      }

      const tasks = await prisma.task.findMany({
        where: whereClause,
        include: {
          assignee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true
            }
          },
          project: {
            select: {
              id: true,
              name: true
            }
          },
          _count: {
            select: {
              comments: true
            }
          }
        },
        orderBy: [
          { priority: 'desc' },
          { updatedAt: 'desc' }
        ],
        take: 20
      });

      results.tasks = tasks;
    }

    if (type === 'all' || type === 'users') {
      const users = await prisma.user.findMany({
        where: {
          id: { in: accessibleProjectIds.length > 0 ? undefined : [] },
          OR: [
            {
              firstName: {
                contains: q,
                mode: 'insensitive'
              }
            },
            {
              lastName: {
                contains: q,
                mode: 'insensitive'
              }
            },
            {
              username: {
                contains: q,
                mode: 'insensitive'
              }
            },
            {
              email: {
                contains: q,
                mode: 'insensitive'
              }
            }
          ]
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          email: true,
          avatar: true,
          _count: {
            select: {
              tasks: true,
              ownedProjects: true
            }
          }
        },
        take: 10
      });

      results.users = users;
    }

    results.total = results.projects.length + results.tasks.length + results.users.length;

    res.json(results);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

router.get('/suggestions', async (req: AuthRequest, res) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string' || q.length < 2) {
      return res.json({ suggestions: [] });
    }

    const userProjects = await prisma.projectMember.findMany({
      where: { userId: req.user!.id },
      select: { projectId: true }
    });

    const accessibleProjectIds = userProjects.map(p => p.projectId);

    const [projectSuggestions, taskSuggestions, userSuggestions] = await Promise.all([
      prisma.project.findMany({
        where: {
          id: { in: accessibleProjectIds },
          name: {
            contains: q,
            mode: 'insensitive'
          }
        },
        select: {
          id: true,
          name: true
        },
        take: 3
      }),

      prisma.task.findMany({
        where: {
          projectId: { in: accessibleProjectIds },
          title: {
            contains: q,
            mode: 'insensitive'
          }
        },
        select: {
          id: true,
          title: true,
          project: {
            select: {
              name: true
            }
          }
        },
        take: 5
      }),

      prisma.user.findMany({
        where: {
          OR: [
            {
              firstName: {
                contains: q,
                mode: 'insensitive'
              }
            },
            {
              lastName: {
                contains: q,
                mode: 'insensitive'
              }
            },
            {
              username: {
                contains: q,
                mode: 'insensitive'
              }
            }
          ]
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          avatar: true
        },
        take: 3
      })
    ]);

    const suggestions = [
      ...projectSuggestions.map(p => ({
        id: p.id,
        type: 'project',
        title: p.name,
        subtitle: 'Project'
      })),
      ...taskSuggestions.map(t => ({
        id: t.id,
        type: 'task',
        title: t.title,
        subtitle: `Task in ${t.project.name}`
      })),
      ...userSuggestions.map(u => ({
        id: u.id,
        type: 'user',
        title: `${u.firstName} ${u.lastName}`,
        subtitle: `@${u.username}`,
        avatar: u.avatar
      }))
    ];

    res.json({ suggestions });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

export default router;
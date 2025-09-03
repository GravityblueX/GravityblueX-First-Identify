import express from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  avatar: z.string().url().optional(),
});

router.get('/me', async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        avatar: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            ownedProjects: true,
            projectMembers: true,
            tasks: true,
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

router.put('/me', async (req: AuthRequest, res) => {
  try {
    const data = updateProfileSchema.parse(req.body);

    const updatedUser = await prisma.user.update({
      where: { id: req.user!.id },
      data,
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        avatar: true,
        role: true,
        updatedAt: true,
      }
    });

    res.json(updatedUser);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.get('/search', async (req: AuthRequest, res) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Search query required' });
    }

    const users = await prisma.user.findMany({
      where: {
        OR: [
          {
            username: {
              contains: q,
              mode: 'insensitive'
            }
          },
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
            email: {
              contains: q,
              mode: 'insensitive'
            }
          }
        ]
      },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        avatar: true,
        email: true,
      },
      take: 10
    });

    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to search users' });
  }
});

router.get('/notifications', async (req: AuthRequest, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

router.put('/notifications/:id/read', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const notification = await prisma.notification.findFirst({
      where: {
        id,
        userId: req.user!.id
      }
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const updatedNotification = await prisma.notification.update({
      where: { id },
      data: { read: true }
    });

    res.json(updatedNotification);
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

router.put('/notifications/read-all', async (req: AuthRequest, res) => {
  try {
    await prisma.notification.updateMany({
      where: {
        userId: req.user!.id,
        read: false
      },
      data: { read: true }
    });

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

export default router;
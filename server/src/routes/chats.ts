import express from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

const createChatSchema = z.object({
  name: z.string().optional(),
  type: z.enum(['PROJECT', 'DIRECT', 'GROUP']).default('GROUP'),
  projectId: z.string().optional(),
  memberIds: z.array(z.string()).optional(),
});

const sendMessageSchema = z.object({
  content: z.string().min(1),
  type: z.enum(['TEXT', 'FILE', 'IMAGE']).default('TEXT'),
});

router.get('/project/:projectId', async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;

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

    let chat = await prisma.chat.findFirst({
      where: {
        projectId,
        type: 'PROJECT'
      },
      include: {
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
        messages: {
          include: {
            sender: {
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
          },
          take: 50
        }
      }
    });

    if (!chat) {
      const projectMembers = await prisma.projectMember.findMany({
        where: { projectId }
      });

      chat = await prisma.chat.create({
        data: {
          name: `${project.name} Chat`,
          type: 'PROJECT',
          projectId,
          members: {
            create: projectMembers.map(member => ({
              userId: member.userId
            }))
          }
        },
        include: {
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
          messages: {
            include: {
              sender: {
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
          }
        }
      });
    }

    res.json(chat);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch or create project chat' });
  }
});

router.post('/:id/messages', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const data = sendMessageSchema.parse(req.body);

    const chatMember = await prisma.chatMember.findFirst({
      where: {
        chatId: id,
        userId: req.user!.id
      }
    });

    if (!chatMember) {
      return res.status(403).json({ error: 'You are not a member of this chat' });
    }

    const message = await prisma.message.create({
      data: {
        content: data.content,
        type: data.type,
        senderId: req.user!.id,
        chatId: id,
      },
      include: {
        sender: {
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

    res.status(201).json(message);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: 'Failed to send message' });
  }
});

router.get('/:id/messages', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { page = '1', limit = '50' } = req.query;

    const chatMember = await prisma.chatMember.findFirst({
      where: {
        chatId: id,
        userId: req.user!.id
      }
    });

    if (!chatMember) {
      return res.status(403).json({ error: 'You are not a member of this chat' });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const messages = await prisma.message.findMany({
      where: { chatId: id },
      include: {
        sender: {
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
        createdAt: 'desc'
      },
      skip,
      take: limitNum
    });

    res.json(messages.reverse());
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

export default router;
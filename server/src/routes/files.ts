import express from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { upload, FileService } from '../services/fileService';

const router = express.Router();
const prisma = new PrismaClient();

router.post('/upload', upload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { projectId, taskId } = req.body;

    if (projectId) {
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
    }

    if (taskId) {
      const task = await prisma.task.findFirst({
        where: {
          id: taskId,
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
    }

    const uploadResult = await FileService.uploadToCloudinary(req.file);

    const file = await prisma.file.create({
      data: {
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype,
        url: uploadResult.url,
        projectId: projectId || null,
        taskId: taskId || null,
      }
    });

    res.status(201).json(file);
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
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

    const files = await prisma.file.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' }
    });

    res.json(files);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

router.get('/task/:taskId', async (req: AuthRequest, res) => {
  try {
    const { taskId } = req.params;

    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
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

    const files = await prisma.file.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' }
    });

    res.json(files);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const file = await prisma.file.findFirst({
      where: {
        id,
        OR: [
          {
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
          },
          {
            task: {
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
          }
        ]
      }
    });

    if (!file) {
      return res.status(404).json({ error: 'File not found or insufficient permissions' });
    }

    // Extract public ID from Cloudinary URL
    const urlParts = file.url.split('/');
    const publicIdWithExtension = urlParts[urlParts.length - 1];
    const publicId = publicIdWithExtension.split('.')[0];

    await FileService.deleteFromCloudinary(`teamsync/${publicId}`);
    await prisma.file.delete({ where: { id } });

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('File deletion error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

export default router;
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

export function setupSocketIO(io: Server) {
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || 'fallback-secret'
      ) as any;

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId }
      });

      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = user.id;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`User ${socket.userId} connected`);

    socket.on('join-project', async (projectId: string) => {
      try {
        const projectMember = await prisma.projectMember.findFirst({
          where: {
            projectId,
            userId: socket.userId!
          }
        });

        if (projectMember) {
          socket.join(`project:${projectId}`);
          socket.emit('joined-project', projectId);
        }
      } catch (error) {
        socket.emit('error', 'Failed to join project');
      }
    });

    socket.on('leave-project', (projectId: string) => {
      socket.leave(`project:${projectId}`);
      socket.emit('left-project', projectId);
    });

    socket.on('join-chat', async (chatId: string) => {
      try {
        const chatMember = await prisma.chatMember.findFirst({
          where: {
            chatId,
            userId: socket.userId!
          }
        });

        if (chatMember) {
          socket.join(`chat:${chatId}`);
          socket.emit('joined-chat', chatId);
        }
      } catch (error) {
        socket.emit('error', 'Failed to join chat');
      }
    });

    socket.on('send-message', async (data: {
      chatId: string;
      content: string;
      type?: 'TEXT' | 'FILE' | 'IMAGE';
    }) => {
      try {
        const chatMember = await prisma.chatMember.findFirst({
          where: {
            chatId: data.chatId,
            userId: socket.userId!
          }
        });

        if (!chatMember) {
          socket.emit('error', 'Not a member of this chat');
          return;
        }

        const message = await prisma.message.create({
          data: {
            content: data.content,
            type: data.type || 'TEXT',
            senderId: socket.userId!,
            chatId: data.chatId,
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

        io.to(`chat:${data.chatId}`).emit('new-message', message);
      } catch (error) {
        socket.emit('error', 'Failed to send message');
      }
    });

    socket.on('task-updated', async (data: {
      taskId: string;
      projectId: string;
      changes: Partial<Task>;
    }) => {
      try {
        const task = await prisma.task.findFirst({
          where: {
            id: data.taskId,
            project: {
              OR: [
                { ownerId: socket.userId! },
                {
                  members: {
                    some: { userId: socket.userId! }
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
            }
          }
        });

        if (task) {
          socket.to(`project:${data.projectId}`).emit('task-updated', {
            taskId: data.taskId,
            task,
            changes: data.changes
          });

          if (task.assigneeId && task.assigneeId !== socket.userId) {
            await prisma.notification.create({
              data: {
                title: 'Task Updated',
                message: `Task "${task.title}" has been updated`,
                type: 'TASK_UPDATED',
                userId: task.assigneeId,
              }
            });

            io.to(`user:${task.assigneeId}`).emit('new-notification', {
              title: 'Task Updated',
              message: `Task "${task.title}" has been updated`,
              type: 'TASK_UPDATED',
            });
          }
        }
      } catch (error) {
        socket.emit('error', 'Failed to update task');
      }
    });

    socket.on('typing-start', (data: { chatId: string }) => {
      socket.to(`chat:${data.chatId}`).emit('user-typing', {
        userId: socket.userId,
        chatId: data.chatId
      });
    });

    socket.on('typing-stop', (data: { chatId: string }) => {
      socket.to(`chat:${data.chatId}`).emit('user-stopped-typing', {
        userId: socket.userId,
        chatId: data.chatId
      });
    });

    socket.on('user-online', () => {
      socket.broadcast.emit('user-status-changed', {
        userId: socket.userId,
        status: 'online'
      });
    });

    socket.on('disconnect', () => {
      console.log(`User ${socket.userId} disconnected`);
      socket.broadcast.emit('user-status-changed', {
        userId: socket.userId,
        status: 'offline'
      });
    });
  });
}
import { PrismaClient } from '@prisma/client';
import { AuthenticationError, ForbiddenError } from 'apollo-server-express';
import { withFilter } from 'graphql-subscriptions';
import { pubsub } from './pubsub';
import AIService from '../services/aiService';

const prisma = new PrismaClient();

export const resolvers = {
  Query: {
    me: async (_: any, __: any, { user }: any) => {
      if (!user) throw new AuthenticationError('Not authenticated');
      
      return await prisma.user.findUnique({
        where: { id: user.id },
        include: {
          _count: {
            select: {
              ownedProjects: true,
              projectMembers: true,
              tasks: true
            }
          }
        }
      });
    },

    projects: async (_: any, __: any, { user }: any) => {
      if (!user) throw new AuthenticationError('Not authenticated');

      return await prisma.project.findMany({
        where: {
          OR: [
            { ownerId: user.id },
            {
              members: {
                some: { userId: user.id }
              }
            }
          ]
        },
        include: {
          owner: true,
          members: {
            include: { user: true }
          },
          _count: {
            select: { tasks: true, members: true }
          }
        },
        orderBy: { updatedAt: 'desc' }
      });
    },

    project: async (_: any, { id }: any, { user }: any) => {
      if (!user) throw new AuthenticationError('Not authenticated');

      const project = await prisma.project.findFirst({
        where: {
          id,
          OR: [
            { ownerId: user.id },
            {
              members: {
                some: { userId: user.id }
              }
            }
          ]
        },
        include: {
          owner: true,
          members: {
            include: { user: true }
          },
          tasks: {
            include: {
              assignee: true,
              creator: true,
              _count: { select: { comments: true } }
            }
          }
        }
      });

      if (!project) throw new ForbiddenError('Project not found or access denied');
      return project;
    },

    tasks: async (_: any, { filters }: any, { user }: any) => {
      if (!user) throw new AuthenticationError('Not authenticated');

      const whereClause: any = {};

      if (filters) {
        if (filters.status) whereClause.status = filters.status;
        if (filters.priority) whereClause.priority = filters.priority;
        if (filters.assigneeId) whereClause.assigneeId = filters.assigneeId;
        if (filters.projectId) whereClause.projectId = filters.projectId;
        
        if (filters.dateRange) {
          whereClause.createdAt = {};
          if (filters.dateRange.start) {
            whereClause.createdAt.gte = new Date(filters.dateRange.start);
          }
          if (filters.dateRange.end) {
            whereClause.createdAt.lte = new Date(filters.dateRange.end);
          }
        }
      }

      // Ensure user can only see tasks from their projects
      whereClause.project = {
        OR: [
          { ownerId: user.id },
          {
            members: {
              some: { userId: user.id }
            }
          }
        ]
      };

      return await prisma.task.findMany({
        where: whereClause,
        include: {
          project: true,
          assignee: true,
          creator: true,
          comments: {
            include: { user: true }
          },
          files: true
        },
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'desc' }
        ]
      });
    },

    projectAnalytics: async (_: any, { projectId, timeRange }: any, { user }: any) => {
      if (!user) throw new AuthenticationError('Not authenticated');

      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          OR: [
            { ownerId: user.id },
            {
              members: {
                some: { userId: user.id }
              }
            }
          ]
        }
      });

      if (!project) throw new ForbiddenError('Project not found or access denied');

      const startDate = new Date(Date.now() - timeRange * 24 * 60 * 60 * 1000);

      const [taskStats, memberStats, velocityData] = await Promise.all([
        prisma.task.groupBy({
          by: ['status'],
          where: { projectId },
          _count: { id: true }
        }),

        prisma.task.groupBy({
          by: ['assigneeId'],
          where: { 
            projectId,
            assigneeId: { not: null },
            updatedAt: { gte: startDate }
          },
          _count: { id: true }
        }),

        calculateVelocity(projectId, timeRange)
      ]);

      const totalTasks = taskStats.reduce((sum, stat) => sum + stat._count.id, 0);
      const completedTasks = taskStats.find(s => s.status === 'DONE')?._count.id || 0;

      return {
        overview: {
          totalTasks,
          completedTasks,
          inProgressTasks: taskStats.find(s => s.status === 'IN_PROGRESS')?._count.id || 0,
          pendingTasks: taskStats.find(s => s.status === 'TODO')?._count.id || 0,
          completionRate: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0
        },
        taskDistribution: taskStats.map(stat => ({
          status: stat.status,
          count: stat._count.id
        })),
        memberProductivity: await Promise.all(
          memberStats.map(async (stat) => {
            const user = await prisma.user.findUnique({
              where: { id: stat.assigneeId! }
            });
            return {
              user,
              taskCount: stat._count.id,
              completionRate: 85 // Calculate based on completed vs total
            };
          })
        ),
        velocityData,
        riskFactors: await assessRisks(projectId)
      };
    },

    aiRecommendations: async (_: any, { projectId }: any, { user }: any) => {
      if (!user) throw new AuthenticationError('Not authenticated');

      return await AIService.generateTaskRecommendations(user.id, projectId);
    },

    globalSearch: async (_: any, { query, type }: any, { user }: any) => {
      if (!user) throw new AuthenticationError('Not authenticated');

      const userProjects = await prisma.projectMember.findMany({
        where: { userId: user.id },
        select: { projectId: true }
      });

      const projectIds = userProjects.map(p => p.projectId);

      const results: any = {
        projects: [],
        tasks: [],
        users: [],
        total: 0
      };

      if (type === 'all' || type === 'projects') {
        results.projects = await prisma.project.findMany({
          where: {
            id: { in: projectIds },
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } }
            ]
          },
          include: {
            owner: true,
            _count: { select: { tasks: true, members: true } }
          },
          take: 10
        });
      }

      if (type === 'all' || type === 'tasks') {
        results.tasks = await prisma.task.findMany({
          where: {
            projectId: { in: projectIds },
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } }
            ]
          },
          include: {
            project: true,
            assignee: true,
            creator: true
          },
          take: 20
        });
      }

      if (type === 'all' || type === 'users') {
        results.users = await prisma.user.findMany({
          where: {
            OR: [
              { firstName: { contains: query, mode: 'insensitive' } },
              { lastName: { contains: query, mode: 'insensitive' } },
              { username: { contains: query, mode: 'insensitive' } },
              { email: { contains: query, mode: 'insensitive' } }
            ]
          },
          take: 10
        });
      }

      results.total = results.projects.length + results.tasks.length + results.users.length;

      return results;
    }
  },

  Mutation: {
    createProject: async (_: any, { input }: any, { user }: any) => {
      if (!user) throw new AuthenticationError('Not authenticated');

      const project = await prisma.project.create({
        data: {
          ...input,
          startDate: input.startDate ? new Date(input.startDate) : null,
          endDate: input.endDate ? new Date(input.endDate) : null,
          ownerId: user.id,
          members: {
            create: {
              userId: user.id,
              role: 'OWNER'
            }
          }
        },
        include: {
          owner: true,
          members: {
            include: { user: true }
          }
        }
      });

      pubsub.publish('PROJECT_CREATED', { projectCreated: project });
      return project;
    },

    updateTask: async (_: any, { id, input }: any, { user, pubsub }: any) => {
      if (!user) throw new AuthenticationError('Not authenticated');

      const task = await prisma.task.findFirst({
        where: {
          id,
          project: {
            OR: [
              { ownerId: user.id },
              {
                members: {
                  some: { userId: user.id }
                }
              }
            ]
          }
        }
      });

      if (!task) throw new ForbiddenError('Task not found or access denied');

      const updatedTask = await prisma.task.update({
        where: { id },
        data: {
          ...input,
          dueDate: input.dueDate ? new Date(input.dueDate) : undefined
        },
        include: {
          project: true,
          assignee: true,
          creator: true,
          comments: {
            include: { user: true }
          }
        }
      });

      pubsub.publish('TASK_UPDATED', { 
        taskUpdated: updatedTask,
        projectId: updatedTask.projectId 
      });

      return updatedTask;
    },

    addTaskComment: async (_: any, { taskId, content }: any, { user }: any) => {
      if (!user) throw new AuthenticationError('Not authenticated');

      const task = await prisma.task.findFirst({
        where: {
          id: taskId,
          project: {
            OR: [
              { ownerId: user.id },
              {
                members: {
                  some: { userId: user.id }
                }
              }
            ]
          }
        }
      });

      if (!task) throw new ForbiddenError('Task not found or access denied');

      const comment = await prisma.comment.create({
        data: {
          content,
          userId: user.id,
          taskId
        },
        include: {
          user: true,
          task: {
            include: {
              project: true
            }
          }
        }
      });

      pubsub.publish('COMMENT_ADDED', { 
        commentAdded: comment,
        taskId 
      });

      return comment;
    }
  },

  Subscription: {
    taskUpdated: {
      subscribe: withFilter(
        () => pubsub.asyncIterator(['TASK_UPDATED']),
        (payload, variables, context) => {
          return payload.projectId === variables.projectId;
        }
      ),
      resolve: (payload: any) => payload.taskUpdated
    },

    newMessage: {
      subscribe: withFilter(
        () => pubsub.asyncIterator(['NEW_MESSAGE']),
        async (payload, variables, context) => {
          if (!context.user) return false;
          
          const chatMember = await prisma.chatMember.findFirst({
            where: {
              chatId: variables.chatId,
              userId: context.user.id
            }
          });
          
          return !!chatMember;
        }
      ),
      resolve: (payload: any) => payload.newMessage
    },

    projectUpdated: {
      subscribe: withFilter(
        () => pubsub.asyncIterator(['PROJECT_UPDATED']),
        async (payload, variables, context) => {
          if (!context.user) return false;
          
          const projectMember = await prisma.projectMember.findFirst({
            where: {
              projectId: variables.projectId,
              userId: context.user.id
            }
          });
          
          return !!projectMember;
        }
      ),
      resolve: (payload: any) => payload.projectUpdated
    },

    notificationReceived: {
      subscribe: withFilter(
        () => pubsub.asyncIterator(['NEW_NOTIFICATION']),
        (payload, variables, context) => {
          return payload.userId === context.user?.id;
        }
      ),
      resolve: (payload: any) => payload.notification
    }
  },

  // Field resolvers
  Project: {
    analytics: async (parent: any, _: any, { user }: any) => {
      // This will be resolved by the projectAnalytics query
      return null;
    }
  },

  Task: {
    comments: async (parent: any) => {
      return await prisma.comment.findMany({
        where: { taskId: parent.id },
        include: { user: true },
        orderBy: { createdAt: 'asc' }
      });
    },

    files: async (parent: any) => {
      return await prisma.file.findMany({
        where: { taskId: parent.id },
        orderBy: { createdAt: 'desc' }
      });
    }
  },

  User: {
    projects: async (parent: any) => {
      return await prisma.projectMember.findMany({
        where: { userId: parent.id },
        include: {
          project: true,
          user: true
        }
      });
    },

    assignedTasks: async (parent: any) => {
      return await prisma.task.findMany({
        where: { assigneeId: parent.id },
        include: {
          project: true,
          creator: true
        }
      });
    }
  }
};

// Helper functions
async function calculateVelocity(projectId: string, timeRange: number) {
  const weeks = [];
  const now = new Date();
  
  for (let i = 0; i < Math.min(timeRange / 7, 12); i++) {
    const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    
    const completed = await prisma.task.count({
      where: {
        projectId,
        status: 'DONE',
        updatedAt: {
          gte: weekStart,
          lt: weekEnd
        }
      }
    });
    
    weeks.unshift({
      week: `Week ${Math.ceil((timeRange / 7)) - i}`,
      completed
    });
  }
  
  return weeks;
}

async function assessRisks(projectId: string) {
  const risks = [];
  
  const [overdueTasks, urgentTasks, unassignedTasks] = await Promise.all([
    prisma.task.count({
      where: {
        projectId,
        dueDate: { lt: new Date() },
        status: { not: 'DONE' }
      }
    }),
    
    prisma.task.count({
      where: {
        projectId,
        priority: 'URGENT',
        status: { not: 'DONE' }
      }
    }),
    
    prisma.task.count({
      where: {
        projectId,
        assigneeId: null,
        status: { not: 'DONE' }
      }
    })
  ]);

  if (overdueTasks > 0) {
    risks.push({
      type: 'overdue_tasks',
      severity: 'HIGH',
      description: `${overdueTasks} tasks are overdue`,
      count: overdueTasks
    });
  }

  if (urgentTasks > 3) {
    risks.push({
      type: 'too_many_urgent',
      severity: 'MEDIUM',
      description: `${urgentTasks} urgent tasks may indicate planning issues`,
      count: urgentTasks
    });
  }

  if (unassignedTasks > 0) {
    risks.push({
      type: 'unassigned_tasks',
      severity: 'LOW',
      description: `${unassignedTasks} tasks need assignment`,
      count: unassignedTasks
    });
  }

  return risks;
}

export default resolvers;
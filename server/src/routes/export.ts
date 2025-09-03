import express from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

interface ExportData {
  project: any;
  tasks: any[];
  members: any[];
  messages?: any[];
  analytics?: any;
}

router.get('/project/:projectId', async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const { format = 'json', includeMessages = 'false', includeAnalytics = 'false' } = req.query;

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
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
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found or insufficient permissions' });
    }

    const [tasks, members] = await Promise.all([
      prisma.task.findMany({
        where: { projectId },
        include: {
          assignee: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              email: true
            }
          },
          creator: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              email: true
            }
          },
          comments: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true
                }
              }
            }
          }
        }
      }),

      prisma.projectMember.findMany({
        where: { projectId },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true
            }
          }
        }
      })
    ]);

    const exportData: ExportData = {
      project,
      tasks,
      members
    };

    // Include messages if requested
    if (includeMessages === 'true') {
      const projectChat = await prisma.chat.findFirst({
        where: { projectId, type: 'PROJECT' },
        include: {
          messages: {
            include: {
              sender: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true
                }
              }
            },
            orderBy: { createdAt: 'asc' }
          }
        }
      });

      exportData.messages = projectChat?.messages || [];
    }

    // Include analytics if requested
    if (includeAnalytics === 'true') {
      const analytics = await generateProjectAnalytics(projectId);
      exportData.analytics = analytics;
    }

    const filename = `${project.name.replace(/[^a-zA-Z0-9]/g, '_')}_export_${new Date().toISOString().split('T')[0]}`;

    if (format === 'csv') {
      const csv = await convertToCSV(exportData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(csv);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json(exportData);
    }

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export project data' });
  }
});

router.get('/analytics/:projectId', async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const { timeRange = '30' } = req.query;

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

    const analytics = await generateDetailedAnalytics(projectId, parseInt(timeRange as string));
    
    const filename = `${project.name.replace(/[^a-zA-Z0-9]/g, '_')}_analytics_${new Date().toISOString().split('T')[0]}`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    res.json(analytics);

  } catch (error) {
    console.error('Analytics export error:', error);
    res.status(500).json({ error: 'Failed to export analytics data' });
  }
});

async function generateProjectAnalytics(projectId: string) {
  const [taskStats, memberStats, timeline] = await Promise.all([
    prisma.task.groupBy({
      by: ['status', 'priority'],
      where: { projectId },
      _count: { id: true }
    }),

    prisma.task.groupBy({
      by: ['assigneeId'],
      where: { 
        projectId,
        assigneeId: { not: null }
      },
      _count: { id: true }
    }),

    prisma.task.findMany({
      where: { projectId },
      select: {
        status: true,
        createdAt: true,
        updatedAt: true,
        priority: true
      },
      orderBy: { createdAt: 'asc' }
    })
  ]);

  return {
    taskDistribution: taskStats,
    memberWorkload: memberStats,
    timeline,
    summary: {
      totalTasks: timeline.length,
      completedTasks: timeline.filter(t => t.status === 'DONE').length,
      averageCompletionTime: calculateAverageCompletionTime(timeline)
    }
  };
}

async function generateDetailedAnalytics(projectId: string, timeRange: number) {
  const startDate = new Date(Date.now() - timeRange * 24 * 60 * 60 * 1000);

  const [
    velocityData,
    burndownData,
    teamPerformance,
    riskAssessment
  ] = await Promise.all([
    calculateVelocity(projectId, startDate),
    calculateBurndown(projectId),
    calculateTeamPerformance(projectId, startDate),
    assessProjectRisks(projectId)
  ]);

  return {
    velocity: velocityData,
    burndown: burndownData,
    teamPerformance,
    risks: riskAssessment,
    generatedAt: new Date().toISOString(),
    timeRange: `${timeRange} days`
  };
}

async function convertToCSV(data: ExportData): Promise<string> {
  const csvRows = [];
  
  // Header
  csvRows.push('Type,ID,Title,Status,Priority,Assignee,Created,Updated,Description');
  
  // Project row
  csvRows.push([
    'Project',
    data.project.id,
    `"${data.project.name}"`,
    data.project.status,
    data.project.priority,
    `"${data.project.owner.firstName} ${data.project.owner.lastName}"`,
    data.project.createdAt,
    data.project.updatedAt,
    `"${data.project.description || ''}"`
  ].join(','));

  // Task rows
  data.tasks.forEach(task => {
    csvRows.push([
      'Task',
      task.id,
      `"${task.title}"`,
      task.status,
      task.priority,
      task.assignee ? `"${task.assignee.firstName} ${task.assignee.lastName}"` : '',
      task.createdAt,
      task.updatedAt,
      `"${task.description || ''}"`
    ].join(','));
  });

  return csvRows.join('\n');
}

// Helper functions
function calculateAverageCompletionTime(tasks: any[]): number {
  const completedTasks = tasks.filter(t => t.status === 'DONE');
  if (completedTasks.length === 0) return 0;
  
  const totalTime = completedTasks.reduce((sum, task) => {
    const completionTime = new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime();
    return sum + completionTime;
  }, 0);
  
  return Math.round(totalTime / completedTasks.length / (24 * 60 * 60 * 1000)); // days
}

async function calculateVelocity(projectId: string, startDate: Date) {
  const weeksData = [];
  const now = new Date();
  
  for (let i = 0; i < 4; i++) {
    const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    
    const completedTasks = await prisma.task.count({
      where: {
        projectId,
        status: 'DONE',
        updatedAt: {
          gte: weekStart,
          lt: weekEnd
        }
      }
    });
    
    weeksData.unshift({
      week: `Week ${4 - i}`,
      completed: completedTasks
    });
  }
  
  return weeksData;
}

async function calculateBurndown(projectId: string) {
  const totalTasks = await prisma.task.count({ where: { projectId } });
  const completedTasks = await prisma.task.count({ 
    where: { projectId, status: 'DONE' } 
  });
  
  return {
    total: totalTasks,
    completed: completedTasks,
    remaining: totalTasks - completedTasks,
    burndownRate: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0
  };
}

async function calculateTeamPerformance(projectId: string, startDate: Date) {
  return await prisma.user.findMany({
    where: {
      projectMembers: {
        some: { projectId }
      }
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      _count: {
        select: {
          tasks: {
            where: {
              projectId,
              status: 'DONE',
              updatedAt: { gte: startDate }
            }
          }
        }
      }
    }
  });
}

async function assessProjectRisks(projectId: string) {
  const risks = [];
  
  const overdueTasks = await prisma.task.count({
    where: {
      projectId,
      dueDate: { lt: new Date() },
      status: { not: 'DONE' }
    }
  });

  const urgentTasks = await prisma.task.count({
    where: {
      projectId,
      priority: 'URGENT',
      status: { not: 'DONE' }
    }
  });

  const unassignedTasks = await prisma.task.count({
    where: {
      projectId,
      assigneeId: null,
      status: { not: 'DONE' }
    }
  });

  if (overdueTasks > 0) {
    risks.push({
      type: 'overdue_tasks',
      severity: 'high',
      count: overdueTasks,
      description: `${overdueTasks} tasks are overdue`
    });
  }

  if (urgentTasks > 3) {
    risks.push({
      type: 'too_many_urgent',
      severity: 'medium',
      count: urgentTasks,
      description: `${urgentTasks} urgent tasks may indicate poor planning`
    });
  }

  if (unassignedTasks > 0) {
    risks.push({
      type: 'unassigned_tasks',
      severity: 'low',
      count: unassignedTasks,
      description: `${unassignedTasks} tasks are unassigned`
    });
  }

  return risks;
}

export default router;
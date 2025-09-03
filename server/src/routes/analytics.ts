import express from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

router.get('/dashboard/:projectId', async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const { timeRange = '30' } = req.query;
    
    const days = parseInt(timeRange as string);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

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

    const [
      taskStats,
      memberStats,
      progressData,
      activityData
    ] = await Promise.all([
      // Task statistics
      prisma.task.groupBy({
        by: ['status', 'priority'],
        where: { projectId },
        _count: { id: true }
      }),
      
      // Member productivity
      prisma.task.groupBy({
        by: ['assigneeId'],
        where: { 
          projectId,
          assigneeId: { not: null },
          updatedAt: { gte: startDate }
        },
        _count: { id: true }
      }),
      
      // Progress over time
      prisma.$queryRaw`
        SELECT 
          DATE(created_at) as date,
          status,
          COUNT(*) as count
        FROM tasks 
        WHERE project_id = ${projectId}
          AND created_at >= ${startDate}
        GROUP BY DATE(created_at), status
        ORDER BY date ASC
      `,
      
      // Activity timeline
      prisma.task.findMany({
        where: { 
          projectId,
          updatedAt: { gte: startDate }
        },
        select: {
          id: true,
          title: true,
          status: true,
          updatedAt: true,
          assignee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true
            }
          }
        },
        orderBy: { updatedAt: 'desc' },
        take: 20
      })
    ]);

    const tasksByStatus = taskStats.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + item._count.id;
      return acc;
    }, {} as Record<string, number>);

    const tasksByPriority = taskStats.reduce((acc, item) => {
      acc[item.priority] = (acc[item.priority] || 0) + item._count.id;
      return acc;
    }, {} as Record<string, number>);

    const memberProductivity = await Promise.all(
      memberStats.map(async (stat) => {
        if (!stat.assigneeId) return null;
        
        const user = await prisma.user.findUnique({
          where: { id: stat.assigneeId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true
          }
        });
        
        return {
          user,
          taskCount: stat._count.id
        };
      })
    );

    const analytics = {
      overview: {
        totalTasks: Object.values(tasksByStatus).reduce((sum, count) => sum + count, 0),
        completedTasks: tasksByStatus.DONE || 0,
        inProgressTasks: tasksByStatus.IN_PROGRESS || 0,
        pendingTasks: tasksByStatus.TODO || 0,
        completionRate: tasksByStatus.DONE 
          ? Math.round((tasksByStatus.DONE / Object.values(tasksByStatus).reduce((sum, count) => sum + count, 0)) * 100)
          : 0
      },
      tasksByStatus,
      tasksByPriority,
      memberProductivity: memberProductivity.filter(Boolean),
      progressData,
      recentActivity: activityData
    };

    res.json(analytics);
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
});

router.get('/team-performance', async (req: AuthRequest, res) => {
  try {
    const { timeRange = '30' } = req.query;
    const days = parseInt(timeRange as string);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const userProjects = await prisma.projectMember.findMany({
      where: { userId: req.user!.id },
      select: { projectId: true }
    });

    const projectIds = userProjects.map(p => p.projectId);

    const teamPerformance = await prisma.$queryRaw`
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.avatar,
        COUNT(CASE WHEN t.status = 'DONE' THEN 1 END) as completed_tasks,
        COUNT(t.id) as total_tasks,
        AVG(CASE WHEN t.status = 'DONE' 
          THEN EXTRACT(EPOCH FROM (t.updated_at - t.created_at))/86400 
          ELSE NULL END) as avg_completion_days
      FROM users u
      LEFT JOIN tasks t ON u.id = t.assignee_id 
        AND t.project_id = ANY(${projectIds}::text[])
        AND t.updated_at >= ${startDate}
      GROUP BY u.id, u.first_name, u.last_name, u.avatar
      HAVING COUNT(t.id) > 0
      ORDER BY completed_tasks DESC
    `;

    res.json(teamPerformance);
  } catch (error) {
    console.error('Team performance error:', error);
    res.status(500).json({ error: 'Failed to fetch team performance data' });
  }
});

router.get('/project-insights/:projectId', async (req: AuthRequest, res) => {
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

    const insights = await prisma.$queryRaw`
      SELECT 
        'velocity' as metric,
        COUNT(CASE WHEN status = 'DONE' AND updated_at >= NOW() - INTERVAL '7 days' THEN 1 END) as current_week,
        COUNT(CASE WHEN status = 'DONE' AND updated_at >= NOW() - INTERVAL '14 days' AND updated_at < NOW() - INTERVAL '7 days' THEN 1 END) as previous_week
      FROM tasks WHERE project_id = ${projectId}
      
      UNION ALL
      
      SELECT 
        'burndown' as metric,
        COUNT(CASE WHEN status != 'DONE' THEN 1 END) as remaining_tasks,
        COUNT(*) as total_tasks
      FROM tasks WHERE project_id = ${projectId}
    `;

    const riskFactors = await prisma.task.findMany({
      where: {
        projectId,
        OR: [
          {
            dueDate: {
              lte: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days from now
            },
            status: { not: 'DONE' }
          },
          {
            priority: 'URGENT',
            status: { not: 'DONE' }
          }
        ]
      },
      select: {
        id: true,
        title: true,
        priority: true,
        dueDate: true,
        status: true,
        assignee: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.json({
      insights,
      riskFactors,
      recommendations: generateRecommendations(insights, riskFactors)
    });
  } catch (error) {
    console.error('Project insights error:', error);
    res.status(500).json({ error: 'Failed to fetch project insights' });
  }
});

function generateRecommendations(insights: any[], riskFactors: any[]) {
  const recommendations = [];

  if (riskFactors.length > 0) {
    recommendations.push({
      type: 'warning',
      title: 'Overdue Tasks Detected',
      message: `${riskFactors.length} tasks are at risk. Consider redistributing workload.`,
      action: 'Review high-priority tasks'
    });
  }

  if (riskFactors.filter(t => t.priority === 'URGENT').length > 2) {
    recommendations.push({
      type: 'critical',
      title: 'Too Many Urgent Tasks',
      message: 'Consider breaking down urgent tasks into smaller chunks.',
      action: 'Prioritize and delegate'
    });
  }

  recommendations.push({
    type: 'info',
    title: 'Team Performance',
    message: 'Team velocity is stable. Keep up the good work!',
    action: 'Continue current workflow'
  });

  return recommendations;
}

export default router;
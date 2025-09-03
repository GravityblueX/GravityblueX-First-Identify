import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class AIService {
  static async generateTaskRecommendations(userId: string, projectId: string) {
    try {
      const [userStats, projectTasks, teamMembers] = await Promise.all([
        prisma.task.groupBy({
          by: ['status', 'priority'],
          where: {
            assigneeId: userId,
            projectId,
            updatedAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
            }
          },
          _count: { id: true }
        }),

        prisma.task.findMany({
          where: {
            projectId,
            status: { not: 'DONE' }
          },
          include: {
            assignee: {
              select: {
                id: true,
                firstName: true,
                lastName: true
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
                firstName: true,
                lastName: true,
                _count: {
                  select: {
                    tasks: {
                      where: {
                        projectId,
                        status: { in: ['TODO', 'IN_PROGRESS'] }
                      }
                    }
                  }
                }
              }
            }
          }
        })
      ]);

      const recommendations = [];

      // Workload balancing
      const userTaskCount = userStats.reduce((sum, stat) => sum + stat._count.id, 0);
      const avgTaskCount = teamMembers.reduce((sum, member) => 
        sum + member.user._count.tasks, 0) / teamMembers.length;

      if (userTaskCount > avgTaskCount * 1.5) {
        recommendations.push({
          type: 'workload_warning',
          title: 'Heavy Workload Detected',
          description: 'You have significantly more tasks than team average. Consider delegating or requesting help.',
          priority: 'HIGH',
          suggestions: [
            'Delegate lower priority tasks to available team members',
            'Break down complex tasks into smaller chunks',
            'Request deadline extensions if needed'
          ]
        });
      }

      // Priority suggestions
      const urgentTasks = projectTasks.filter(t => t.priority === 'URGENT' && !t.assigneeId);
      if (urgentTasks.length > 0) {
        recommendations.push({
          type: 'priority_alert',
          title: 'Unassigned Urgent Tasks',
          description: `${urgentTasks.length} urgent tasks need immediate attention.`,
          priority: 'URGENT',
          tasks: urgentTasks.slice(0, 3).map(t => ({ id: t.id, title: t.title })),
          suggestions: [
            'Assign urgent tasks to available team members',
            'Review task priorities and deadlines',
            'Consider adding more resources to the project'
          ]
        });
      }

      // Productivity insights
      const completedTasks = userStats.find(s => s.status === 'DONE')?._count.id || 0;
      const totalTasks = userStats.reduce((sum, stat) => sum + stat._count.id, 0);
      const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

      if (completionRate > 80) {
        recommendations.push({
          type: 'productivity_boost',
          title: 'Excellent Performance!',
          description: `You have an ${Math.round(completionRate)}% task completion rate. Keep up the great work!`,
          priority: 'LOW',
          suggestions: [
            'Consider taking on more challenging tasks',
            'Share your productivity tips with the team',
            'Mentor team members who might need help'
          ]
        });
      } else if (completionRate < 50) {
        recommendations.push({
          type: 'productivity_improvement',
          title: 'Room for Improvement',
          description: 'Your task completion rate could be improved. Here are some suggestions.',
          priority: 'MEDIUM',
          suggestions: [
            'Break down large tasks into smaller, manageable pieces',
            'Set daily goals and track progress',
            'Remove distractions during focused work time',
            'Ask for help when stuck on challenging tasks'
          ]
        });
      }

      // Time management
      const overdueTasks = await prisma.task.count({
        where: {
          assigneeId: userId,
          projectId,
          dueDate: {
            lt: new Date()
          },
          status: { not: 'DONE' }
        }
      });

      if (overdueTasks > 0) {
        recommendations.push({
          type: 'deadline_warning',
          title: 'Overdue Tasks Alert',
          description: `You have ${overdueTasks} overdue tasks that need attention.`,
          priority: 'HIGH',
          suggestions: [
            'Prioritize overdue tasks in your daily schedule',
            'Communicate with project manager about realistic deadlines',
            'Consider if tasks can be broken down or delegated'
          ]
        });
      }

      return recommendations;
    } catch (error) {
      console.error('AI recommendations error:', error);
      throw new Error('Failed to generate recommendations');
    }
  }

  static async predictProjectCompletion(projectId: string) {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          tasks: {
            select: {
              status: true,
              createdAt: true,
              updatedAt: true,
              priority: true
            }
          }
        }
      });

      if (!project) {
        throw new Error('Project not found');
      }

      const totalTasks = project.tasks.length;
      const completedTasks = project.tasks.filter(t => t.status === 'DONE').length;
      const inProgressTasks = project.tasks.filter(t => t.status === 'IN_PROGRESS').length;

      if (totalTasks === 0) {
        return {
          estimatedCompletion: null,
          confidence: 0,
          factors: ['No tasks available for analysis']
        };
      }

      // Calculate average completion time for done tasks
      const completedTasksWithTimes = project.tasks
        .filter(t => t.status === 'DONE')
        .map(t => ({
          completionTime: new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime()
        }));

      const avgCompletionTime = completedTasksWithTimes.length > 0
        ? completedTasksWithTimes.reduce((sum, t) => sum + t.completionTime, 0) / completedTasksWithTimes.length
        : 7 * 24 * 60 * 60 * 1000; // Default to 7 days

      // Simple prediction model
      const remainingTasks = totalTasks - completedTasks;
      const estimatedTimeMs = remainingTasks * avgCompletionTime;
      const estimatedCompletion = new Date(Date.now() + estimatedTimeMs);

      // Calculate confidence based on data quality
      let confidence = Math.min((completedTasksWithTimes.length / totalTasks) * 100, 90);

      const factors = [];
      if (completedTasksWithTimes.length < 5) {
        factors.push('Limited historical data');
        confidence *= 0.7;
      }

      if (inProgressTasks > remainingTasks * 0.5) {
        factors.push('High number of tasks in progress');
        confidence *= 0.8;
      }

      const urgentTasks = project.tasks.filter(t => t.priority === 'URGENT' && t.status !== 'DONE').length;
      if (urgentTasks > 0) {
        factors.push(`${urgentTasks} urgent tasks may affect timeline`);
      }

      return {
        estimatedCompletion,
        confidence: Math.round(confidence),
        factors,
        metrics: {
          completionRate: Math.round((completedTasks / totalTasks) * 100),
          avgTaskDays: Math.round(avgCompletionTime / (24 * 60 * 60 * 1000)),
          remainingTasks
        }
      };
    } catch (error) {
      console.error('Project prediction error:', error);
      throw new Error('Failed to predict project completion');
    }
  }

  static async generateProductivityInsights(userId: string, timeRange: number = 30) {
    try {
      const startDate = new Date(Date.now() - timeRange * 24 * 60 * 60 * 1000);

      const tasks = await prisma.task.findMany({
        where: {
          assigneeId: userId,
          updatedAt: { gte: startDate }
        },
        select: {
          id: true,
          status: true,
          priority: true,
          createdAt: true,
          updatedAt: true,
          dueDate: true
        }
      });

      const insights = {
        productivity_score: 0,
        strengths: [],
        improvements: [],
        patterns: []
      };

      const completedTasks = tasks.filter(t => t.status === 'DONE');
      const onTimeTasks = completedTasks.filter(t => 
        !t.dueDate || new Date(t.updatedAt) <= new Date(t.dueDate)
      );

      // Calculate productivity score
      const completionRate = tasks.length > 0 ? (completedTasks.length / tasks.length) * 100 : 0;
      const onTimeRate = completedTasks.length > 0 ? (onTimeTasks.length / completedTasks.length) * 100 : 0;
      
      insights.productivity_score = Math.round((completionRate * 0.6) + (onTimeRate * 0.4));

      // Identify strengths
      if (completionRate > 80) {
        insights.strengths.push('High task completion rate');
      }
      if (onTimeRate > 90) {
        insights.strengths.push('Excellent deadline management');
      }

      // Identify improvement areas
      if (completionRate < 60) {
        insights.improvements.push('Focus on completing more tasks');
      }
      if (onTimeRate < 70) {
        insights.improvements.push('Improve deadline adherence');
      }

      // Analyze patterns
      const tasksByDayOfWeek = tasks.reduce((acc, task) => {
        const day = new Date(task.updatedAt).getDay();
        acc[day] = (acc[day] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);

      const mostProductiveDay = Object.entries(tasksByDayOfWeek)
        .sort(([,a], [,b]) => b - a)[0];

      if (mostProductiveDay) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        insights.patterns.push(`Most productive on ${dayNames[parseInt(mostProductiveDay[0])]}`);
      }

      return insights;
    } catch (error) {
      console.error('Productivity insights error:', error);
      throw new Error('Failed to generate productivity insights');
    }
  }
}

export default AIService;
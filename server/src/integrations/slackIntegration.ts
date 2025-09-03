import { WebClient } from '@slack/web-api';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class SlackIntegration {
  private slack: WebClient;

  constructor(token: string) {
    this.slack = new WebClient(token);
  }

  async sendTaskNotification(taskId: string, event: 'created' | 'updated' | 'completed') {
    try {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          project: { select: { name: true } },
          assignee: { select: { firstName: true, lastName: true, email: true } },
          creator: { select: { firstName: true, lastName: true } }
        }
      });

      if (!task) return;

      const assigneeEmail = task.assignee?.email;
      if (!assigneeEmail) return;

      // Find Slack user by email
      const slackUser = await this.slack.users.lookupByEmail({
        email: assigneeEmail
      });

      if (!slackUser.user) return;

      const messages = {
        created: `🆕 New task assigned: *${task.title}* in project *${task.project.name}*`,
        updated: `📝 Task updated: *${task.title}* - Status: ${task.status}`,
        completed: `✅ Task completed: *${task.title}* - Great work!`
      };

      const blocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: messages[event]
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Project:*\n${task.project.name}`
            },
            {
              type: 'mrkdwn',
              text: `*Priority:*\n${task.priority}`
            },
            {
              type: 'mrkdwn',
              text: `*Status:*\n${task.status.replace('_', ' ')}`
            },
            {
              type: 'mrkdwn',
              text: `*Created by:*\n${task.creator.firstName} ${task.creator.lastName}`
            }
          ]
        }
      ];

      if (task.description) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Description:*\n${task.description}`
          }
        });
      }

      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View Task'
            },
            url: `${process.env.CLIENT_URL}/tasks/${task.id}`,
            action_id: 'view_task'
          }
        ]
      });

      await this.slack.chat.postMessage({
        channel: slackUser.user.id,
        text: messages[event],
        blocks
      });

    } catch (error) {
      console.error('Slack notification error:', error);
    }
  }

  async sendProjectUpdates(projectId: string, channelId: string) {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          tasks: {
            select: { status: true }
          },
          _count: {
            select: { tasks: true, members: true }
          }
        }
      });

      if (!project) return;

      const completedTasks = project.tasks.filter(t => t.status === 'DONE').length;
      const progress = project._count.tasks > 0 
        ? Math.round((completedTasks / project._count.tasks) * 100) 
        : 0;

      const blocks = [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `📊 ${project.name} - Weekly Update`
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Progress:*\n${progress}% (${completedTasks}/${project._count.tasks} tasks)`
            },
            {
              type: 'mrkdwn',
              text: `*Team Size:*\n${project._count.members} members`
            }
          ]
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Status:* ${project.status.replace('_', ' ')}\n*Priority:* ${project.priority}`
          }
        }
      ];

      await this.slack.chat.postMessage({
        channel: channelId,
        text: `Project update for ${project.name}`,
        blocks
      });

    } catch (error) {
      console.error('Slack project update error:', error);
    }
  }

  async createSlashCommand() {
    // Slack slash command handler
    return async (req: any, res: any) => {
      const { text, user_id, channel_id } = req.body;
      
      try {
        const slackUser = await this.slack.users.info({ user: user_id });
        const email = slackUser.user?.profile?.email;
        
        if (!email) {
          return res.json({
            text: 'Unable to find your email. Please ensure your Slack profile has an email address.'
          });
        }

        const user = await prisma.user.findUnique({
          where: { email }
        });

        if (!user) {
          return res.json({
            text: 'No TeamSync account found for your email. Please register first.'
          });
        }

        const commands = text.split(' ');
        const action = commands[0];

        switch (action) {
          case 'tasks':
            const tasks = await prisma.task.findMany({
              where: { 
                assigneeId: user.id,
                status: { not: 'DONE' }
              },
              take: 5,
              include: {
                project: { select: { name: true } }
              }
            });

            const taskList = tasks.map(t => 
              `• *${t.title}* (${t.project.name}) - ${t.priority}`
            ).join('\n');

            return res.json({
              text: tasks.length > 0 
                ? `Your active tasks:\n${taskList}`
                : 'No active tasks assigned to you.'
            });

          case 'create':
            const projectName = commands.slice(1).join(' ');
            if (!projectName) {
              return res.json({
                text: 'Usage: /teamsync create <project name>'
              });
            }

            // Create quick project
            const newProject = await prisma.project.create({
              data: {
                name: projectName,
                ownerId: user.id,
                members: {
                  create: {
                    userId: user.id,
                    role: 'OWNER'
                  }
                }
              }
            });

            return res.json({
              text: `✅ Project "${projectName}" created successfully!`,
              attachments: [{
                color: 'good',
                fields: [{
                  title: 'View Project',
                  value: `${process.env.CLIENT_URL}/projects/${newProject.id}`
                }]
              }]
            });

          default:
            return res.json({
              text: 'Available commands:\n• `/teamsync tasks` - View your active tasks\n• `/teamsync create <name>` - Create a new project'
            });
        }
      } catch (error) {
        console.error('Slash command error:', error);
        return res.json({
          text: 'Sorry, something went wrong. Please try again later.'
        });
      }
    };
  }
}

export default SlackIntegration;
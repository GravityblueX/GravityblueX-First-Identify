import Redis from 'ioredis';
import { EventEmitter } from 'events';

interface EventPayload {
  type: string;
  data: any;
  timestamp: Date;
  userId?: string;
  projectId?: string;
  metadata?: Record<string, any>;
}

class EventBus extends EventEmitter {
  private redis: Redis;
  private subscriber: Redis;
  private publisher: Redis;

  constructor() {
    super();
    this.setMaxListeners(100);
    
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.redis = new Redis(redisUrl);
    this.subscriber = new Redis(redisUrl);
    this.publisher = new Redis(redisUrl);

    this.setupSubscriptions();
  }

  private setupSubscriptions() {
    this.subscriber.on('message', (channel: string, message: string) => {
      try {
        const payload: EventPayload = JSON.parse(message);
        this.emit(payload.type, payload);
      } catch (error) {
        console.error('Failed to parse event message:', error);
      }
    });

    // Subscribe to all event channels
    this.subscriber.psubscribe('teamsync:*');
  }

  async publish(type: string, data: any, metadata?: Record<string, any>) {
    const payload: EventPayload = {
      type,
      data,
      timestamp: new Date(),
      metadata
    };

    // Emit locally first
    this.emit(type, payload);

    // Publish to Redis for other instances
    await this.publisher.publish(`teamsync:${type}`, JSON.stringify(payload));
  }

  async publishUserEvent(type: string, userId: string, data: any) {
    await this.publish(type, data, { userId });
    await this.publisher.publish(`teamsync:user:${userId}`, JSON.stringify({
      type,
      data,
      timestamp: new Date(),
      userId
    }));
  }

  async publishProjectEvent(type: string, projectId: string, data: any, userId?: string) {
    await this.publish(type, data, { projectId, userId });
    await this.publisher.publish(`teamsync:project:${projectId}`, JSON.stringify({
      type,
      data,
      timestamp: new Date(),
      projectId,
      userId
    }));
  }

  subscribeToUserEvents(userId: string, callback: (event: EventPayload) => void) {
    const userSubscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    
    userSubscriber.subscribe(`teamsync:user:${userId}`);
    userSubscriber.on('message', (channel, message) => {
      try {
        const event = JSON.parse(message);
        callback(event);
      } catch (error) {
        console.error('Failed to parse user event:', error);
      }
    });

    return () => userSubscriber.disconnect();
  }

  subscribeToProjectEvents(projectId: string, callback: (event: EventPayload) => void) {
    const projectSubscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    
    projectSubscriber.subscribe(`teamsync:project:${projectId}`);
    projectSubscriber.on('message', (channel, message) => {
      try {
        const event = JSON.parse(message);
        callback(event);
      } catch (error) {
        console.error('Failed to parse project event:', error);
      }
    });

    return () => projectSubscriber.disconnect();
  }

  // Event type constants
  static readonly EVENTS = {
    // User events
    USER_REGISTERED: 'user.registered',
    USER_UPDATED: 'user.updated',
    USER_DELETED: 'user.deleted',

    // Project events  
    PROJECT_CREATED: 'project.created',
    PROJECT_UPDATED: 'project.updated',
    PROJECT_DELETED: 'project.deleted',
    PROJECT_MEMBER_ADDED: 'project.member.added',
    PROJECT_MEMBER_REMOVED: 'project.member.removed',

    // Task events
    TASK_CREATED: 'task.created',
    TASK_UPDATED: 'task.updated',
    TASK_DELETED: 'task.deleted',
    TASK_ASSIGNED: 'task.assigned',
    TASK_COMPLETED: 'task.completed',
    TASK_COMMENT_ADDED: 'task.comment.added',

    // Chat events
    MESSAGE_SENT: 'message.sent',
    CHAT_CREATED: 'chat.created',

    // File events
    FILE_UPLOADED: 'file.uploaded',
    FILE_DELETED: 'file.deleted',

    // System events
    SYSTEM_MAINTENANCE: 'system.maintenance',
    SYSTEM_ALERT: 'system.alert'
  } as const;
}

// Singleton instance
export const eventBus = new EventBus();

// Event handlers setup
export function setupEventHandlers() {
  // Task assignment notifications
  eventBus.on(EventBus.EVENTS.TASK_ASSIGNED, async (payload: EventPayload) => {
    const { taskId, assigneeId } = payload.data;
    
    await prisma.notification.create({
      data: {
        title: 'New Task Assigned',
        message: `You have been assigned a new task`,
        type: 'TASK_ASSIGNED',
        userId: assigneeId
      }
    });
  });

  // Project completion celebrations
  eventBus.on(EventBus.EVENTS.PROJECT_UPDATED, async (payload: EventPayload) => {
    const { projectId, status } = payload.data;
    
    if (status === 'COMPLETED') {
      const projectMembers = await prisma.projectMember.findMany({
        where: { projectId },
        include: { user: true }
      });

      // Send celebration notifications to all members
      await Promise.all(
        projectMembers.map(member =>
          prisma.notification.create({
            data: {
              title: '🎉 Project Completed!',
              message: `Congratulations! The project has been completed successfully.`,
              type: 'PROJECT_UPDATED',
              userId: member.userId
            }
          })
        )
      );
    }
  });

  // Automatic task status updates
  eventBus.on(EventBus.EVENTS.TASK_UPDATED, async (payload: EventPayload) => {
    const { taskId, previousStatus, newStatus } = payload.data;

    if (previousStatus !== 'DONE' && newStatus === 'DONE') {
      eventBus.publish(EventBus.EVENTS.TASK_COMPLETED, {
        taskId,
        completedAt: new Date()
      });
    }
  });

  // Analytics data refresh
  eventBus.on(EventBus.EVENTS.TASK_COMPLETED, async (payload: EventPayload) => {
    const { taskId } = payload.data;
    
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true }
    });

    if (task) {
      // Trigger analytics recalculation
      eventBus.publish('analytics.refresh', {
        projectId: task.projectId,
        trigger: 'task_completion'
      });
    }
  });

  console.log('✅ Event handlers configured');
}

export default EventBus;
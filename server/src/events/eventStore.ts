import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

interface DomainEvent {
  id: string;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  eventData: any;
  eventVersion: number;
  occurredAt: Date;
  userId?: string;
  metadata?: Record<string, any>;
}

interface EventMetadata {
  correlationId?: string;
  causationId?: string;
  userId?: string;
  source?: string;
  ip?: string;
  userAgent?: string;
}

export class EventStore {
  async appendEvent(
    aggregateId: string,
    aggregateType: string,
    eventType: string,
    eventData: any,
    expectedVersion?: number,
    metadata?: EventMetadata
  ): Promise<DomainEvent> {
    try {
      // Optimistic concurrency check
      if (expectedVersion !== undefined) {
        const currentVersion = await this.getAggregateVersion(aggregateId);
        if (currentVersion !== expectedVersion) {
          throw new Error('Concurrency conflict: Aggregate has been modified');
        }
      }

      const event: DomainEvent = {
        id: uuidv4(),
        aggregateId,
        aggregateType,
        eventType,
        eventData,
        eventVersion: (expectedVersion || 0) + 1,
        occurredAt: new Date(),
        userId: metadata?.userId,
        metadata
      };

      // Store event (this would typically be in a separate events table)
      await prisma.$executeRaw`
        INSERT INTO events (id, aggregate_id, aggregate_type, event_type, event_data, event_version, occurred_at, user_id, metadata)
        VALUES (${event.id}, ${event.aggregateId}, ${event.aggregateType}, ${event.eventType}, ${JSON.stringify(event.eventData)}, ${event.eventVersion}, ${event.occurredAt}, ${event.userId}, ${JSON.stringify(event.metadata)})
      `;

      // Publish event for real-time updates
      await this.publishEvent(event);

      return event;
    } catch (error) {
      console.error('Event store append error:', error);
      throw error;
    }
  }

  async getAggregateEvents(aggregateId: string, fromVersion = 0): Promise<DomainEvent[]> {
    try {
      const events = await prisma.$queryRaw<any[]>`
        SELECT * FROM events 
        WHERE aggregate_id = ${aggregateId} 
        AND event_version > ${fromVersion}
        ORDER BY event_version ASC
      `;

      return events.map(event => ({
        ...event,
        eventData: JSON.parse(event.eventData),
        metadata: event.metadata ? JSON.parse(event.metadata) : null
      }));
    } catch (error) {
      console.error('Get aggregate events error:', error);
      return [];
    }
  }

  async getAggregateVersion(aggregateId: string): Promise<number> {
    try {
      const result = await prisma.$queryRaw<any[]>`
        SELECT MAX(event_version) as version FROM events 
        WHERE aggregate_id = ${aggregateId}
      `;
      
      return result[0]?.version || 0;
    } catch (error) {
      console.error('Get aggregate version error:', error);
      return 0;
    }
  }

  async replayEvents(aggregateId: string, aggregateType: string): Promise<any> {
    const events = await this.getAggregateEvents(aggregateId);
    
    // This is where you would rebuild the aggregate state from events
    return this.buildAggregateFromEvents(aggregateType, events);
  }

  private async buildAggregateFromEvents(aggregateType: string, events: DomainEvent[]): Promise<any> {
    let state: any = { id: events[0]?.aggregateId };

    for (const event of events) {
      state = this.applyEvent(state, event, aggregateType);
    }

    return state;
  }

  private applyEvent(state: any, event: DomainEvent, aggregateType: string): any {
    switch (aggregateType) {
      case 'Project':
        return this.applyProjectEvent(state, event);
      case 'Task':
        return this.applyTaskEvent(state, event);
      case 'User':
        return this.applyUserEvent(state, event);
      default:
        return state;
    }
  }

  private applyProjectEvent(state: any, event: DomainEvent): any {
    switch (event.eventType) {
      case 'ProjectCreated':
        return {
          ...state,
          ...event.eventData,
          createdAt: event.occurredAt
        };
      
      case 'ProjectUpdated':
        return {
          ...state,
          ...event.eventData,
          updatedAt: event.occurredAt
        };
      
      case 'ProjectMemberAdded':
        return {
          ...state,
          members: [...(state.members || []), event.eventData.member]
        };
      
      case 'ProjectMemberRemoved':
        return {
          ...state,
          members: (state.members || []).filter((m: any) => m.id !== event.eventData.memberId)
        };
      
      default:
        return state;
    }
  }

  private applyTaskEvent(state: any, event: DomainEvent): any {
    switch (event.eventType) {
      case 'TaskCreated':
        return {
          ...state,
          ...event.eventData,
          createdAt: event.occurredAt
        };
      
      case 'TaskUpdated':
        return {
          ...state,
          ...event.eventData,
          updatedAt: event.occurredAt
        };
      
      case 'TaskAssigned':
        return {
          ...state,
          assigneeId: event.eventData.assigneeId,
          updatedAt: event.occurredAt
        };
      
      case 'TaskStatusChanged':
        return {
          ...state,
          status: event.eventData.newStatus,
          updatedAt: event.occurredAt
        };
      
      default:
        return state;
    }
  }

  private applyUserEvent(state: any, event: DomainEvent): any {
    switch (event.eventType) {
      case 'UserRegistered':
        return {
          ...state,
          ...event.eventData,
          createdAt: event.occurredAt
        };
      
      case 'UserProfileUpdated':
        return {
          ...state,
          ...event.eventData,
          updatedAt: event.occurredAt
        };
      
      default:
        return state;
    }
  }

  private async publishEvent(event: DomainEvent) {
    const { eventBus } = await import('../services/eventBus');
    
    await eventBus.publish(event.eventType, {
      ...event.eventData,
      eventId: event.id,
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      occurredAt: event.occurredAt
    }, event.metadata);
  }

  // Event stream queries
  async getEventsByType(eventType: string, limit = 100): Promise<DomainEvent[]> {
    try {
      const events = await prisma.$queryRaw<any[]>`
        SELECT * FROM events 
        WHERE event_type = ${eventType}
        ORDER BY occurred_at DESC
        LIMIT ${limit}
      `;

      return events.map(event => ({
        ...event,
        eventData: JSON.parse(event.eventData),
        metadata: event.metadata ? JSON.parse(event.metadata) : null
      }));
    } catch (error) {
      console.error('Get events by type error:', error);
      return [];
    }
  }

  async getEventsByUser(userId: string, limit = 100): Promise<DomainEvent[]> {
    try {
      const events = await prisma.$queryRaw<any[]>`
        SELECT * FROM events 
        WHERE user_id = ${userId}
        ORDER BY occurred_at DESC
        LIMIT ${limit}
      `;

      return events.map(event => ({
        ...event,
        eventData: JSON.parse(event.eventData),
        metadata: event.metadata ? JSON.parse(event.metadata) : null
      }));
    } catch (error) {
      console.error('Get events by user error:', error);
      return [];
    }
  }

  // Event sourcing snapshots
  async createSnapshot(aggregateId: string, aggregateType: string, state: any, version: number) {
    try {
      await prisma.$executeRaw`
        INSERT INTO snapshots (aggregate_id, aggregate_type, snapshot_data, version, created_at)
        VALUES (${aggregateId}, ${aggregateType}, ${JSON.stringify(state)}, ${version}, ${new Date()})
        ON CONFLICT (aggregate_id) DO UPDATE SET
          snapshot_data = ${JSON.stringify(state)},
          version = ${version},
          created_at = ${new Date()}
      `;
    } catch (error) {
      console.error('Create snapshot error:', error);
    }
  }

  async getSnapshot(aggregateId: string): Promise<{ state: any; version: number } | null> {
    try {
      const snapshot = await prisma.$queryRaw<any[]>`
        SELECT snapshot_data, version FROM snapshots 
        WHERE aggregate_id = ${aggregateId}
      `;

      if (snapshot.length === 0) return null;

      return {
        state: JSON.parse(snapshot[0].snapshot_data),
        version: snapshot[0].version
      };
    } catch (error) {
      console.error('Get snapshot error:', error);
      return null;
    }
  }
}

export const eventStore = new EventStore();

// Domain event definitions
export const ProjectEvents = {
  CREATED: 'ProjectCreated',
  UPDATED: 'ProjectUpdated',
  DELETED: 'ProjectDeleted',
  MEMBER_ADDED: 'ProjectMemberAdded',
  MEMBER_REMOVED: 'ProjectMemberRemoved',
  STATUS_CHANGED: 'ProjectStatusChanged'
} as const;

export const TaskEvents = {
  CREATED: 'TaskCreated',
  UPDATED: 'TaskUpdated',
  DELETED: 'TaskDeleted',
  ASSIGNED: 'TaskAssigned',
  STATUS_CHANGED: 'TaskStatusChanged',
  COMMENT_ADDED: 'TaskCommentAdded'
} as const;

export const UserEvents = {
  REGISTERED: 'UserRegistered',
  PROFILE_UPDATED: 'UserProfileUpdated',
  ROLE_CHANGED: 'UserRoleChanged'
} as const;
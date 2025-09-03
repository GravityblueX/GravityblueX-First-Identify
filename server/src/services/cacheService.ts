import Redis from 'ioredis';

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  tags?: string[]; // Cache tags for invalidation
  compress?: boolean; // Compress large values
}

class CacheService {
  private redis: Redis;
  private readonly DEFAULT_TTL = 300; // 5 minutes
  private readonly TAG_PREFIX = 'tag:';

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis.get(key);
      if (!cached) return null;

      const data = JSON.parse(cached);
      
      // Check if it's compressed
      if (data._compressed) {
        const zlib = await import('zlib');
        const decompressed = zlib.inflateSync(Buffer.from(data.value, 'base64'));
        return JSON.parse(decompressed.toString());
      }

      return data;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async set(key: string, value: any, options: CacheOptions = {}): Promise<boolean> {
    try {
      const ttl = options.ttl || this.DEFAULT_TTL;
      let serialized = JSON.stringify(value);

      // Compress large values
      if (options.compress || serialized.length > 1024) {
        const zlib = await import('zlib');
        const compressed = zlib.deflateSync(serialized);
        serialized = JSON.stringify({
          _compressed: true,
          value: compressed.toString('base64')
        });
      }

      await this.redis.setex(key, ttl, serialized);

      // Add cache tags for group invalidation
      if (options.tags && options.tags.length > 0) {
        await Promise.all(
          options.tags.map(tag =>
            this.redis.sadd(`${this.TAG_PREFIX}${tag}`, key)
          )
        );
      }

      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const result = await this.redis.del(key);
      return result > 0;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  async invalidateByTag(tag: string): Promise<number> {
    try {
      const keys = await this.redis.smembers(`${this.TAG_PREFIX}${tag}`);
      if (keys.length === 0) return 0;

      const pipeline = this.redis.pipeline();
      keys.forEach(key => pipeline.del(key));
      pipeline.del(`${this.TAG_PREFIX}${tag}`);
      
      const results = await pipeline.exec();
      return keys.length;
    } catch (error) {
      console.error('Cache invalidation error:', error);
      return 0;
    }
  }

  async invalidatePattern(pattern: string): Promise<number> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length === 0) return 0;

      await this.redis.del(...keys);
      return keys.length;
    } catch (error) {
      console.error('Cache pattern invalidation error:', error);
      return 0;
    }
  }

  // Specialized cache methods
  async cacheUser(userId: string, userData: any, ttl = 600) {
    return this.set(`user:${userId}`, userData, { 
      ttl, 
      tags: ['users', `user:${userId}`] 
    });
  }

  async cacheProject(projectId: string, projectData: any, ttl = 300) {
    return this.set(`project:${projectId}`, projectData, {
      ttl,
      tags: ['projects', `project:${projectId}`]
    });
  }

  async cacheProjectTasks(projectId: string, tasks: any[], ttl = 180) {
    return this.set(`project:${projectId}:tasks`, tasks, {
      ttl,
      tags: ['tasks', `project:${projectId}`]
    });
  }

  async cacheAnalytics(projectId: string, timeRange: number, analytics: any, ttl = 600) {
    return this.set(`analytics:${projectId}:${timeRange}`, analytics, {
      ttl,
      tags: ['analytics', `project:${projectId}`]
    });
  }

  // Cache warming strategies
  async warmUserCache(userId: string) {
    try {
      // Warm user data
      const user = await this.fetchUserWithProjects(userId);
      await this.cacheUser(userId, user);

      // Warm user's projects
      const projects = user.projects || [];
      await Promise.all(
        projects.map(async (project: any) => {
          const fullProject = await this.fetchProjectWithTasks(project.id);
          await this.cacheProject(project.id, fullProject);
        })
      );

      console.log(`Cache warmed for user ${userId}`);
    } catch (error) {
      console.error('Cache warming error:', error);
    }
  }

  private async fetchUserWithProjects(userId: string) {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    return await prisma.user.findUnique({
      where: { id: userId },
      include: {
        projectMembers: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
                status: true,
                priority: true
              }
            }
          }
        }
      }
    });
  }

  private async fetchProjectWithTasks(projectId: string) {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    return await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        tasks: {
          include: {
            assignee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true
              }
            }
          }
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true
              }
            }
          }
        }
      }
    });
  }

  // Cache statistics
  async getStats() {
    try {
      const info = await this.redis.info('memory');
      const keyspace = await this.redis.info('keyspace');
      
      const memoryMatch = info.match(/used_memory_human:(.+)/);
      const memory = memoryMatch ? memoryMatch[1].trim() : 'Unknown';
      
      const dbMatch = keyspace.match(/db0:keys=(\d+)/);
      const keyCount = dbMatch ? parseInt(dbMatch[1]) : 0;

      return {
        memory,
        keyCount,
        connected: this.redis.status === 'ready'
      };
    } catch (error) {
      return {
        memory: 'Unknown',
        keyCount: 0,
        connected: false,
        error: error.message
      };
    }
  }

  // Cache cleanup
  async cleanup() {
    try {
      // Remove expired cache tags
      const tagKeys = await this.redis.keys(`${this.TAG_PREFIX}*`);
      
      for (const tagKey of tagKeys) {
        const keys = await this.redis.smembers(tagKey);
        const existingKeys = keys.length > 0 ? await this.redis.exists(...keys) : 0;
        
        if (existingKeys === 0) {
          await this.redis.del(tagKey);
        }
      }

      console.log(`Cleaned up ${tagKeys.length} cache tag keys`);
    } catch (error) {
      console.error('Cache cleanup error:', error);
    }
  }
}

// Singleton instance
export const cacheService = new CacheService();

// Cache middleware for Express
export const cacheMiddleware = (options: CacheOptions & { keyGenerator?: (req: any) => string } = {}) => {
  return async (req: any, res: any, next: any) => {
    if (req.method !== 'GET') {
      return next();
    }

    const key = options.keyGenerator 
      ? options.keyGenerator(req)
      : `route:${req.originalUrl}:${req.user?.id || 'anonymous'}`;

    try {
      const cached = await cacheService.get(key);
      
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached);
      }

      res.setHeader('X-Cache', 'MISS');

      // Override res.json to cache the response
      const originalJson = res.json;
      res.json = function(data: any) {
        cacheService.set(key, data, options);
        return originalJson.call(this, data);
      };

      next();
    } catch (error) {
      console.error('Cache middleware error:', error);
      next();
    }
  };
};

// Cache invalidation helpers
export const invalidateUserCache = async (userId: string) => {
  await cacheService.invalidateByTag(`user:${userId}`);
  await cacheService.invalidateByTag('users');
};

export const invalidateProjectCache = async (projectId: string) => {
  await cacheService.invalidateByTag(`project:${projectId}`);
  await cacheService.invalidateByTag('projects');
  await cacheService.invalidateByTag('analytics');
};

export const invalidateTaskCache = async (projectId: string) => {
  await cacheService.invalidateByTag(`project:${projectId}`);
  await cacheService.invalidateByTag('tasks');
  await cacheService.invalidateByTag('analytics');
};

export default cacheService;
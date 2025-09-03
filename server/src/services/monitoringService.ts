import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface PerformanceMetrics {
  timestamp: Date;
  endpoint: string;
  method: string;
  responseTime: number;
  statusCode: number;
  userId?: string;
  userAgent?: string;
  ip: string;
}

interface ErrorLog {
  timestamp: Date;
  endpoint: string;
  method: string;
  error: string;
  stack?: string;
  userId?: string;
  ip: string;
}

class MonitoringService {
  private static metrics: PerformanceMetrics[] = [];
  private static errors: ErrorLog[] = [];
  private static readonly MAX_METRICS = 1000;
  private static readonly MAX_ERRORS = 500;

  static performanceMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      
      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        
        const metric: PerformanceMetrics = {
          timestamp: new Date(),
          endpoint: req.path,
          method: req.method,
          responseTime,
          statusCode: res.statusCode,
          userId: (req as any).user?.id,
          userAgent: req.get('User-Agent'),
          ip: req.ip || req.connection.remoteAddress || 'unknown'
        };

        this.addMetric(metric);

        // Log slow requests
        if (responseTime > 1000) {
          console.warn(`Slow request detected: ${req.method} ${req.path} - ${responseTime}ms`);
        }
      });

      next();
    };
  }

  static errorMiddleware() {
    return (err: Error, req: Request, res: Response, next: NextFunction) => {
      const errorLog: ErrorLog = {
        timestamp: new Date(),
        endpoint: req.path,
        method: req.method,
        error: err.message,
        stack: err.stack,
        userId: (req as any).user?.id,
        ip: req.ip || req.connection.remoteAddress || 'unknown'
      };

      this.addError(errorLog);
      next(err);
    };
  }

  private static addMetric(metric: PerformanceMetrics) {
    this.metrics.push(metric);
    
    // Keep only recent metrics
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics = this.metrics.slice(-this.MAX_METRICS);
    }
  }

  private static addError(error: ErrorLog) {
    this.errors.push(error);
    
    // Keep only recent errors
    if (this.errors.length > this.MAX_ERRORS) {
      this.errors = this.errors.slice(-this.MAX_ERRORS);
    }
  }

  static getHealthMetrics() {
    const now = Date.now();
    const lastHour = now - (60 * 60 * 1000);
    const last5Minutes = now - (5 * 60 * 1000);

    const recentMetrics = this.metrics.filter(m => 
      m.timestamp.getTime() > lastHour
    );

    const veryRecentMetrics = this.metrics.filter(m =>
      m.timestamp.getTime() > last5Minutes
    );

    const recentErrors = this.errors.filter(e =>
      e.timestamp.getTime() > lastHour
    );

    const avgResponseTime = recentMetrics.length > 0
      ? recentMetrics.reduce((sum, m) => sum + m.responseTime, 0) / recentMetrics.length
      : 0;

    const requestsPerMinute = veryRecentMetrics.length;
    const errorRate = recentMetrics.length > 0
      ? (recentErrors.length / recentMetrics.length) * 100
      : 0;

    const statusCodeDistribution = recentMetrics.reduce((acc, m) => {
      const code = Math.floor(m.statusCode / 100) * 100;
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    return {
      status: this.getHealthStatus(avgResponseTime, errorRate),
      metrics: {
        averageResponseTime: Math.round(avgResponseTime),
        requestsPerMinute,
        errorRate: Math.round(errorRate * 100) / 100,
        totalRequests: recentMetrics.length,
        totalErrors: recentErrors.length
      },
      statusCodes: statusCodeDistribution,
      slowestEndpoints: this.getSlowestEndpoints(recentMetrics),
      mostFrequentErrors: this.getMostFrequentErrors(recentErrors),
      timestamp: new Date().toISOString()
    };
  }

  private static getHealthStatus(avgResponseTime: number, errorRate: number): string {
    if (errorRate > 5 || avgResponseTime > 2000) {
      return 'critical';
    } else if (errorRate > 2 || avgResponseTime > 1000) {
      return 'warning';
    } else {
      return 'healthy';
    }
  }

  private static getSlowestEndpoints(metrics: PerformanceMetrics[], limit = 5) {
    const endpointStats = metrics.reduce((acc, m) => {
      const key = `${m.method} ${m.endpoint}`;
      if (!acc[key]) {
        acc[key] = { total: 0, count: 0, max: 0 };
      }
      acc[key].total += m.responseTime;
      acc[key].count += 1;
      acc[key].max = Math.max(acc[key].max, m.responseTime);
      return acc;
    }, {} as Record<string, { total: number; count: number; max: number }>);

    return Object.entries(endpointStats)
      .map(([endpoint, stats]) => ({
        endpoint,
        averageTime: Math.round(stats.total / stats.count),
        maxTime: stats.max,
        requestCount: stats.count
      }))
      .sort((a, b) => b.averageTime - a.averageTime)
      .slice(0, limit);
  }

  private static getMostFrequentErrors(errors: ErrorLog[], limit = 5) {
    const errorCounts = errors.reduce((acc, e) => {
      acc[e.error] = (acc[e.error] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(errorCounts)
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  static async getDatabaseMetrics() {
    try {
      const [userCount, projectCount, taskCount, activeConnections] = await Promise.all([
        prisma.user.count(),
        prisma.project.count(),
        prisma.task.count(),
        prisma.$queryRaw`SELECT count(*) as active_connections FROM pg_stat_activity WHERE state = 'active'`
      ]);

      const recentActivity = await prisma.task.count({
        where: {
          updatedAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        }
      });

      return {
        database: {
          userCount,
          projectCount,
          taskCount,
          activeConnections: (activeConnections as any)[0]?.active_connections || 0,
          recentActivity
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Database metrics error:', error);
      return {
        database: {
          status: 'error',
          error: 'Failed to fetch database metrics'
        },
        timestamp: new Date().toISOString()
      };
    }
  }

  static getSystemMetrics() {
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();

    return {
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        uptime: Math.round(uptime),
        memory: {
          used: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
          total: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
          external: Math.round(memoryUsage.external / 1024 / 1024), // MB
        },
        cpu: {
          usage: process.cpuUsage()
        }
      },
      timestamp: new Date().toISOString()
    };
  }

  static async getFullReport() {
    const [healthMetrics, databaseMetrics, systemMetrics] = await Promise.all([
      this.getHealthMetrics(),
      this.getDatabaseMetrics(),
      this.getSystemMetrics()
    ]);

    return {
      ...healthMetrics,
      ...databaseMetrics,
      ...systemMetrics,
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    };
  }
}

export default MonitoringService;
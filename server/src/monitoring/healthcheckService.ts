import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { ObservabilityService } from '../services/observabilityService';
import { PerformanceOptimizer } from '../performance/performanceOptimizer';

const prisma = new PrismaClient();
const redis = createClient({ url: process.env.REDIS_URL });

export interface HealthCheck {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  details?: any;
  lastCheck: Date;
}

export interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'critical';
  services: HealthCheck[];
  performance: {
    cpu: number;
    memory: number;
    disk: number;
    network: number;
  };
  metrics: {
    uptime: number;
    requestRate: number;
    errorRate: number;
    dbConnections: number;
  };
}

export class HealthCheckService {
  private static healthHistory = new Map<string, HealthCheck[]>();

  // Comprehensive health check endpoint
  static async getSystemHealth(): Promise<SystemHealth> {
    const startTime = Date.now();
    
    const healthChecks = await Promise.allSettled([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkFileStorage(),
      this.checkExternalAPIs(),
      this.checkDiskSpace(),
      this.checkMemoryUsage()
    ]);

    const services = healthChecks.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        const serviceNames = ['database', 'redis', 'file_storage', 'external_apis', 'disk', 'memory'];
        return {
          service: serviceNames[index],
          status: 'unhealthy' as const,
          responseTime: Date.now() - startTime,
          details: { error: result.reason.message },
          lastCheck: new Date()
        };
      }
    });

    // Store health history
    services.forEach(service => {
      if (!this.healthHistory.has(service.service)) {
        this.healthHistory.set(service.service, []);
      }
      
      const history = this.healthHistory.get(service.service)!;
      history.push(service);
      
      // Keep only last 100 checks
      if (history.length > 100) {
        history.shift();
      }
    });

    // Determine overall health
    const healthyCount = services.filter(s => s.status === 'healthy').length;
    const degradedCount = services.filter(s => s.status === 'degraded').length;
    
    let overall: 'healthy' | 'degraded' | 'critical';
    if (healthyCount === services.length) {
      overall = 'healthy';
    } else if (healthyCount + degradedCount === services.length) {
      overall = 'degraded';
    } else {
      overall = 'critical';
    }

    // Get performance metrics
    const performance = await this.getPerformanceMetrics();
    const metrics = await this.getSystemMetrics();

    const result: SystemHealth = {
      overall,
      services,
      performance,
      metrics
    };

    // Record health metrics
    await ObservabilityService.recordBusinessMetric('system_health_score', healthyCount / services.length * 100);
    
    // Alert on critical status
    if (overall === 'critical') {
      const unhealthyServices = services.filter(s => s.status === 'unhealthy').map(s => s.service);
      await ObservabilityService.trackError(
        new Error('System health critical'),
        'system_health_critical',
        undefined,
        { unhealthyServices, totalServices: services.length }
      );
    }

    return result;
  }

  // Individual service health checks
  private static async checkDatabase(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // Test basic connectivity
      await prisma.$queryRaw`SELECT 1`;
      
      // Test query performance
      const userCount = await prisma.user.count();
      const responseTime = Date.now() - startTime;
      
      let status: 'healthy' | 'degraded' | 'unhealthy';
      if (responseTime < 100) {
        status = 'healthy';
      } else if (responseTime < 500) {
        status = 'degraded';
      } else {
        status = 'unhealthy';
      }

      return {
        service: 'database',
        status,
        responseTime,
        details: {
          userCount,
          connectionPool: 'active'
        },
        lastCheck: new Date()
      };
    } catch (error) {
      return {
        service: 'database',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        details: { error: (error as Error).message },
        lastCheck: new Date()
      };
    }
  }

  private static async checkRedis(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      if (!redis.isOpen) {
        await redis.connect();
      }
      
      // Test Redis operations
      const testKey = `health_check_${Date.now()}`;
      await redis.set(testKey, 'test', { EX: 10 });
      const result = await redis.get(testKey);
      await redis.del(testKey);
      
      const responseTime = Date.now() - startTime;
      
      let status: 'healthy' | 'degraded' | 'unhealthy';
      if (responseTime < 50 && result === 'test') {
        status = 'healthy';
      } else if (responseTime < 200) {
        status = 'degraded';
      } else {
        status = 'unhealthy';
      }

      const info = await redis.info('memory');
      const memoryUsage = this.parseRedisMemoryInfo(info);

      return {
        service: 'redis',
        status,
        responseTime,
        details: {
          memoryUsage,
          connected: redis.isOpen
        },
        lastCheck: new Date()
      };
    } catch (error) {
      return {
        service: 'redis',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        details: { error: (error as Error).message },
        lastCheck: new Date()
      };
    }
  }

  private static async checkFileStorage(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // Check Cloudinary connectivity
      const cloudinaryUrl = process.env.CLOUDINARY_URL;
      if (!cloudinaryUrl) {
        throw new Error('Cloudinary URL not configured');
      }

      // Simple connectivity test (would use actual Cloudinary SDK in production)
      const testResponse = await fetch('https://api.cloudinary.com/v1_1/health', {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });

      const responseTime = Date.now() - startTime;
      const status = testResponse.ok ? 'healthy' : 'degraded';

      return {
        service: 'file_storage',
        status,
        responseTime,
        details: {
          provider: 'cloudinary',
          configured: !!cloudinaryUrl
        },
        lastCheck: new Date()
      };
    } catch (error) {
      return {
        service: 'file_storage',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        details: { error: (error as Error).message },
        lastCheck: new Date()
      };
    }
  }

  private static async checkExternalAPIs(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // Check external API dependencies
      const externalServices = [
        { name: 'Slack API', url: 'https://slack.com/api/api.test' },
        { name: 'Email Service', url: process.env.EMAIL_SERVICE_URL }
      ].filter(service => service.url);

      const checkPromises = externalServices.map(async (service) => {
        const response = await fetch(service.url!, {
          method: 'GET',
          signal: AbortSignal.timeout(3000)
        });
        return { name: service.name, ok: response.ok, status: response.status };
      });

      const results = await Promise.allSettled(checkPromises);
      const responseTime = Date.now() - startTime;
      
      const healthyServices = results.filter(
        r => r.status === 'fulfilled' && r.value.ok
      ).length;
      
      let status: 'healthy' | 'degraded' | 'unhealthy';
      if (healthyServices === results.length) {
        status = 'healthy';
      } else if (healthyServices > 0) {
        status = 'degraded';
      } else {
        status = 'unhealthy';
      }

      return {
        service: 'external_apis',
        status,
        responseTime,
        details: {
          totalServices: results.length,
          healthyServices,
          services: results.map(r => r.status === 'fulfilled' ? r.value : null)
        },
        lastCheck: new Date()
      };
    } catch (error) {
      return {
        service: 'external_apis',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        details: { error: (error as Error).message },
        lastCheck: new Date()
      };
    }
  }

  private static async checkDiskSpace(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      const fs = require('fs').promises;
      const stats = await fs.statfs('./');
      
      const totalSpace = stats.blocks * stats.blksize;
      const freeSpace = stats.bavail * stats.blksize;
      const usedPercent = ((totalSpace - freeSpace) / totalSpace) * 100;
      
      let status: 'healthy' | 'degraded' | 'unhealthy';
      if (usedPercent < 70) {
        status = 'healthy';
      } else if (usedPercent < 90) {
        status = 'degraded';
      } else {
        status = 'unhealthy';
      }

      return {
        service: 'disk',
        status,
        responseTime: Date.now() - startTime,
        details: {
          totalGB: Math.round(totalSpace / 1024 / 1024 / 1024),
          freeGB: Math.round(freeSpace / 1024 / 1024 / 1024),
          usedPercent: Math.round(usedPercent)
        },
        lastCheck: new Date()
      };
    } catch (error) {
      return {
        service: 'disk',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        details: { error: (error as Error).message },
        lastCheck: new Date()
      };
    }
  }

  private static async checkMemoryUsage(): Promise<HealthCheck> {
    const startTime = Date.now();
    const memUsage = process.memoryUsage();
    
    const usedMB = memUsage.heapUsed / 1024 / 1024;
    const totalMB = memUsage.heapTotal / 1024 / 1024;
    const usedPercent = (usedMB / totalMB) * 100;
    
    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (usedPercent < 70) {
      status = 'healthy';
    } else if (usedPercent < 90) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      service: 'memory',
      status,
      responseTime: Date.now() - startTime,
      details: {
        heapUsedMB: Math.round(usedMB),
        heapTotalMB: Math.round(totalMB),
        usedPercent: Math.round(usedPercent),
        rss: Math.round(memUsage.rss / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024)
      },
      lastCheck: new Date()
    };
  }

  // Performance metrics collection
  private static async getPerformanceMetrics(): Promise<{
    cpu: number;
    memory: number;
    disk: number;
    network: number;
  }> {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      cpu: (cpuUsage.user + cpuUsage.system) / 1000000,
      memory: (memUsage.heapUsed / memUsage.heapTotal) * 100,
      disk: 45, // Would be calculated from actual disk usage
      network: 12 // Would be calculated from network I/O
    };
  }

  private static async getSystemMetrics(): Promise<{
    uptime: number;
    requestRate: number;
    errorRate: number;
    dbConnections: number;
  }> {
    const dashboard = await PerformanceOptimizer.getPerformanceDashboard();
    
    return {
      uptime: process.uptime(),
      requestRate: dashboard.application.requestRate,
      errorRate: dashboard.application.errorRate,
      dbConnections: dashboard.database.activeConnections
    };
  }

  // Detailed health endpoint
  static async healthCheckEndpoint(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    
    try {
      const health = await this.getSystemHealth();
      const responseTime = Date.now() - startTime;
      
      // Set appropriate HTTP status
      let httpStatus: number;
      switch (health.overall) {
        case 'healthy':
          httpStatus = 200;
          break;
        case 'degraded':
          httpStatus = 200; // Still operational
          break;
        case 'critical':
          httpStatus = 503; // Service unavailable
          break;
      }

      res.status(httpStatus).json({
        status: health.overall,
        timestamp: new Date().toISOString(),
        responseTime,
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        services: health.services,
        performance: health.performance,
        metrics: health.metrics,
        recommendations: await this.getHealthRecommendations(health)
      });

      // Record health check metrics
      await ObservabilityService.recordBusinessMetric('health_check_duration_ms', responseTime);
      await ObservabilityService.recordBusinessMetric('health_check_score', this.calculateHealthScore(health));

    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      await ObservabilityService.trackError(
        error as Error,
        'health_check_failed',
        undefined,
        { responseTime }
      );

      res.status(503).json({
        status: 'critical',
        timestamp: new Date().toISOString(),
        responseTime,
        error: 'Health check failed',
        details: (error as Error).message
      });
    }
  }

  // Readiness probe (Kubernetes)
  static async readinessProbe(req: Request, res: Response): Promise<void> {
    try {
      // Check critical services only
      const [dbCheck, redisCheck] = await Promise.all([
        this.checkDatabase(),
        this.checkRedis()
      ]);

      const criticalServices = [dbCheck, redisCheck];
      const allHealthy = criticalServices.every(service => service.status !== 'unhealthy');

      if (allHealthy) {
        res.status(200).json({ status: 'ready' });
      } else {
        res.status(503).json({ 
          status: 'not_ready',
          issues: criticalServices.filter(s => s.status === 'unhealthy').map(s => s.service)
        });
      }
    } catch (error) {
      res.status(503).json({ 
        status: 'not_ready',
        error: (error as Error).message 
      });
    }
  }

  // Liveness probe (Kubernetes)
  static async livenessProbe(req: Request, res: Response): Promise<void> {
    try {
      // Simple check that the process is responsive
      const memUsage = process.memoryUsage();
      
      // Check if memory usage is reasonable
      if (memUsage.heapUsed > 1024 * 1024 * 1024) { // > 1GB
        throw new Error('Memory usage too high');
      }

      res.status(200).json({ 
        status: 'alive',
        uptime: process.uptime(),
        pid: process.pid
      });
    } catch (error) {
      res.status(503).json({ 
        status: 'unhealthy',
        error: (error as Error).message 
      });
    }
  }

  // Startup probe (Kubernetes)
  static async startupProbe(req: Request, res: Response): Promise<void> {
    try {
      // Check if application has fully initialized
      const checks = await Promise.all([
        prisma.$connect(),
        redis.ping()
      ]);

      res.status(200).json({ 
        status: 'started',
        checks: checks.length
      });
    } catch (error) {
      res.status(503).json({ 
        status: 'starting',
        error: (error as Error).message 
      });
    }
  }

  // Health trends analysis
  static async getHealthTrends(hours: number = 24): Promise<{
    trends: Array<{
      service: string;
      healthScore: number;
      trend: 'improving' | 'stable' | 'degrading';
      issues: string[];
    }>;
    recommendations: string[];
  }> {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    const trends = [];

    for (const [serviceName, history] of this.healthHistory.entries()) {
      const recentChecks = history.filter(check => check.lastCheck >= cutoffTime);
      
      if (recentChecks.length < 2) continue;

      const healthScore = this.calculateServiceHealthScore(recentChecks);
      const trend = this.analyzeTrend(recentChecks);
      const issues = this.identifyIssues(recentChecks);

      trends.push({
        service: serviceName,
        healthScore,
        trend,
        issues
      });
    }

    const recommendations = this.generateHealthRecommendations(trends);

    return { trends, recommendations };
  }

  private static calculateHealthScore(health: SystemHealth): number {
    const serviceScores = health.services.map(service => {
      switch (service.status) {
        case 'healthy': return 100;
        case 'degraded': return 70;
        case 'unhealthy': return 0;
      }
    });

    return serviceScores.reduce((a, b) => a + b, 0) / serviceScores.length;
  }

  private static calculateServiceHealthScore(checks: HealthCheck[]): number {
    const scores = checks.map(check => {
      switch (check.status) {
        case 'healthy': return 100;
        case 'degraded': return 70;
        case 'unhealthy': return 0;
      }
    });

    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  private static analyzeTrend(checks: HealthCheck[]): 'improving' | 'stable' | 'degrading' {
    if (checks.length < 3) return 'stable';

    const recentScores = checks.slice(-10).map(check => {
      switch (check.status) {
        case 'healthy': return 100;
        case 'degraded': return 70;
        case 'unhealthy': return 0;
      }
    });

    const early = recentScores.slice(0, Math.floor(recentScores.length / 2));
    const late = recentScores.slice(Math.floor(recentScores.length / 2));

    const earlyAvg = early.reduce((a, b) => a + b, 0) / early.length;
    const lateAvg = late.reduce((a, b) => a + b, 0) / late.length;

    const diff = lateAvg - earlyAvg;
    
    if (diff > 10) return 'improving';
    if (diff < -10) return 'degrading';
    return 'stable';
  }

  private static identifyIssues(checks: HealthCheck[]): string[] {
    const issues: string[] = [];
    const recentChecks = checks.slice(-5);

    const avgResponseTime = recentChecks.reduce((sum, check) => sum + check.responseTime, 0) / recentChecks.length;
    if (avgResponseTime > 1000) {
      issues.push('High response times detected');
    }

    const unhealthyCount = recentChecks.filter(check => check.status === 'unhealthy').length;
    if (unhealthyCount > recentChecks.length * 0.3) {
      issues.push('Frequent health check failures');
    }

    return issues;
  }

  private static generateHealthRecommendations(trends: any[]): string[] {
    const recommendations: string[] = [];

    const degradingServices = trends.filter(t => t.trend === 'degrading');
    if (degradingServices.length > 0) {
      recommendations.push(`Monitor degrading services: ${degradingServices.map(s => s.service).join(', ')}`);
    }

    const lowScoreServices = trends.filter(t => t.healthScore < 80);
    if (lowScoreServices.length > 0) {
      recommendations.push('Investigation required for services with low health scores');
    }

    if (trends.some(t => t.issues.includes('High response times detected'))) {
      recommendations.push('Consider scaling resources or optimizing queries');
    }

    return recommendations;
  }

  private static async getHealthRecommendations(health: SystemHealth): Promise<string[]> {
    const recommendations: string[] = [];

    if (health.performance.cpu > 80) {
      recommendations.push('Consider scaling up CPU resources');
    }

    if (health.performance.memory > 85) {
      recommendations.push('Memory usage high - consider scaling or optimization');
    }

    if (health.metrics.errorRate > 5) {
      recommendations.push('High error rate detected - investigate logs');
    }

    const unhealthyServices = health.services.filter(s => s.status === 'unhealthy');
    if (unhealthyServices.length > 0) {
      recommendations.push(`Critical: Fix unhealthy services: ${unhealthyServices.map(s => s.service).join(', ')}`);
    }

    return recommendations;
  }

  private static parseRedisMemoryInfo(info: string): { usedMB: number; maxMB: number } {
    const usedMatch = info.match(/used_memory:(\d+)/);
    const maxMatch = info.match(/maxmemory:(\d+)/);
    
    return {
      usedMB: usedMatch ? Math.round(parseInt(usedMatch[1]) / 1024 / 1024) : 0,
      maxMB: maxMatch ? Math.round(parseInt(maxMatch[1]) / 1024 / 1024) : 0
    };
  }
}

export default HealthCheckService;
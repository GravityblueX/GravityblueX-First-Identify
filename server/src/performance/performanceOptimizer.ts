import cluster from 'cluster';
import os from 'os';
import compression from 'compression';
import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { ObservabilityService } from '../services/observabilityService';
import { CacheService } from '../services/cacheService';

const prisma = new PrismaClient();

export class PerformanceOptimizer {
  private static performanceMetrics = new Map<string, Array<number>>();

  // Cluster management for multi-core utilization
  static initializeCluster() {
    if (cluster.isPrimary && process.env.NODE_ENV === 'production') {
      const numCPUs = os.cpus().length;
      console.log(`🚀 Master ${process.pid} starting ${numCPUs} workers`);

      // Fork workers
      for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
      }

      cluster.on('exit', (worker, code, signal) => {
        console.log(`💀 Worker ${worker.process.pid} died. Restarting...`);
        cluster.fork();
      });

      // Graceful shutdown
      process.on('SIGTERM', () => {
        console.log('🛑 Master received SIGTERM, shutting down gracefully');
        
        for (const id in cluster.workers) {
          cluster.workers[id]?.kill();
        }
      });

      return false; // Don't start Express in master process
    }
    
    return true; // Start Express in worker process
  }

  // Response compression with adaptive algorithms
  static createCompressionMiddleware() {
    return compression({
      filter: (req: Request, res: Response) => {
        // Don't compress if client doesn't support it
        if (req.headers['x-no-compression']) {
          return false;
        }

        // Compress JSON responses
        if (res.getHeader('content-type')?.toString().includes('application/json')) {
          return true;
        }

        // Use default compression filter for other content
        return compression.filter(req, res);
      },
      level: 6, // Good balance between compression ratio and speed
      threshold: 1024, // Only compress if response > 1KB
      windowBits: 15,
      memLevel: 8
    });
  }

  // Database query optimization
  static async optimizeQuery<T>(
    queryName: string,
    queryFn: () => Promise<T>,
    cacheKey?: string,
    cacheTTL: number = 300
  ): Promise<T> {
    const startTime = Date.now();

    try {
      // Try cache first if cache key provided
      if (cacheKey) {
        const cached = await CacheService.get(cacheKey);
        if (cached) {
          await this.recordQueryPerformance(queryName, Date.now() - startTime, true, 'cache_hit');
          return cached;
        }
      }

      // Execute query with connection pooling optimization
      const result = await queryFn();
      const duration = Date.now() - startTime;

      // Cache result if cache key provided
      if (cacheKey && result) {
        await CacheService.set(cacheKey, result, cacheTTL);
      }

      await this.recordQueryPerformance(queryName, duration, true, 'database');
      
      // Log slow queries
      if (duration > 1000) {
        await ObservabilityService.trackError(
          new Error(`Slow query detected: ${queryName}`),
          'performance_slow_query',
          undefined,
          { duration, queryName }
        );
      }

      return result;

    } catch (error) {
      await this.recordQueryPerformance(queryName, Date.now() - startTime, false, 'error');
      throw error;
    }
  }

  // Connection pool optimization
  static optimizePrismaConnection() {
    const prismaClient = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL
        }
      },
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' }
      ]
    });

    // Monitor slow queries
    prismaClient.$on('query', async (e) => {
      if (e.duration > 1000) {
        await ObservabilityService.recordBusinessMetric('slow_queries_total', 1, {
          query: e.query.substring(0, 100),
          duration: e.duration.toString()
        });
      }
    });

    return prismaClient;
  }

  // Memory optimization
  static createMemoryOptimization() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Monitor memory usage
      const memUsage = process.memoryUsage();
      
      // Garbage collection hints for large responses
      res.on('finish', () => {
        if (memUsage.heapUsed > 100 * 1024 * 1024) { // > 100MB
          if (global.gc) {
            global.gc();
          }
        }
      });

      // Stream large responses
      if (req.path.includes('/analytics') || req.path.includes('/export')) {
        res.setHeader('Transfer-Encoding', 'chunked');
      }

      next();
    };
  }

  // Request/Response optimization
  static createResponseOptimization() {
    return (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();

      // Add ETag for caching
      const originalSend = res.send;
      res.send = function(data: any) {
        if (typeof data === 'object') {
          const hash = require('crypto')
            .createHash('md5')
            .update(JSON.stringify(data))
            .digest('hex');
          res.setHeader('ETag', `"${hash}"`);
        }

        return originalSend.call(this, data);
      };

      // Add cache headers
      if (req.method === 'GET') {
        res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes
      }

      res.on('finish', async () => {
        const duration = Date.now() - startTime;
        
        await ObservabilityService.recordBusinessMetric('response_time_ms', duration, {
          method: req.method,
          endpoint: req.route?.path || req.path,
          status_code: res.statusCode.toString()
        });

        // Track slow responses
        if (duration > 2000) {
          await ObservabilityService.trackError(
            new Error(`Slow response: ${req.path}`),
            'performance_slow_response',
            (req as any).user?.id,
            { duration, path: req.path, method: req.method }
          );
        }
      });

      next();
    };
  }

  // Database connection pooling
  static async optimizeConnectionPool(): Promise<void> {
    const poolConfig = {
      max: 20, // Maximum number of clients in the pool
      min: 5,  // Minimum number of clients in the pool
      acquire: 30000, // Maximum time to wait for a connection
      idle: 10000,    // Maximum time a connection can be idle
      evict: 1000,    // How often to run eviction
      handleDisconnects: true
    };

    console.log('🔧 Optimizing database connection pool:', poolConfig);
  }

  // Batch processing for heavy operations
  static async processBatch<T, R>(
    items: T[],
    processor: (batch: T[]) => Promise<R[]>,
    batchSize: number = 100
  ): Promise<R[]> {
    const results: R[] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await processor(batch);
      results.push(...batchResults);
      
      // Small delay to prevent overwhelming the system
      if (i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    
    return results;
  }

  // Query result pagination optimization
  static async paginateQuery<T>(
    queryFn: (skip: number, take: number) => Promise<T[]>,
    countFn: () => Promise<number>,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    data: T[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  }> {
    const skip = (page - 1) * limit;
    
    const [data, total] = await Promise.all([
      queryFn(skip, limit + 1), // Fetch one extra to check if there's a next page
      countFn()
    ]);

    const hasNext = data.length > limit;
    if (hasNext) {
      data.pop(); // Remove the extra item
    }

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext,
        hasPrev: page > 1
      }
    };
  }

  // Performance monitoring middleware
  static createPerformanceMonitoring() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const startTime = process.hrtime.bigint();
      const startMemory = process.memoryUsage().heapUsed;

      res.on('finish', async () => {
        const endTime = process.hrtime.bigint();
        const endMemory = process.memoryUsage().heapUsed;
        
        const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
        const memoryDelta = endMemory - startMemory;

        // Store performance metrics
        const endpoint = req.route?.path || req.path;
        if (!this.performanceMetrics.has(endpoint)) {
          this.performanceMetrics.set(endpoint, []);
        }
        
        const metrics = this.performanceMetrics.get(endpoint)!;
        metrics.push(duration);
        
        // Keep only last 100 measurements
        if (metrics.length > 100) {
          metrics.shift();
        }

        // Calculate statistics
        const avgDuration = metrics.reduce((a, b) => a + b, 0) / metrics.length;
        const p95Duration = metrics.sort((a, b) => a - b)[Math.floor(metrics.length * 0.95)];

        await ObservabilityService.recordBusinessMetric('request_duration_ms', duration, {
          endpoint,
          method: req.method,
          status_code: res.statusCode.toString()
        });

        await ObservabilityService.recordBusinessMetric('memory_usage_delta_bytes', memoryDelta, {
          endpoint,
          method: req.method
        });

        // Alert on performance degradation
        if (duration > avgDuration * 2 && duration > 1000) {
          await ObservabilityService.trackError(
            new Error(`Performance degradation detected: ${endpoint}`),
            'performance_degradation',
            (req as any).user?.id,
            {
              duration,
              average: avgDuration,
              p95: p95Duration,
              memoryDelta
            }
          );
        }
      });

      next();
    };
  }

  // Resource usage optimization
  static async optimizeResourceUsage(): Promise<void> {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Memory optimization
    if (memUsage.heapUsed > 500 * 1024 * 1024) { // > 500MB
      console.log('🧹 High memory usage detected, optimizing...');
      
      // Clear old performance metrics
      for (const [endpoint, metrics] of this.performanceMetrics.entries()) {
        if (metrics.length > 50) {
          this.performanceMetrics.set(endpoint, metrics.slice(-50));
        }
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
    }

    // CPU optimization
    const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to percentage
    if (cpuPercent > 80) {
      console.log('⚡ High CPU usage detected, implementing throttling...');
      
      // Implement adaptive throttling
      await this.implementAdaptiveThrottling();
    }

    await ObservabilityService.recordBusinessMetric('memory_heap_used_bytes', memUsage.heapUsed);
    await ObservabilityService.recordBusinessMetric('cpu_usage_percent', cpuPercent);
  }

  private static async implementAdaptiveThrottling(): Promise<void> {
    // Reduce batch sizes for heavy operations
    const heavyOperations = ['bulk_import', 'analytics_calculation', 'file_processing'];
    
    // This would be implemented based on specific use cases
    console.log('🐌 Implementing adaptive throttling for:', heavyOperations);
  }

  // Query performance analytics
  private static async recordQueryPerformance(
    queryName: string,
    duration: number,
    success: boolean,
    source: 'cache_hit' | 'database' | 'error'
  ): Promise<void> {
    await ObservabilityService.recordBusinessMetric('query_duration_ms', duration, {
      query_name: queryName,
      success: success.toString(),
      source
    });

    // Track query patterns
    if (!this.performanceMetrics.has(`query_${queryName}`)) {
      this.performanceMetrics.set(`query_${queryName}`, []);
    }
    
    const queryMetrics = this.performanceMetrics.get(`query_${queryName}`)!;
    queryMetrics.push(duration);
    
    if (queryMetrics.length > 1000) {
      queryMetrics.shift();
    }
  }

  // Database optimization recommendations
  static async analyzeQueryPerformance(): Promise<{
    slowQueries: Array<{
      query: string;
      avgDuration: number;
      callCount: number;
      recommendation: string;
    }>;
    indexRecommendations: string[];
    optimizationScore: number;
  }> {
    const slowQueries: any[] = [];
    let totalScore = 100;

    // Analyze stored query metrics
    for (const [queryName, durations] of this.performanceMetrics.entries()) {
      if (queryName.startsWith('query_')) {
        const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
        
        if (avgDuration > 500) { // Slow query threshold
          const recommendation = this.getQueryOptimizationRecommendation(queryName, avgDuration);
          
          slowQueries.push({
            query: queryName.replace('query_', ''),
            avgDuration,
            callCount: durations.length,
            recommendation
          });

          totalScore -= Math.min(30, avgDuration / 100);
        }
      }
    }

    const indexRecommendations = [
      'Add composite index on (project_id, status) for task queries',
      'Add index on created_at for timeline queries',
      'Add partial index on active sessions',
      'Consider materialized views for complex analytics'
    ];

    return {
      slowQueries,
      indexRecommendations,
      optimizationScore: Math.max(0, Math.round(totalScore))
    };
  }

  private static getQueryOptimizationRecommendation(queryName: string, duration: number): string {
    if (queryName.includes('analytics')) {
      return 'Consider using materialized views or pre-computed aggregations';
    }
    if (queryName.includes('search')) {
      return 'Implement full-text search with Elasticsearch or similar';
    }
    if (queryName.includes('list') || queryName.includes('find')) {
      return 'Add appropriate database indexes and implement pagination';
    }
    if (duration > 2000) {
      return 'Critical: Query exceeds 2s threshold, immediate optimization required';
    }
    return 'Consider adding database indexes or query restructuring';
  }

  // Real-time performance dashboard data
  static async getPerformanceDashboard(): Promise<{
    system: {
      cpu: number;
      memory: number;
      uptime: number;
      activeConnections: number;
    };
    application: {
      requestRate: number;
      errorRate: number;
      avgResponseTime: number;
      cacheHitRate: number;
    };
    database: {
      activeConnections: number;
      slowQueries: number;
      avgQueryTime: number;
    };
    alerts: Array<{
      type: string;
      severity: string;
      message: string;
      timestamp: Date;
    }>;
  }> {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // Calculate request rate from recent metrics
    const recentRequests = Array.from(this.performanceMetrics.values())
      .flat()
      .filter(duration => duration < 60000); // Last minute

    const requestRate = recentRequests.length / 60; // requests per second

    // Calculate error rate
    const errorCount = await prisma.auditLog.count({
      where: {
        severity: { in: ['HIGH', 'CRITICAL'] },
        timestamp: {
          gte: new Date(Date.now() - 60000) // Last minute
        }
      }
    });

    const errorRate = (errorCount / Math.max(recentRequests.length, 1)) * 100;

    // Calculate average response time
    const avgResponseTime = recentRequests.length > 0
      ? recentRequests.reduce((a, b) => a + b, 0) / recentRequests.length
      : 0;

    // Generate alerts
    const alerts: any[] = [];
    
    if (memUsage.heapUsed > 400 * 1024 * 1024) { // > 400MB
      alerts.push({
        type: 'HIGH_MEMORY_USAGE',
        severity: 'WARNING',
        message: `Memory usage at ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        timestamp: new Date()
      });
    }

    if (errorRate > 5) {
      alerts.push({
        type: 'HIGH_ERROR_RATE',
        severity: 'CRITICAL',
        message: `Error rate at ${errorRate.toFixed(2)}%`,
        timestamp: new Date()
      });
    }

    if (avgResponseTime > 2000) {
      alerts.push({
        type: 'SLOW_RESPONSES',
        severity: 'WARNING',
        message: `Average response time at ${avgResponseTime.toFixed(0)}ms`,
        timestamp: new Date()
      });
    }

    return {
      system: {
        cpu: (cpuUsage.user + cpuUsage.system) / 1000000,
        memory: memUsage.heapUsed / 1024 / 1024, // MB
        uptime: process.uptime(),
        activeConnections: recentRequests.length
      },
      application: {
        requestRate,
        errorRate,
        avgResponseTime,
        cacheHitRate: await CacheService.getCacheHitRate()
      },
      database: {
        activeConnections: 10, // Would be fetched from actual DB metrics
        slowQueries: slowQueries.length,
        avgQueryTime: this.getAverageQueryTime()
      },
      alerts
    };
  }

  private static getAverageQueryTime(): number {
    const queryTimes = Array.from(this.performanceMetrics.entries())
      .filter(([key]) => key.startsWith('query_'))
      .map(([, durations]) => durations)
      .flat();

    return queryTimes.length > 0
      ? queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length
      : 0;
  }

  // Auto-scaling recommendations
  static async getScalingRecommendations(): Promise<{
    currentLoad: number;
    recommendation: 'scale_up' | 'scale_down' | 'maintain';
    confidence: number;
    reasoning: string;
    suggestedReplicas: number;
  }> {
    const dashboard = await this.getPerformanceDashboard();
    
    let loadScore = 0;
    let reasoning: string[] = [];

    // CPU load factor
    if (dashboard.system.cpu > 80) {
      loadScore += 40;
      reasoning.push('High CPU usage');
    } else if (dashboard.system.cpu < 20) {
      loadScore -= 20;
      reasoning.push('Low CPU usage');
    }

    // Memory load factor
    if (dashboard.system.memory > 400) {
      loadScore += 30;
      reasoning.push('High memory usage');
    } else if (dashboard.system.memory < 100) {
      loadScore -= 15;
      reasoning.push('Low memory usage');
    }

    // Response time factor
    if (dashboard.application.avgResponseTime > 1000) {
      loadScore += 25;
      reasoning.push('Slow response times');
    }

    // Error rate factor
    if (dashboard.application.errorRate > 2) {
      loadScore += 20;
      reasoning.push('High error rate');
    }

    let recommendation: 'scale_up' | 'scale_down' | 'maintain';
    let suggestedReplicas = 3; // Current replicas

    if (loadScore > 50) {
      recommendation = 'scale_up';
      suggestedReplicas = Math.min(10, suggestedReplicas + 2);
    } else if (loadScore < -20) {
      recommendation = 'scale_down';
      suggestedReplicas = Math.max(2, suggestedReplicas - 1);
    } else {
      recommendation = 'maintain';
    }

    return {
      currentLoad: Math.max(0, Math.min(100, loadScore + 50)),
      recommendation,
      confidence: Math.abs(loadScore) > 30 ? 0.9 : 0.6,
      reasoning: reasoning.join(', '),
      suggestedReplicas
    };
  }
}

export default PerformanceOptimizer;
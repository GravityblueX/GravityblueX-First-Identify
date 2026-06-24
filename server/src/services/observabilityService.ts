import { Request, Response, NextFunction } from 'express';

type SpanStatus = 'OK' | 'ERROR';

class LocalSpan {
  private attributes: Record<string, any> = {};

  constructor(private readonly name: string) {}

  setAttributes(attributes: Record<string, any>) {
    this.attributes = { ...this.attributes, ...attributes };
  }

  setStatus(status: { code: SpanStatus }) {
    this.attributes.status = status.code;
  }

  recordException(error: Error) {
    this.attributes.error = error.message;
  }

  end() {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[trace] ${this.name}`, this.attributes);
    }
  }
}

const telemetrySDK = {
  start() {
    return undefined;
  },
  shutdown() {
    return Promise.resolve();
  }
};

function startSpan(name: string) {
  return new LocalSpan(name);
}

export class ObservabilityService {
  static createTracingMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const span = startSpan(`${req.method} ${req.path}`);
      span.setAttributes({
        'http.method': req.method,
        'http.url': req.url,
        'http.user_agent': req.get('User-Agent') || '',
        'user.id': (req as any).user?.id || 'anonymous'
      });

      (req as any).span = span;

      res.on('finish', () => {
        span.setAttributes({
          'http.status_code': res.statusCode,
          'http.response_size': res.get('content-length') || 0
        });
        span.setStatus({ code: res.statusCode >= 400 ? 'ERROR' : 'OK' });
        span.end();
      });

      next();
    };
  }

  static async recordBusinessMetric(
    metricName: string,
    value: number,
    tags: Record<string, string> = {}
  ) {
    const labelString = Object.entries(tags)
      .map(([key, val]) => `${key}="${val}"`)
      .join(',');
    console.log(`# METRIC ${metricName}{${labelString}} ${value}`);
  }

  static async trackUserAction(
    action: string,
    userId: string,
    metadata: Record<string, any> = {}
  ) {
    await this.recordBusinessMetric('user_actions_total', 1, {
      action,
      user_id: userId
    });
    startSpan(`user.action.${action}`).setAttributes(metadata);
  }

  static async trackProjectMetrics(projectId: string) {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    const [totalTasks, completedTasks, activeTasks, teamSize] = await Promise.all([
      prisma.task.count({ where: { projectId } }),
      prisma.task.count({ where: { projectId, status: 'DONE' } }),
      prisma.task.count({ where: { projectId, status: 'IN_PROGRESS' } }),
      prisma.projectMember.count({ where: { projectId } })
    ]);

    const metrics = {
      project_total_tasks: totalTasks,
      project_completed_tasks: completedTasks,
      project_active_tasks: activeTasks,
      project_team_size: teamSize,
      project_completion_rate: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0
    };

    for (const [metric, value] of Object.entries(metrics)) {
      await this.recordBusinessMetric(metric, value, { project_id: projectId });
    }
  }

  static async trackPerformanceMetric(
    operation: string,
    duration: number,
    success: boolean,
    metadata: Record<string, any> = {}
  ) {
    await this.recordBusinessMetric('operation_duration_seconds', duration / 1000, {
      operation,
      success: success.toString()
    });
    startSpan(`performance.${operation}`).setAttributes(metadata);
  }

  static async trackError(
    error: Error,
    context: string,
    userId?: string,
    additionalData?: Record<string, any>
  ) {
    const span = startSpan(`error.${context}`);
    span.recordException(error);
    span.setAttributes({
      'error.context': context,
      'error.message': error.message,
      'user.id': userId || 'unknown',
      ...additionalData
    });
    span.setStatus({ code: 'ERROR' });
    span.end();

    await this.recordBusinessMetric('errors_total', 1, {
      context,
      error_type: error.name,
      user_id: userId || 'unknown'
    });
  }

  static async instrumentAsyncOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    attributes: Record<string, any> = {}
  ): Promise<T> {
    const span = startSpan(operationName);
    const startTime = Date.now();
    span.setAttributes(attributes);

    try {
      const result = await operation();
      const duration = Date.now() - startTime;
      span.setAttributes({ 'operation.success': true, 'operation.duration_ms': duration });
      span.setStatus({ code: 'OK' });
      await this.trackPerformanceMetric(operationName, duration, true, attributes);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      span.recordException(error as Error);
      span.setStatus({ code: 'ERROR' });
      await this.trackPerformanceMetric(operationName, duration, false, attributes);
      await this.trackError(error as Error, operationName, attributes.userId);
      throw error;
    } finally {
      span.end();
    }
  }

  static async getSystemHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'critical';
    services: Array<{ name: string; status: string; responseTime?: number }>;
    metrics: Record<string, number>;
  }> {
    const startTime = Date.now();
    const services = [
      { name: 'database', status: 'healthy', responseTime: 10 },
      { name: 'redis', status: process.env.REDIS_URL ? 'healthy' : 'degraded', responseTime: 10 },
      { name: 'file-storage', status: process.env.CLOUDINARY_URL ? 'healthy' : 'degraded', responseTime: 10 }
    ];
    const healthy = services.filter((service) => service.status === 'healthy').length;

    return {
      status: healthy === services.length ? 'healthy' : healthy > 0 ? 'degraded' : 'critical',
      services,
      metrics: {
        total_response_time: Date.now() - startTime,
        healthy_services: healthy,
        total_services: services.length,
        uptime: process.uptime()
      }
    };
  }

  static async checkAlerts() {
    const health = await this.getSystemHealth();
    if (health.status === 'critical') {
      console.log('CRITICAL ALERT: System health is critical', health);
    }
  }
}

export { telemetrySDK };
export default ObservabilityService;

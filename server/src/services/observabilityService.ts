import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/semantic-conventions';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Request, Response, NextFunction } from 'express';

// Initialize OpenTelemetry
const sdk = new NodeSDK({
  resource: new Resource({
    'service.name': 'teamsync-backend',
    'service.version': process.env.npm_package_version || '1.0.0',
    'deployment.environment': process.env.NODE_ENV || 'development'
  }),
  traceExporter: new JaegerExporter({
    endpoint: process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces'
  }),
  metricExporter: new PrometheusExporter({
    port: 9464
  }),
  instrumentations: [getNodeAutoInstrumentations()]
});

sdk.start();

const tracer = trace.getTracer('teamsync-backend');

export class ObservabilityService {
  static createTracingMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const span = tracer.startSpan(`${req.method} ${req.path}`, {
        attributes: {
          'http.method': req.method,
          'http.url': req.url,
          'http.user_agent': req.get('User-Agent') || '',
          'user.id': (req as any).user?.id || 'anonymous'
        }
      });

      // Add span to request context
      (req as any).span = span;

      res.on('finish', () => {
        span.setAttributes({
          'http.status_code': res.statusCode,
          'http.response_size': res.get('content-length') || 0
        });

        if (res.statusCode >= 400) {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }

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
    const span = tracer.startSpan(`metric.${metricName}`);
    
    span.setAttributes({
      'metric.name': metricName,
      'metric.value': value,
      ...tags
    });

    // Also record in Prometheus format if needed
    await this.recordPrometheusMetric(metricName, value, tags);
    
    span.end();
  }

  private static async recordPrometheusMetric(
    name: string, 
    value: number, 
    labels: Record<string, string>
  ) {
    // Custom Prometheus metrics implementation
    const labelString = Object.entries(labels)
      .map(([key, val]) => `${key}="${val}"`)
      .join(',');
    
    console.log(`# METRIC ${name}{${labelString}} ${value}`);
  }

  // Business metrics tracking
  static async trackUserAction(
    action: string, 
    userId: string, 
    metadata: Record<string, any> = {}
  ) {
    const span = tracer.startSpan(`user.action.${action}`);
    
    span.setAttributes({
      'user.id': userId,
      'action.type': action,
      'action.timestamp': new Date().toISOString(),
      ...metadata
    });

    await this.recordBusinessMetric('user_actions_total', 1, {
      action,
      user_id: userId
    });

    span.end();
  }

  static async trackProjectMetrics(projectId: string) {
    const span = tracer.startSpan('project.metrics.calculation');
    
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      const [totalTasks, completedTasks, activeTasks, teamSize] = await Promise.all([
        prisma.task.count({ where: { projectId } }),
        prisma.task.count({ where: { projectId, status: 'DONE' } }),
        prisma.task.count({ where: { projectId, status: 'IN_PROGRESS' } }),
        prisma.projectMember.count({ where: { projectId } })
      ]);

      const metrics = {
        'project_total_tasks': totalTasks,
        'project_completed_tasks': completedTasks,
        'project_active_tasks': activeTasks,
        'project_team_size': teamSize,
        'project_completion_rate': totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0
      };

      for (const [metric, value] of Object.entries(metrics)) {
        await this.recordBusinessMetric(metric, value, { project_id: projectId });
      }

      span.setAttributes(metrics);
      span.setStatus({ code: SpanStatusCode.OK });

    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  }

  static async trackPerformanceMetric(
    operation: string,
    duration: number,
    success: boolean,
    metadata: Record<string, any> = {}
  ) {
    const span = tracer.startSpan(`performance.${operation}`);
    
    span.setAttributes({
      'operation.name': operation,
      'operation.duration': duration,
      'operation.success': success,
      ...metadata
    });

    await this.recordBusinessMetric('operation_duration_seconds', duration / 1000, {
      operation,
      success: success.toString()
    });

    span.end();
  }

  // Error tracking
  static async trackError(
    error: Error,
    context: string,
    userId?: string,
    additionalData?: Record<string, any>
  ) {
    const span = tracer.startSpan(`error.${context}`);
    
    span.recordException(error);
    span.setAttributes({
      'error.context': context,
      'error.message': error.message,
      'error.stack': error.stack || '',
      'user.id': userId || 'unknown',
      ...additionalData
    });

    span.setStatus({ code: SpanStatusCode.ERROR });

    await this.recordBusinessMetric('errors_total', 1, {
      context,
      error_type: error.name,
      user_id: userId || 'unknown'
    });

    span.end();

    // Also log to external error tracking service
    await this.sendToErrorTracking(error, context, userId, additionalData);
  }

  private static async sendToErrorTracking(
    error: Error,
    context: string,
    userId?: string,
    additionalData?: Record<string, any>
  ) {
    // Integration with Sentry, Bugsnag, or similar
    if (process.env.SENTRY_DSN) {
      // Sentry integration example
      console.log('📊 Sending error to Sentry:', {
        error: error.message,
        context,
        userId,
        additionalData
      });
    }
  }

  // Custom instrumentation helpers
  static instrumentAsyncOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    attributes: Record<string, any> = {}
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const span = tracer.startSpan(operationName);
      const startTime = Date.now();

      span.setAttributes(attributes);

      context.with(trace.setSpan(context.active(), span), async () => {
        try {
          const result = await operation();
          const duration = Date.now() - startTime;
          
          span.setAttributes({
            'operation.success': true,
            'operation.duration_ms': duration
          });
          
          span.setStatus({ code: SpanStatusCode.OK });
          
          // Record performance metric
          await this.trackPerformanceMetric(operationName, duration, true, attributes);
          
          span.end();
          resolve(result);
        } catch (error) {
          const duration = Date.now() - startTime;
          
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          
          await this.trackPerformanceMetric(operationName, duration, false, attributes);
          await this.trackError(error as Error, operationName, attributes.userId);
          
          span.end();
          reject(error);
        }
      });
    });
  }

  // Real-time monitoring
  static async getSystemHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'critical';
    services: Array<{ name: string; status: string; responseTime?: number }>;
    metrics: Record<string, number>;
  }> {
    const startTime = Date.now();
    
    try {
      const services = [
        { name: 'database', url: process.env.DATABASE_URL },
        { name: 'redis', url: process.env.REDIS_URL },
        { name: 'file-storage', url: process.env.CLOUDINARY_URL }
      ];

      const healthChecks = await Promise.allSettled(
        services.map(async (service) => {
          const checkStart = Date.now();
          
          try {
            // Simplified health check
            await new Promise(resolve => setTimeout(resolve, 10)); // Simulate check
            
            return {
              name: service.name,
              status: 'healthy',
              responseTime: Date.now() - checkStart
            };
          } catch (error) {
            return {
              name: service.name,
              status: 'unhealthy',
              responseTime: Date.now() - checkStart,
              error: (error as Error).message
            };
          }
        })
      );

      const results = healthChecks.map(check => 
        check.status === 'fulfilled' ? check.value : check.reason
      );

      const overallStatus = results.every(r => r.status === 'healthy') 
        ? 'healthy' 
        : results.some(r => r.status === 'healthy')
        ? 'degraded'
        : 'critical';

      const metrics = {
        total_response_time: Date.now() - startTime,
        healthy_services: results.filter(r => r.status === 'healthy').length,
        total_services: results.length,
        uptime: process.uptime()
      };

      return {
        status: overallStatus,
        services: results,
        metrics
      };
    } catch (error) {
      await this.trackError(error as Error, 'system_health_check');
      
      return {
        status: 'critical',
        services: [],
        metrics: {
          total_response_time: Date.now() - startTime,
          healthy_services: 0,
          total_services: 0,
          uptime: process.uptime()
        }
      };
    }
  }

  // Alerting
  static async checkAlerts() {
    const health = await this.getSystemHealth();
    
    if (health.status === 'critical') {
      await this.sendAlert('CRITICAL', 'System health is critical', {
        unhealthyServices: health.services.filter(s => s.status !== 'healthy').map(s => s.name)
      });
    }

    // Check response times
    const slowServices = health.services.filter(s => s.responseTime && s.responseTime > 5000);
    if (slowServices.length > 0) {
      await this.sendAlert('WARNING', 'Slow service response detected', {
        slowServices: slowServices.map(s => s.name)
      });
    }
  }

  private static async sendAlert(
    level: 'INFO' | 'WARNING' | 'CRITICAL',
    message: string,
    data: Record<string, any>
  ) {
    const alert = {
      level,
      message,
      data,
      timestamp: new Date().toISOString(),
      service: 'teamsync-backend'
    };

    console.log(`🚨 ${level} ALERT:`, alert);

    // Send to alerting system (PagerDuty, Slack, etc.)
    if (process.env.SLACK_WEBHOOK_URL) {
      try {
        await fetch(process.env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `${level}: ${message}`,
            attachments: [{
              color: level === 'CRITICAL' ? 'danger' : level === 'WARNING' ? 'warning' : 'good',
              fields: Object.entries(data).map(([key, value]) => ({
                title: key,
                value: JSON.stringify(value),
                short: true
              }))
            }]
          })
        });
      } catch (error) {
        console.error('Failed to send Slack alert:', error);
      }
    }
  }
}

// Export configured SDK
export { sdk as telemetrySDK };
export default ObservabilityService;
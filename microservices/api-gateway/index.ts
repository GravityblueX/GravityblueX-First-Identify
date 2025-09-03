import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';

const app = express();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Service URLs
const services = {
  user: process.env.USER_SERVICE_URL || 'http://localhost:3001',
  project: process.env.PROJECT_SERVICE_URL || 'http://localhost:3002',
  task: process.env.TASK_SERVICE_URL || 'http://localhost:3003',
  notification: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3004',
  analytics: process.env.ANALYTICS_SERVICE_URL || 'http://localhost:3005',
  file: process.env.FILE_SERVICE_URL || 'http://localhost:3006'
};

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

app.use(limiter);

// Authentication middleware
const authenticateToken = async (req: any, res: any, next: any) => {
  // Skip auth for public routes
  const publicRoutes = ['/api/auth', '/health', '/metrics'];
  if (publicRoutes.some(route => req.path.startsWith(route))) {
    return next();
  }

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Check token blacklist
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    if (isBlacklisted) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    
    // Add user info to headers for downstream services
    req.headers['x-user-id'] = decoded.userId;
    req.headers['x-user-role'] = decoded.role;
    
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

app.use(authenticateToken);

// Service routing with load balancing
const createServiceProxy = (serviceName: string, serviceUrl: string) => {
  return createProxyMiddleware({
    target: serviceUrl,
    changeOrigin: true,
    pathRewrite: {
      [`^/api/${serviceName}`]: ''
    },
    onProxyReq: (proxyReq, req) => {
      // Add tracing headers
      proxyReq.setHeader('x-correlation-id', req.headers['x-correlation-id'] || generateCorrelationId());
      proxyReq.setHeader('x-request-id', generateRequestId());
      proxyReq.setHeader('x-gateway-timestamp', new Date().toISOString());
    },
    onProxyRes: (proxyRes, req, res) => {
      // Add CORS headers
      proxyRes.headers['access-control-allow-origin'] = '*';
      proxyRes.headers['access-control-allow-methods'] = 'GET,PUT,POST,DELETE,OPTIONS';
      proxyRes.headers['access-control-allow-headers'] = 'Content-Type, Authorization, Content-Length, X-Requested-With';
    },
    onError: (err, req, res) => {
      console.error(`Proxy error for ${serviceName}:`, err);
      res.status(503).json({
        error: 'Service temporarily unavailable',
        service: serviceName
      });
    }
  });
};

// Route to services
app.use('/api/users', createServiceProxy('users', services.user));
app.use('/api/auth', createServiceProxy('auth', services.user)); // Auth is part of user service
app.use('/api/projects', createServiceProxy('projects', services.project));
app.use('/api/tasks', createServiceProxy('tasks', services.task));
app.use('/api/notifications', createServiceProxy('notifications', services.notification));
app.use('/api/analytics', createServiceProxy('analytics', services.analytics));
app.use('/api/files', createServiceProxy('files', services.file));

// GraphQL endpoint
app.use('/graphql', createProxyMiddleware({
  target: services.project, // Main GraphQL endpoint in project service
  changeOrigin: true
}));

// Health check aggregation
app.get('/health', async (req, res) => {
  const healthChecks = await Promise.allSettled([
    fetch(`${services.user}/health`),
    fetch(`${services.project}/health`),
    fetch(`${services.task}/health`),
    fetch(`${services.notification}/health`),
    fetch(`${services.analytics}/health`),
    fetch(`${services.file}/health`)
  ]);

  const results = healthChecks.map((check, index) => ({
    service: Object.keys(services)[index],
    status: check.status === 'fulfilled' ? 'healthy' : 'unhealthy',
    error: check.status === 'rejected' ? check.reason.message : null
  }));

  const overallHealth = results.every(r => r.status === 'healthy') ? 'healthy' : 'degraded';

  res.status(overallHealth === 'healthy' ? 200 : 503).json({
    status: overallHealth,
    timestamp: new Date().toISOString(),
    services: results,
    gateway: {
      status: 'healthy',
      uptime: process.uptime(),
      memory: process.memoryUsage()
    }
  });
});

// Metrics endpoint for Prometheus
app.get('/metrics', async (req, res) => {
  const metrics = await collectMetrics();
  res.set('Content-Type', 'text/plain');
  res.send(metrics);
});

// Circuit breaker pattern
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(
    private threshold = 5,
    private timeout = 60000 // 1 minute
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
    }
  }
}

// Service discovery
class ServiceRegistry {
  private services = new Map<string, { url: string; health: string; lastCheck: number }>();

  async registerService(name: string, url: string) {
    this.services.set(name, {
      url,
      health: 'unknown',
      lastCheck: 0
    });
  }

  async getService(name: string): Promise<string | null> {
    const service = this.services.get(name);
    if (!service) return null;

    // Health check if needed
    if (Date.now() - service.lastCheck > 30000) { // 30 seconds
      await this.checkServiceHealth(name, service);
    }

    return service.health === 'healthy' ? service.url : null;
  }

  private async checkServiceHealth(name: string, service: any) {
    try {
      const response = await fetch(`${service.url}/health`, { timeout: 5000 });
      service.health = response.ok ? 'healthy' : 'unhealthy';
    } catch (error) {
      service.health = 'unhealthy';
    }
    service.lastCheck = Date.now();
  }
}

// Utility functions
function generateCorrelationId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function generateRequestId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

async function collectMetrics(): Promise<string> {
  const metrics = [
    '# HELP gateway_requests_total Total number of requests',
    '# TYPE gateway_requests_total counter',
    'gateway_requests_total 12345',
    '',
    '# HELP gateway_request_duration_seconds Request duration in seconds',
    '# TYPE gateway_request_duration_seconds histogram',
    'gateway_request_duration_seconds_bucket{le="0.1"} 1000',
    'gateway_request_duration_seconds_bucket{le="0.5"} 5000',
    'gateway_request_duration_seconds_bucket{le="1.0"} 8000',
    'gateway_request_duration_seconds_bucket{le="+Inf"} 10000',
    '',
    '# HELP gateway_active_connections Current active connections',
    '# TYPE gateway_active_connections gauge',
    `gateway_active_connections ${Object.keys(require('cluster').workers || {}).length}`,
  ];

  return metrics.join('\n');
}

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`🚀 API Gateway running on port ${PORT}`);
  console.log('🔗 Service URLs:', services);
});

export default app;
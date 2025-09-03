import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { ObservabilityService } from '../services/observabilityService';

const prisma = new PrismaClient();

export class SecurityService {
  // Advanced rate limiting with Redis backend
  static createAdvancedRateLimit() {
    return rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: '15 minutes'
      },
      standardHeaders: true,
      legacyHeaders: false,
      // Custom key generator for authenticated users
      keyGenerator: (req: Request) => {
        return (req as any).user?.id || req.ip;
      },
      // Skip successful requests for certain endpoints
      skipSuccessfulRequests: false,
      // Custom handler for rate limit exceeded
      handler: async (req: Request, res: Response) => {
        await ObservabilityService.trackError(
          new Error('Rate limit exceeded'),
          'rate_limiting',
          (req as any).user?.id,
          { ip: req.ip, endpoint: req.path }
        );
        
        res.status(429).json({
          error: 'Too many requests',
          retryAfter: '15 minutes',
          type: 'RATE_LIMIT_EXCEEDED'
        });
      }
    });
  }

  // Advanced security headers configuration
  static getSecurityHeaders() {
    return helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: []
        }
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      },
      noSniff: true,
      xssFilter: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
    });
  }

  // Input validation and sanitization
  static sanitizeInput(input: any): any {
    if (typeof input === 'string') {
      return input
        .trim()
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    }
    
    if (Array.isArray(input)) {
      return input.map(item => this.sanitizeInput(item));
    }
    
    if (typeof input === 'object' && input !== null) {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(input)) {
        sanitized[key] = this.sanitizeInput(value);
      }
      return sanitized;
    }
    
    return input;
  }

  // SQL injection prevention
  static validateSqlQuery(query: string): boolean {
    const suspiciousPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b.*\b(FROM|INTO|SET|WHERE|UNION|JOIN)\b)/i,
      /('|(\\\')|(\-\-)|(\;)|(\|)|(\*)|(\%))/,
      /(\b(OR|AND)\b.*[\=\<\>].*(\b(OR|AND)\b))/i
    ];
    
    return !suspiciousPatterns.some(pattern => pattern.test(query));
  }

  // Advanced password security
  static async hashPassword(password: string): Promise<string> {
    const saltRounds = 14; // Increased from default 10
    return bcrypt.hash(password, saltRounds);
  }

  static async validatePasswordStrength(password: string): Promise<{
    isValid: boolean;
    score: number;
    feedback: string[];
  }> {
    const feedback: string[] = [];
    let score = 0;

    // Length check
    if (password.length >= 12) score += 2;
    else if (password.length >= 8) score += 1;
    else feedback.push('Password should be at least 8 characters long');

    // Character variety
    if (/[a-z]/.test(password)) score += 1;
    else feedback.push('Include lowercase letters');

    if (/[A-Z]/.test(password)) score += 1;
    else feedback.push('Include uppercase letters');

    if (/[0-9]/.test(password)) score += 1;
    else feedback.push('Include numbers');

    if (/[^A-Za-z0-9]/.test(password)) score += 2;
    else feedback.push('Include special characters');

    // Common password check
    const commonPasswords = ['password', '123456', 'qwerty', 'admin'];
    if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
      score -= 2;
      feedback.push('Avoid common password patterns');
    }

    return {
      isValid: score >= 5,
      score: Math.max(0, Math.min(10, score)),
      feedback
    };
  }

  // Two-factor authentication
  static generateTOTPSecret(): string {
    return crypto.randomBytes(20).toString('hex');
  }

  static generateTOTPCode(secret: string): string {
    const time = Math.floor(Date.now() / 30000);
    const hmac = crypto.createHmac('sha1', Buffer.from(secret, 'hex'));
    hmac.update(Buffer.from(time.toString(16).padStart(16, '0'), 'hex'));
    
    const hash = hmac.digest();
    const offset = hash[hash.length - 1] & 0xf;
    const code = ((hash[offset] & 0x7f) << 24) |
                 ((hash[offset + 1] & 0xff) << 16) |
                 ((hash[offset + 2] & 0xff) << 8) |
                 (hash[offset + 3] & 0xff);
    
    return (code % 1000000).toString().padStart(6, '0');
  }

  static verifyTOTPCode(secret: string, token: string): boolean {
    const currentCode = this.generateTOTPCode(secret);
    return currentCode === token;
  }

  // Session management
  static async createSecureSession(userId: string, deviceInfo: any): Promise<string> {
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await prisma.userSession.create({
      data: {
        id: sessionId,
        userId,
        deviceInfo: JSON.stringify(deviceInfo),
        expiresAt,
        isActive: true
      }
    });

    return sessionId;
  }

  static async validateSession(sessionId: string): Promise<boolean> {
    const session = await prisma.userSession.findUnique({
      where: { id: sessionId, isActive: true },
      include: { user: true }
    });

    if (!session || session.expiresAt < new Date()) {
      if (session) {
        await prisma.userSession.update({
          where: { id: sessionId },
          data: { isActive: false }
        });
      }
      return false;
    }

    // Update last activity
    await prisma.userSession.update({
      where: { id: sessionId },
      data: { lastActivity: new Date() }
    });

    return true;
  }

  // Audit logging
  static async logSecurityEvent(
    eventType: string,
    userId?: string,
    details?: Record<string, any>,
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM'
  ) {
    const auditLog = {
      id: crypto.randomUUID(),
      eventType,
      userId: userId || null,
      details: JSON.stringify(details || {}),
      severity,
      timestamp: new Date(),
      ipAddress: details?.ipAddress || 'unknown'
    };

    await prisma.auditLog.create({ data: auditLog });

    // Alert on critical events
    if (severity === 'CRITICAL') {
      await ObservabilityService.trackError(
        new Error(`Critical security event: ${eventType}`),
        'security_critical',
        userId,
        details
      );
    }

    await ObservabilityService.recordBusinessMetric('security_events_total', 1, {
      event_type: eventType,
      severity: severity.toLowerCase()
    });
  }

  // Data encryption
  static encrypt(text: string, key?: string): string {
    const encryptionKey = key || process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', encryptionKey);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  static decrypt(encryptedText: string, key?: string): string {
    const encryptionKey = key || process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
    const textParts = encryptedText.split(':');
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encryptedData = textParts.join(':');
    
    const decipher = crypto.createDecipher('aes-256-cbc', encryptionKey);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  // GDPR compliance helpers
  static async anonymizeUserData(userId: string): Promise<void> {
    const anonymizedData = {
      email: `deleted-user-${Date.now()}@example.com`,
      firstName: 'Deleted',
      lastName: 'User',
      avatar: null,
      isActive: false,
      lastLogin: null
    };

    await prisma.user.update({
      where: { id: userId },
      data: anonymizedData
    });

    await this.logSecurityEvent('USER_DATA_ANONYMIZED', userId, {
      reason: 'GDPR_REQUEST'
    }, 'MEDIUM');
  }

  static async exportUserData(userId: string): Promise<any> {
    const userData = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        projects: true,
        tasks: true,
        comments: true,
        messages: true,
        files: true,
        notifications: true
      }
    });

    await this.logSecurityEvent('USER_DATA_EXPORTED', userId, {
      reason: 'GDPR_REQUEST',
      dataSize: JSON.stringify(userData).length
    });

    return userData;
  }

  // Vulnerability scanning
  static async scanForVulnerabilities(): Promise<{
    score: number;
    vulnerabilities: Array<{
      type: string;
      severity: string;
      description: string;
      recommendation: string;
    }>;
  }> {
    const vulnerabilities: any[] = [];
    let score = 100;

    // Check for weak passwords
    const weakPasswords = await prisma.user.count({
      where: {
        password: {
          contains: 'password'
        }
      }
    });

    if (weakPasswords > 0) {
      vulnerabilities.push({
        type: 'WEAK_PASSWORDS',
        severity: 'HIGH',
        description: `${weakPasswords} users have weak passwords`,
        recommendation: 'Enforce stronger password policies'
      });
      score -= 20;
    }

    // Check for inactive sessions
    const staleSessions = await prisma.userSession.count({
      where: {
        lastActivity: {
          lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days
        },
        isActive: true
      }
    });

    if (staleSessions > 0) {
      vulnerabilities.push({
        type: 'STALE_SESSIONS',
        severity: 'MEDIUM',
        description: `${staleSessions} stale sessions detected`,
        recommendation: 'Implement automatic session cleanup'
      });
      score -= 10;
    }

    // Check environment variables
    const criticalEnvVars = ['JWT_SECRET', 'DATABASE_URL', 'ENCRYPTION_KEY'];
    const missingEnvVars = criticalEnvVars.filter(envVar => !process.env[envVar]);

    if (missingEnvVars.length > 0) {
      vulnerabilities.push({
        type: 'MISSING_ENV_VARS',
        severity: 'CRITICAL',
        description: `Missing critical environment variables: ${missingEnvVars.join(', ')}`,
        recommendation: 'Set all required environment variables'
      });
      score -= 30;
    }

    return { score: Math.max(0, score), vulnerabilities };
  }
}

// Middleware for comprehensive security
export const securityMiddleware = {
  // Input sanitization middleware
  sanitizeInputs: (req: Request, res: Response, next: NextFunction) => {
    if (req.body) {
      req.body = SecurityService.sanitizeInput(req.body);
    }
    if (req.query) {
      req.query = SecurityService.sanitizeInput(req.query);
    }
    if (req.params) {
      req.params = SecurityService.sanitizeInput(req.params);
    }
    next();
  },

  // SQL injection prevention
  validateQuery: (req: Request, res: Response, next: NextFunction) => {
    const queryParams = Object.values(req.query).join(' ');
    const bodyParams = typeof req.body === 'object' ? JSON.stringify(req.body) : '';
    
    if (!SecurityService.validateSqlQuery(queryParams + bodyParams)) {
      SecurityService.logSecurityEvent(
        'SQL_INJECTION_ATTEMPT',
        (req as any).user?.id,
        { ip: req.ip, query: queryParams, body: bodyParams },
        'CRITICAL'
      );
      
      return res.status(400).json({
        error: 'Invalid request parameters',
        type: 'VALIDATION_ERROR'
      });
    }
    
    next();
  },

  // Request signing verification
  verifyRequestSignature: (req: Request, res: Response, next: NextFunction) => {
    const signature = req.headers['x-signature'] as string;
    const timestamp = req.headers['x-timestamp'] as string;
    
    if (!signature || !timestamp) {
      return res.status(401).json({
        error: 'Missing request signature',
        type: 'SIGNATURE_REQUIRED'
      });
    }

    // Verify timestamp is recent (within 5 minutes)
    const requestTime = parseInt(timestamp);
    const currentTime = Date.now();
    
    if (Math.abs(currentTime - requestTime) > 5 * 60 * 1000) {
      return res.status(401).json({
        error: 'Request timestamp too old',
        type: 'TIMESTAMP_EXPIRED'
      });
    }

    // Verify signature
    const payload = JSON.stringify(req.body) + timestamp;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.REQUEST_SIGNING_KEY || 'default-key')
      .update(payload)
      .digest('hex');

    if (signature !== expectedSignature) {
      SecurityService.logSecurityEvent(
        'INVALID_REQUEST_SIGNATURE',
        (req as any).user?.id,
        { ip: req.ip, providedSignature: signature },
        'HIGH'
      );

      return res.status(401).json({
        error: 'Invalid request signature',
        type: 'SIGNATURE_INVALID'
      });
    }

    next();
  },

  // IP whitelist/blacklist
  ipAccessControl: (req: Request, res: Response, next: NextFunction) => {
    const clientIp = req.ip;
    const whitelist = process.env.IP_WHITELIST?.split(',') || [];
    const blacklist = process.env.IP_BLACKLIST?.split(',') || [];

    if (blacklist.includes(clientIp)) {
      SecurityService.logSecurityEvent(
        'BLACKLISTED_IP_ACCESS',
        undefined,
        { ip: clientIp },
        'HIGH'
      );

      return res.status(403).json({
        error: 'Access denied',
        type: 'IP_BLOCKED'
      });
    }

    if (whitelist.length > 0 && !whitelist.includes(clientIp)) {
      SecurityService.logSecurityEvent(
        'NON_WHITELISTED_IP_ACCESS',
        undefined,
        { ip: clientIp },
        'MEDIUM'
      );

      return res.status(403).json({
        error: 'Access denied',
        type: 'IP_NOT_WHITELISTED'
      });
    }

    next();
  },

  // Detect suspicious activity
  suspiciousActivityDetection: async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user?.id;
    const ip = req.ip;
    
    if (userId) {
      // Check for unusual access patterns
      const recentActivity = await prisma.auditLog.findMany({
        where: {
          userId,
          timestamp: {
            gte: new Date(Date.now() - 60 * 60 * 1000) // Last hour
          }
        },
        orderBy: { timestamp: 'desc' }
      });

      // Detect rapid requests
      const rapidRequests = recentActivity.filter(
        log => Date.now() - log.timestamp.getTime() < 60000 // Last minute
      );

      if (rapidRequests.length > 50) {
        await SecurityService.logSecurityEvent(
          'SUSPICIOUS_RAPID_REQUESTS',
          userId,
          { ip, requestCount: rapidRequests.length },
          'HIGH'
        );
      }

      // Detect unusual IP changes
      const uniqueIps = new Set(
        recentActivity
          .map(log => JSON.parse(log.details || '{}').ipAddress)
          .filter(Boolean)
      );

      if (uniqueIps.size > 3) {
        await SecurityService.logSecurityEvent(
          'SUSPICIOUS_IP_HOPPING',
          userId,
          { ip, uniqueIps: Array.from(uniqueIps) },
          'MEDIUM'
        );
      }
    }

    next();
  }
};

export default SecurityService;
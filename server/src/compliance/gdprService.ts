import { PrismaClient } from '@prisma/client';
import { SecurityService } from '../security/securityService';
import { ObservabilityService } from '../services/observabilityService';

const prisma = new PrismaClient();

export interface DataProcessingRecord {
  id: string;
  userId: string;
  dataType: string;
  processingPurpose: string;
  legalBasis: 'consent' | 'contract' | 'legal_obligation' | 'vital_interests' | 'public_task' | 'legitimate_interests';
  retentionPeriod: number; // in days
  isActive: boolean;
  consentDate?: Date;
  withdrawalDate?: Date;
}

export interface GDPRRequest {
  id: string;
  userId: string;
  requestType: 'access' | 'rectification' | 'erasure' | 'portability' | 'restriction' | 'objection';
  status: 'pending' | 'in_progress' | 'completed' | 'rejected';
  requestDate: Date;
  completionDate?: Date;
  requestDetails: any;
  response?: any;
}

export class GDPRService {
  // Data mapping and inventory
  static async createDataMap(): Promise<{
    personalDataTypes: Array<{
      type: string;
      description: string;
      locations: string[];
      retentionPeriod: number;
      processingPurpose: string;
    }>;
    dataFlows: Array<{
      from: string;
      to: string;
      dataTypes: string[];
      frequency: string;
    }>;
  }> {
    return {
      personalDataTypes: [
        {
          type: 'user_identity',
          description: 'Email, name, avatar',
          locations: ['users table', 'audit_logs', 'sessions'],
          retentionPeriod: 2555, // 7 years
          processingPurpose: 'User authentication and communication'
        },
        {
          type: 'user_behavior',
          description: 'Login history, activity logs, preferences',
          locations: ['audit_logs', 'user_sessions', 'user_preferences'],
          retentionPeriod: 1095, // 3 years
          processingPurpose: 'Service improvement and security'
        },
        {
          type: 'project_data',
          description: 'Project content, task descriptions, comments',
          locations: ['projects', 'tasks', 'comments', 'files'],
          retentionPeriod: 2555, // 7 years
          processingPurpose: 'Service delivery and collaboration'
        },
        {
          type: 'communication_data',
          description: 'Chat messages, notifications',
          locations: ['messages', 'notifications'],
          retentionPeriod: 365, // 1 year
          processingPurpose: 'Real-time collaboration'
        }
      ],
      dataFlows: [
        {
          from: 'Application Database',
          to: 'Backup Systems',
          dataTypes: ['user_identity', 'project_data'],
          frequency: 'Daily'
        },
        {
          from: 'Application',
          to: 'Analytics Service',
          dataTypes: ['user_behavior'],
          frequency: 'Real-time'
        },
        {
          from: 'Application',
          to: 'Monitoring Systems',
          dataTypes: ['user_behavior'],
          frequency: 'Real-time'
        }
      ]
    };
  }

  // Consent management
  static async recordConsent(
    userId: string,
    dataType: string,
    purpose: string,
    legalBasis: DataProcessingRecord['legalBasis']
  ): Promise<void> {
    await prisma.dataProcessingRecord.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        dataType,
        processingPurpose: purpose,
        legalBasis,
        retentionPeriod: this.getRetentionPeriod(dataType),
        isActive: true,
        consentDate: new Date()
      }
    });

    await SecurityService.logSecurityEvent(
      'CONSENT_RECORDED',
      userId,
      { dataType, purpose, legalBasis }
    );
  }

  static async withdrawConsent(userId: string, dataType: string): Promise<void> {
    await prisma.dataProcessingRecord.updateMany({
      where: { userId, dataType, isActive: true },
      data: {
        isActive: false,
        withdrawalDate: new Date()
      }
    });

    await SecurityService.logSecurityEvent(
      'CONSENT_WITHDRAWN',
      userId,
      { dataType }
    );

    // Trigger data deletion if required
    await this.handleConsentWithdrawal(userId, dataType);
  }

  private static getRetentionPeriod(dataType: string): number {
    const retentionPolicies: Record<string, number> = {
      'user_identity': 2555, // 7 years
      'user_behavior': 1095, // 3 years
      'project_data': 2555, // 7 years
      'communication_data': 365 // 1 year
    };

    return retentionPolicies[dataType] || 365;
  }

  private static async handleConsentWithdrawal(userId: string, dataType: string): Promise<void> {
    switch (dataType) {
      case 'communication_data':
        await prisma.message.deleteMany({ where: { userId } });
        await prisma.notification.deleteMany({ where: { userId } });
        break;
      case 'user_behavior':
        await prisma.auditLog.deleteMany({ where: { userId } });
        await prisma.userSession.deleteMany({ where: { userId } });
        break;
    }
  }

  // Right to access (Article 15)
  static async handleAccessRequest(userId: string): Promise<any> {
    const request = await this.createGDPRRequest(userId, 'access', {
      requestedData: 'all personal data'
    });

    try {
      const userData = await SecurityService.exportUserData(userId);
      const processingRecords = await prisma.dataProcessingRecord.findMany({
        where: { userId }
      });

      const response = {
        personalData: userData,
        processingActivities: processingRecords,
        dataRetentionInfo: await this.getDataRetentionInfo(userId),
        thirdPartySharing: await this.getThirdPartySharing(userId),
        automatedDecisionMaking: await this.getAutomatedDecisions(userId)
      };

      await this.completeGDPRRequest(request.id, response);
      return response;

    } catch (error) {
      await this.rejectGDPRRequest(request.id, (error as Error).message);
      throw error;
    }
  }

  // Right to rectification (Article 16)
  static async handleRectificationRequest(
    userId: string,
    corrections: Record<string, any>
  ): Promise<void> {
    const request = await this.createGDPRRequest(userId, 'rectification', {
      corrections
    });

    try {
      // Validate corrections
      const allowedFields = ['firstName', 'lastName', 'email', 'avatar'];
      const validCorrections = Object.fromEntries(
        Object.entries(corrections).filter(([key]) => allowedFields.includes(key))
      );

      if (Object.keys(validCorrections).length === 0) {
        throw new Error('No valid fields to correct');
      }

      await prisma.user.update({
        where: { id: userId },
        data: validCorrections
      });

      await SecurityService.logSecurityEvent(
        'DATA_RECTIFICATION',
        userId,
        { corrections: validCorrections }
      );

      await this.completeGDPRRequest(request.id, { correctedFields: validCorrections });

    } catch (error) {
      await this.rejectGDPRRequest(request.id, (error as Error).message);
      throw error;
    }
  }

  // Right to erasure (Article 17)
  static async handleErasureRequest(
    userId: string,
    reason: string
  ): Promise<void> {
    const request = await this.createGDPRRequest(userId, 'erasure', {
      reason
    });

    try {
      // Check if user has active obligations
      const activeProjects = await prisma.project.count({
        where: {
          ownerId: userId,
          status: { in: ['ACTIVE', 'PLANNING'] }
        }
      });

      if (activeProjects > 0) {
        throw new Error('Cannot delete user with active projects. Please transfer ownership first.');
      }

      // Perform anonymization instead of deletion for audit compliance
      await SecurityService.anonymizeUserData(userId);

      await SecurityService.logSecurityEvent(
        'DATA_ERASURE_COMPLETED',
        userId,
        { reason, method: 'anonymization' },
        'HIGH'
      );

      await this.completeGDPRRequest(request.id, { 
        method: 'anonymization',
        reason: 'User has active project dependencies'
      });

    } catch (error) {
      await this.rejectGDPRRequest(request.id, (error as Error).message);
      throw error;
    }
  }

  // Right to data portability (Article 20)
  static async handlePortabilityRequest(
    userId: string,
    format: 'json' | 'csv' | 'xml' = 'json'
  ): Promise<string> {
    const request = await this.createGDPRRequest(userId, 'portability', {
      format
    });

    try {
      const userData = await SecurityService.exportUserData(userId);
      
      let exportedData: string;
      
      switch (format) {
        case 'csv':
          exportedData = this.convertToCSV(userData);
          break;
        case 'xml':
          exportedData = this.convertToXML(userData);
          break;
        default:
          exportedData = JSON.stringify(userData, null, 2);
      }

      await this.completeGDPRRequest(request.id, {
        format,
        dataSize: exportedData.length
      });

      return exportedData;

    } catch (error) {
      await this.rejectGDPRRequest(request.id, (error as Error).message);
      throw error;
    }
  }

  // Data retention management
  static async enforceDataRetention(): Promise<void> {
    const dataTypes = await this.createDataMap();
    
    for (const dataType of dataTypes.personalDataTypes) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - dataType.retentionPeriod);

      await this.cleanupExpiredData(dataType.type, cutoffDate);
    }

    await ObservabilityService.recordBusinessMetric('data_retention_cleanup_completed', 1);
  }

  private static async cleanupExpiredData(dataType: string, cutoffDate: Date): Promise<void> {
    let deletedCount = 0;

    switch (dataType) {
      case 'communication_data':
        const expiredMessages = await prisma.message.deleteMany({
          where: { createdAt: { lt: cutoffDate } }
        });
        deletedCount = expiredMessages.count;
        break;

      case 'user_behavior':
        const expiredLogs = await prisma.auditLog.deleteMany({
          where: { timestamp: { lt: cutoffDate } }
        });
        deletedCount = expiredLogs.count;
        break;
    }

    if (deletedCount > 0) {
      await SecurityService.logSecurityEvent(
        'AUTOMATED_DATA_CLEANUP',
        undefined,
        { dataType, deletedCount, cutoffDate },
        'LOW'
      );
    }
  }

  // GDPR request management
  private static async createGDPRRequest(
    userId: string,
    requestType: GDPRRequest['requestType'],
    details: any
  ): Promise<GDPRRequest> {
    const request = {
      id: crypto.randomUUID(),
      userId,
      requestType,
      status: 'pending' as const,
      requestDate: new Date(),
      requestDetails: JSON.stringify(details)
    };

    await prisma.gdprRequest.create({ data: request });

    await SecurityService.logSecurityEvent(
      'GDPR_REQUEST_CREATED',
      userId,
      { requestType, details }
    );

    return request;
  }

  private static async completeGDPRRequest(requestId: string, response: any): Promise<void> {
    await prisma.gdprRequest.update({
      where: { id: requestId },
      data: {
        status: 'completed',
        completionDate: new Date(),
        response: JSON.stringify(response)
      }
    });
  }

  private static async rejectGDPRRequest(requestId: string, reason: string): Promise<void> {
    await prisma.gdprRequest.update({
      where: { id: requestId },
      data: {
        status: 'rejected',
        completionDate: new Date(),
        response: JSON.stringify({ reason })
      }
    });
  }

  // Helper methods
  private static async getDataRetentionInfo(userId: string): Promise<any> {
    const processingRecords = await prisma.dataProcessingRecord.findMany({
      where: { userId, isActive: true }
    });

    return processingRecords.map(record => ({
      dataType: record.dataType,
      retentionPeriod: `${record.retentionPeriod} days`,
      purpose: record.processingPurpose,
      legalBasis: record.legalBasis
    }));
  }

  private static async getThirdPartySharing(userId: string): Promise<any> {
    return [
      {
        recipient: 'Slack Integration',
        dataTypes: ['user_identity', 'project_data'],
        purpose: 'Notification delivery',
        safeguards: 'Data processing agreement, encryption in transit'
      },
      {
        recipient: 'Cloudinary',
        dataTypes: ['file_uploads'],
        purpose: 'File storage and optimization',
        safeguards: 'EU-US Data Privacy Framework'
      }
    ];
  }

  private static async getAutomatedDecisions(userId: string): Promise<any> {
    return [
      {
        system: 'Task Prediction ML Model',
        purpose: 'Predict task completion times',
        logic: 'Machine learning algorithm based on historical data',
        significance: 'Helps with project planning',
        rightToHumanReview: true
      },
      {
        system: 'Spam Detection',
        purpose: 'Filter inappropriate content',
        logic: 'Content analysis and pattern matching',
        significance: 'Content moderation',
        rightToHumanReview: true
      }
    ];
  }

  private static convertToCSV(data: any): string {
    const flattenObject = (obj: any, prefix = ''): any => {
      const flattened: any = {};
      for (const key in obj) {
        if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
          Object.assign(flattened, flattenObject(obj[key], `${prefix}${key}.`));
        } else {
          flattened[`${prefix}${key}`] = obj[key];
        }
      }
      return flattened;
    };

    const flattened = flattenObject(data);
    const headers = Object.keys(flattened);
    const values = Object.values(flattened);

    return [headers.join(','), values.join(',')].join('\n');
  }

  private static convertToXML(data: any): string {
    const objectToXML = (obj: any, rootName = 'data'): string => {
      let xml = `<${rootName}>`;
      
      for (const key in obj) {
        if (Array.isArray(obj[key])) {
          xml += `<${key}>`;
          obj[key].forEach((item: any, index: number) => {
            xml += objectToXML(item, `item_${index}`);
          });
          xml += `</${key}>`;
        } else if (obj[key] && typeof obj[key] === 'object') {
          xml += objectToXML(obj[key], key);
        } else {
          xml += `<${key}>${obj[key]}</${key}>`;
        }
      }
      
      xml += `</${rootName}>`;
      return xml;
    };

    return `<?xml version="1.0" encoding="UTF-8"?>\n${objectToXML(data, 'userData')}`;
  }

  // Compliance reporting
  static async generateComplianceReport(): Promise<{
    overview: any;
    dataInventory: any;
    consentMetrics: any;
    requestMetrics: any;
    recommendations: string[];
  }> {
    const totalUsers = await prisma.user.count();
    const activeConsents = await prisma.dataProcessingRecord.count({
      where: { isActive: true }
    });
    
    const gdprRequests = await prisma.gdprRequest.groupBy({
      by: ['requestType', 'status'],
      _count: true
    });

    const recommendations: string[] = [];

    // Analyze compliance gaps
    const usersWithoutConsent = totalUsers - activeConsents;
    if (usersWithoutConsent > 0) {
      recommendations.push(`${usersWithoutConsent} users lack explicit consent records`);
    }

    const pendingRequests = await prisma.gdprRequest.count({
      where: { status: 'pending' }
    });
    if (pendingRequests > 0) {
      recommendations.push(`${pendingRequests} GDPR requests pending (must respond within 30 days)`);
    }

    return {
      overview: {
        totalUsers,
        activeConsents,
        complianceScore: Math.round((activeConsents / totalUsers) * 100)
      },
      dataInventory: await this.createDataMap(),
      consentMetrics: {
        totalConsents: activeConsents,
        consentRate: (activeConsents / totalUsers) * 100
      },
      requestMetrics: gdprRequests,
      recommendations
    };
  }

  // Privacy impact assessment
  static async conductPrivacyImpactAssessment(feature: string): Promise<{
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    dataTypes: string[];
    risks: Array<{
      risk: string;
      impact: string;
      likelihood: string;
      mitigation: string;
    }>;
    recommendations: string[];
  }> {
    const commonRisks = [
      {
        risk: 'Data breach exposure',
        impact: 'HIGH',
        likelihood: 'MEDIUM',
        mitigation: 'Implement encryption, access controls, and monitoring'
      },
      {
        risk: 'Unauthorized access',
        impact: 'HIGH',
        likelihood: 'LOW',
        mitigation: 'Strong authentication, session management, and audit logging'
      },
      {
        risk: 'Data retention violations',
        impact: 'MEDIUM',
        likelihood: 'MEDIUM',
        mitigation: 'Automated data cleanup and retention policies'
      }
    ];

    return {
      riskLevel: 'MEDIUM',
      dataTypes: ['user_identity', 'user_behavior', 'project_data'],
      risks: commonRisks,
      recommendations: [
        'Implement privacy by design principles',
        'Regular security audits and penetration testing',
        'Staff training on data protection',
        'Incident response procedures',
        'Regular backup and recovery testing'
      ]
    };
  }
}

export default GDPRService;
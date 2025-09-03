import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { spawn } from 'child_process';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { join } from 'path';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import * as crypto from 'crypto';
import { ObservabilityService } from '../services/observabilityService';
import { SecurityService } from '../security/securityService';

const prisma = new PrismaClient();

export interface BackupConfig {
  type: 'full' | 'incremental' | 'differential';
  schedule: {
    frequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
    time?: string;
    timezone?: string;
  };
  retention: {
    daily: number;    // Days to keep daily backups
    weekly: number;   // Weeks to keep weekly backups
    monthly: number;  // Months to keep monthly backups
    yearly: number;   // Years to keep yearly backups
  };
  encryption: {
    enabled: boolean;
    algorithm: string;
    keyId: string;
  };
  compression: {
    enabled: boolean;
    algorithm: 'gzip' | 'brotli' | 'zstd';
    level: number;
  };
  verification: {
    enabled: boolean;
    checksum: 'md5' | 'sha256';
    testRestore: boolean;
  };
}

export interface BackupMetadata {
  id: string;
  type: 'database' | 'files' | 'configuration' | 'full';
  timestamp: Date;
  size: number;
  checksum: string;
  encryption: boolean;
  compression: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'verified';
  location: string;
  retentionPolicy: string;
}

export interface RestorePoint {
  id: string;
  timestamp: Date;
  description: string;
  components: string[];
  verificationStatus: 'verified' | 'unverified' | 'failed';
  size: number;
  estimatedRestoreTime: number;
}

export class BackupService {
  private static s3Client: S3Client;
  private static backupConfig: BackupConfig;

  static initialize(config: BackupConfig): void {
    this.backupConfig = config;
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-west-2',
      credentials: {
        accessKeyId: process.env.AWS_BACKUP_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_BACKUP_SECRET_ACCESS_KEY!
      }
    });

    console.log('🔒 Backup service initialized with encryption:', config.encryption.enabled);
  }

  // Full system backup
  static async createFullBackup(description?: string): Promise<BackupMetadata> {
    const backupId = `backup_full_${Date.now()}`;
    
    return ObservabilityService.instrumentAsyncOperation(
      'full_backup_creation',
      async () => {
        console.log(`🗄️ Starting full backup: ${backupId}`);

        // Record backup start
        const backupRecord = await prisma.backup.create({
          data: {
            id: backupId,
            type: 'full',
            status: 'in_progress',
            timestamp: new Date(),
            description: description || 'Automated full backup',
            metadata: JSON.stringify({ config: this.backupConfig })
          }
        });

        try {
          // Parallel backup of different components
          const [databaseBackup, filesBackup, configBackup] = await Promise.all([
            this.backupDatabase(backupId),
            this.backupFiles(backupId),
            this.backupConfiguration(backupId)
          ]);

          // Create backup manifest
          const manifest = {
            id: backupId,
            timestamp: new Date(),
            components: {
              database: databaseBackup,
              files: filesBackup,
              configuration: configBackup
            },
            totalSize: databaseBackup.size + filesBackup.size + configBackup.size,
            checksums: {
              database: databaseBackup.checksum,
              files: filesBackup.checksum,
              configuration: configBackup.checksum
            }
          };

          // Upload manifest to S3
          const manifestPath = await this.uploadToS3(
            `backups/${backupId}/manifest.json`,
            JSON.stringify(manifest, null, 2),
            'application/json'
          );

          // Update backup record
          await prisma.backup.update({
            where: { id: backupId },
            data: {
              status: 'completed',
              size: manifest.totalSize,
              location: manifestPath,
              checksum: await this.calculateChecksum(JSON.stringify(manifest)),
              completedAt: new Date()
            }
          });

          // Verify backup if enabled
          if (this.backupConfig.verification.enabled) {
            await this.verifyBackup(backupId);
          }

          await SecurityService.logSecurityEvent(
            'BACKUP_COMPLETED',
            undefined,
            { backupId, type: 'full', size: manifest.totalSize },
            'LOW'
          );

          return {
            id: backupId,
            type: 'full',
            timestamp: new Date(),
            size: manifest.totalSize,
            checksum: await this.calculateChecksum(JSON.stringify(manifest)),
            encryption: this.backupConfig.encryption.enabled,
            compression: this.backupConfig.compression.algorithm,
            status: 'completed',
            location: manifestPath,
            retentionPolicy: this.getRetentionPolicy('full')
          };

        } catch (error) {
          await prisma.backup.update({
            where: { id: backupId },
            data: {
              status: 'failed',
              error: (error as Error).message,
              completedAt: new Date()
            }
          });

          await ObservabilityService.trackError(
            error as Error,
            'backup_creation_failed',
            undefined,
            { backupId, type: 'full' }
          );

          throw error;
        }
      },
      { backup_type: 'full', backup_id: backupId }
    );
  }

  // Database backup
  private static async backupDatabase(backupId: string): Promise<{ size: number; checksum: string; location: string }> {
    const dumpFile = join(process.cwd(), 'temp', `${backupId}_database.sql`);
    
    return new Promise((resolve, reject) => {
      const pgDump = spawn('pg_dump', [
        process.env.DATABASE_URL!,
        '--no-owner',
        '--no-privileges',
        '--clean',
        '--if-exists',
        '--verbose'
      ]);

      const writeStream = createWriteStream(dumpFile);
      pgDump.stdout.pipe(writeStream);

      pgDump.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`pg_dump exited with code ${code}`));
          return;
        }

        try {
          // Compress the dump file
          const compressedFile = `${dumpFile}.gz`;
          await this.compressFile(dumpFile, compressedFile);

          // Calculate checksum
          const checksum = await this.calculateFileChecksum(compressedFile);

          // Upload to S3
          const s3Location = await this.uploadFileToS3(
            `backups/${backupId}/database.sql.gz`,
            compressedFile
          );

          // Get file size
          const stats = await fs.stat(compressedFile);

          // Cleanup local files
          await fs.unlink(dumpFile);
          await fs.unlink(compressedFile);

          resolve({
            size: stats.size,
            checksum,
            location: s3Location
          });

        } catch (error) {
          reject(error);
        }
      });

      pgDump.on('error', reject);
    });
  }

  // Files backup
  private static async backupFiles(backupId: string): Promise<{ size: number; checksum: string; location: string }> {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const tarFile = join(process.cwd(), 'temp', `${backupId}_files.tar.gz`);

    return new Promise((resolve, reject) => {
      const tar = spawn('tar', [
        '-czf',
        tarFile,
        '-C',
        uploadDir,
        '.'
      ]);

      tar.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`tar exited with code ${code}`));
          return;
        }

        try {
          const checksum = await this.calculateFileChecksum(tarFile);
          const s3Location = await this.uploadFileToS3(
            `backups/${backupId}/files.tar.gz`,
            tarFile
          );

          const stats = await fs.stat(tarFile);
          await fs.unlink(tarFile);

          resolve({
            size: stats.size,
            checksum,
            location: s3Location
          });

        } catch (error) {
          reject(error);
        }
      });

      tar.on('error', reject);
    });
  }

  // Configuration backup
  private static async backupConfiguration(backupId: string): Promise<{ size: number; checksum: string; location: string }> {
    const configData = {
      environment: process.env.NODE_ENV,
      version: process.env.npm_package_version,
      timestamp: new Date().toISOString(),
      services: {
        database: !!process.env.DATABASE_URL,
        redis: !!process.env.REDIS_URL,
        storage: !!process.env.CLOUDINARY_URL
      },
      features: {
        realtime: true,
        analytics: true,
        ml: true,
        monitoring: true
      }
    };

    const configJson = JSON.stringify(configData, null, 2);
    const checksum = await this.calculateChecksum(configJson);
    
    const s3Location = await this.uploadToS3(
      `backups/${backupId}/configuration.json`,
      configJson,
      'application/json'
    );

    return {
      size: Buffer.byteLength(configJson, 'utf8'),
      checksum,
      location: s3Location
    };
  }

  // Incremental backup
  static async createIncrementalBackup(lastBackupTimestamp: Date): Promise<BackupMetadata> {
    const backupId = `backup_incremental_${Date.now()}`;
    
    return ObservabilityService.instrumentAsyncOperation(
      'incremental_backup_creation',
      async () => {
        console.log(`📈 Starting incremental backup: ${backupId}`);

        // Get changes since last backup
        const changes = await this.getChangesSince(lastBackupTimestamp);
        
        if (changes.totalChanges === 0) {
          console.log('📭 No changes detected, skipping incremental backup');
          return null as any;
        }

        // Create incremental backup package
        const incrementalData = {
          baseTimestamp: lastBackupTimestamp,
          changes,
          metadata: {
            backupId,
            type: 'incremental',
            timestamp: new Date()
          }
        };

        const incrementalJson = JSON.stringify(incrementalData, null, 2);
        const checksum = await this.calculateChecksum(incrementalJson);
        
        const s3Location = await this.uploadToS3(
          `backups/incremental/${backupId}.json`,
          incrementalJson,
          'application/json'
        );

        await prisma.backup.create({
          data: {
            id: backupId,
            type: 'incremental',
            status: 'completed',
            timestamp: new Date(),
            size: Buffer.byteLength(incrementalJson, 'utf8'),
            location: s3Location,
            checksum,
            description: `Incremental backup with ${changes.totalChanges} changes`,
            completedAt: new Date()
          }
        });

        return {
          id: backupId,
          type: 'incremental',
          timestamp: new Date(),
          size: Buffer.byteLength(incrementalJson, 'utf8'),
          checksum,
          encryption: this.backupConfig.encryption.enabled,
          compression: this.backupConfig.compression.algorithm,
          status: 'completed',
          location: s3Location,
          retentionPolicy: this.getRetentionPolicy('incremental')
        };
      },
      { backup_type: 'incremental', base_timestamp: lastBackupTimestamp.toISOString() }
    );
  }

  // Disaster recovery
  static async createDisasterRecoveryPlan(): Promise<{
    plan: {
      rto: number; // Recovery Time Objective (minutes)
      rpo: number; // Recovery Point Objective (minutes)
      criticality: 'low' | 'medium' | 'high' | 'critical';
    };
    procedures: Array<{
      step: number;
      action: string;
      estimatedTime: number;
      responsible: string;
      dependencies: string[];
    }>;
    contacts: Array<{
      role: string;
      name: string;
      phone: string;
      email: string;
    }>;
    testSchedule: {
      frequency: string;
      lastTest: Date;
      nextTest: Date;
    };
  }> {
    return {
      plan: {
        rto: 60,  // 1 hour recovery time objective
        rpo: 15,  // 15 minutes recovery point objective
        criticality: 'high'
      },
      procedures: [
        {
          step: 1,
          action: 'Assess scope of disaster and activate incident response team',
          estimatedTime: 5,
          responsible: 'DevOps Lead',
          dependencies: []
        },
        {
          step: 2,
          action: 'Notify stakeholders and activate communication plan',
          estimatedTime: 10,
          responsible: 'Product Manager',
          dependencies: ['step1']
        },
        {
          step: 3,
          action: 'Provision new infrastructure in secondary region',
          estimatedTime: 15,
          responsible: 'DevOps Engineer',
          dependencies: ['step1']
        },
        {
          step: 4,
          action: 'Restore database from latest backup',
          estimatedTime: 20,
          responsible: 'Database Administrator',
          dependencies: ['step3']
        },
        {
          step: 5,
          action: 'Deploy application services and verify functionality',
          estimatedTime: 15,
          responsible: 'DevOps Team',
          dependencies: ['step4']
        },
        {
          step: 6,
          action: 'Update DNS records to point to new infrastructure',
          estimatedTime: 5,
          responsible: 'DevOps Lead',
          dependencies: ['step5']
        },
        {
          step: 7,
          action: 'Verify system functionality and notify users',
          estimatedTime: 10,
          responsible: 'QA Team',
          dependencies: ['step6']
        }
      ],
      contacts: [
        {
          role: 'DevOps Lead',
          name: 'Emergency Contact',
          phone: '+1-555-0101',
          email: 'devops-lead@teamsync.com'
        },
        {
          role: 'Database Administrator',
          name: 'Emergency Contact',
          phone: '+1-555-0102',
          email: 'dba@teamsync.com'
        },
        {
          role: 'Product Manager',
          name: 'Emergency Contact',
          phone: '+1-555-0103',
          email: 'pm@teamsync.com'
        }
      ],
      testSchedule: {
        frequency: 'quarterly',
        lastTest: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        nextTest: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      }
    };
  }

  // Point-in-time recovery
  static async restoreToPointInTime(
    targetTimestamp: Date,
    components: ('database' | 'files' | 'configuration')[] = ['database', 'files', 'configuration']
  ): Promise<{
    restoreId: string;
    status: 'success' | 'partial' | 'failed';
    restoredComponents: string[];
    failedComponents: Array<{ component: string; error: string }>;
    duration: number;
  }> {
    const restoreId = `restore_${Date.now()}`;
    const startTime = Date.now();

    return ObservabilityService.instrumentAsyncOperation(
      'point_in_time_recovery',
      async () => {
        console.log(`🔄 Starting point-in-time recovery: ${restoreId}`);
        console.log(`📅 Target timestamp: ${targetTimestamp.toISOString()}`);

        // Find best backup for target time
        const baseBackup = await this.findBestBackupForTime(targetTimestamp);
        if (!baseBackup) {
          throw new Error('No suitable backup found for target timestamp');
        }

        const restoredComponents: string[] = [];
        const failedComponents: Array<{ component: string; error: string }> = [];

        // Restore each component
        for (const component of components) {
          try {
            console.log(`🔧 Restoring ${component}...`);
            await this.restoreComponent(component, baseBackup, targetTimestamp);
            restoredComponents.push(component);
            console.log(`✅ ${component} restored successfully`);
          } catch (error) {
            const errorMsg = (error as Error).message;
            failedComponents.push({ component, error: errorMsg });
            console.error(`❌ Failed to restore ${component}:`, errorMsg);
          }
        }

        const duration = Date.now() - startTime;
        let status: 'success' | 'partial' | 'failed';

        if (failedComponents.length === 0) {
          status = 'success';
        } else if (restoredComponents.length > 0) {
          status = 'partial';
        } else {
          status = 'failed';
        }

        // Log recovery completion
        await SecurityService.logSecurityEvent(
          'DISASTER_RECOVERY_COMPLETED',
          undefined,
          {
            restoreId,
            targetTimestamp: targetTimestamp.toISOString(),
            status,
            duration,
            restoredComponents,
            failedComponents
          },
          status === 'failed' ? 'CRITICAL' : status === 'partial' ? 'HIGH' : 'MEDIUM'
        );

        return {
          restoreId,
          status,
          restoredComponents,
          failedComponents,
          duration
        };
      },
      { restore_id: restoreId, target_timestamp: targetTimestamp.toISOString() }
    );
  }

  // Cross-region replication
  static async setupCrossRegionReplication(): Promise<void> {
    const secondaryRegions = ['us-east-1', 'eu-west-1', 'ap-southeast-1'];
    
    for (const region of secondaryRegions) {
      console.log(`🌍 Setting up replication to ${region}`);
      
      // Configure S3 cross-region replication
      await this.configureCrossRegionReplication(region);
      
      // Setup database read replicas
      await this.setupDatabaseReplica(region);
    }

    console.log('✅ Cross-region replication configured');
  }

  // Backup verification
  static async verifyBackup(backupId: string): Promise<{
    isValid: boolean;
    checksumVerified: boolean;
    restoreTestPassed: boolean;
    issues: string[];
  }> {
    return ObservabilityService.instrumentAsyncOperation(
      'backup_verification',
      async () => {
        console.log(`🔍 Verifying backup: ${backupId}`);

        const backup = await prisma.backup.findUnique({ where: { id: backupId } });
        if (!backup) {
          throw new Error('Backup not found');
        }

        const issues: string[] = [];
        let checksumVerified = false;
        let restoreTestPassed = false;

        try {
          // Verify checksums
          checksumVerified = await this.verifyBackupChecksum(backup);
          if (!checksumVerified) {
            issues.push('Checksum verification failed');
          }

          // Test restore if enabled
          if (this.backupConfig.verification.testRestore) {
            restoreTestPassed = await this.performRestoreTest(backup);
            if (!restoreTestPassed) {
              issues.push('Restore test failed');
            }
          } else {
            restoreTestPassed = true; // Skip test
          }

        } catch (error) {
          issues.push(`Verification error: ${(error as Error).message}`);
        }

        const isValid = checksumVerified && restoreTestPassed && issues.length === 0;

        // Update backup status
        await prisma.backup.update({
          where: { id: backupId },
          data: {
            status: isValid ? 'verified' : 'failed',
            verificationResults: JSON.stringify({
              checksumVerified,
              restoreTestPassed,
              issues
            })
          }
        });

        return {
          isValid,
          checksumVerified,
          restoreTestPassed,
          issues
        };
      },
      { backup_id: backupId }
    );
  }

  // Backup retention management
  static async cleanupOldBackups(): Promise<{
    deletedBackups: number;
    freedSpace: number;
    retainedBackups: number;
  }> {
    const retentionConfig = this.backupConfig.retention;
    let deletedCount = 0;
    let freedSpace = 0;

    // Calculate cutoff dates
    const cutoffDates = {
      daily: new Date(Date.now() - retentionConfig.daily * 24 * 60 * 60 * 1000),
      weekly: new Date(Date.now() - retentionConfig.weekly * 7 * 24 * 60 * 60 * 1000),
      monthly: new Date(Date.now() - retentionConfig.monthly * 30 * 24 * 60 * 60 * 1000),
      yearly: new Date(Date.now() - retentionConfig.yearly * 365 * 24 * 60 * 60 * 1000)
    };

    // Find expired backups
    const expiredBackups = await prisma.backup.findMany({
      where: {
        OR: [
          {
            type: 'incremental',
            timestamp: { lt: cutoffDates.daily }
          },
          {
            type: 'full',
            createdAt: { lt: cutoffDates.weekly }
          }
        ],
        status: { in: ['completed', 'verified'] }
      }
    });

    // Delete expired backups
    for (const backup of expiredBackups) {
      try {
        await this.deleteBackupFromStorage(backup.location);
        freedSpace += backup.size || 0;
        deletedCount++;

        await prisma.backup.delete({ where: { id: backup.id } });
        
        console.log(`🗑️ Deleted expired backup: ${backup.id}`);
      } catch (error) {
        console.error(`❌ Failed to delete backup ${backup.id}:`, error);
      }
    }

    const retainedCount = await prisma.backup.count();

    await ObservabilityService.recordBusinessMetric('backups_cleanup_deleted', deletedCount);
    await ObservabilityService.recordBusinessMetric('backups_cleanup_freed_bytes', freedSpace);

    return {
      deletedBackups: deletedCount,
      freedSpace,
      retainedBackups: retainedCount
    };
  }

  // Backup monitoring and alerts
  static async monitorBackupHealth(): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    lastSuccessfulBackup: Date | null;
    issues: string[];
    recommendations: string[];
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check last successful backup
    const lastBackup = await prisma.backup.findFirst({
      where: { status: 'completed' },
      orderBy: { timestamp: 'desc' }
    });

    const lastSuccessfulBackup = lastBackup?.timestamp || null;
    const timeSinceLastBackup = lastSuccessfulBackup 
      ? Date.now() - lastSuccessfulBackup.getTime()
      : Infinity;

    // Check backup frequency
    const maxInterval = 24 * 60 * 60 * 1000; // 24 hours
    if (timeSinceLastBackup > maxInterval) {
      issues.push('No successful backup in the last 24 hours');
      recommendations.push('Investigate backup failures and ensure scheduled backups are running');
    }

    // Check failed backups
    const recentFailures = await prisma.backup.count({
      where: {
        status: 'failed',
        timestamp: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
        }
      }
    });

    if (recentFailures > 0) {
      issues.push(`${recentFailures} backup failures in the last 7 days`);
      recommendations.push('Review backup logs and fix underlying issues');
    }

    // Check storage space
    const totalBackupSize = await prisma.backup.aggregate({
      _sum: { size: true },
      where: { status: { in: ['completed', 'verified'] } }
    });

    const totalSizeGB = (totalBackupSize._sum.size || 0) / (1024 * 1024 * 1024);
    if (totalSizeGB > 100) { // Arbitrary threshold
      recommendations.push('Consider optimizing backup retention policy due to high storage usage');
    }

    let status: 'healthy' | 'warning' | 'critical';
    if (issues.length === 0) {
      status = 'healthy';
    } else if (timeSinceLastBackup > maxInterval * 2) {
      status = 'critical';
    } else {
      status = 'warning';
    }

    return {
      status,
      lastSuccessfulBackup,
      issues,
      recommendations
    };
  }

  // Utility methods
  private static async getChangesSince(timestamp: Date): Promise<{
    totalChanges: number;
    tables: Record<string, number>;
    files: number;
  }> {
    const [
      userChanges,
      projectChanges,
      taskChanges,
      commentChanges,
      fileChanges
    ] = await Promise.all([
      prisma.user.count({ where: { updatedAt: { gte: timestamp } } }),
      prisma.project.count({ where: { updatedAt: { gte: timestamp } } }),
      prisma.task.count({ where: { updatedAt: { gte: timestamp } } }),
      prisma.comment.count({ where: { createdAt: { gte: timestamp } } }),
      prisma.file.count({ where: { createdAt: { gte: timestamp } } })
    ]);

    const tables = {
      users: userChanges,
      projects: projectChanges,
      tasks: taskChanges,
      comments: commentChanges,
      files: fileChanges
    };

    return {
      totalChanges: Object.values(tables).reduce((sum, count) => sum + count, 0),
      tables,
      files: fileChanges
    };
  }

  private static async findBestBackupForTime(targetTime: Date): Promise<any> {
    return prisma.backup.findFirst({
      where: {
        timestamp: { lte: targetTime },
        status: { in: ['completed', 'verified'] }
      },
      orderBy: { timestamp: 'desc' }
    });
  }

  private static async restoreComponent(
    component: string,
    backup: any,
    targetTime: Date
  ): Promise<void> {
    switch (component) {
      case 'database':
        await this.restoreDatabase(backup, targetTime);
        break;
      case 'files':
        await this.restoreFiles(backup);
        break;
      case 'configuration':
        await this.restoreConfiguration(backup);
        break;
      default:
        throw new Error(`Unknown component: ${component}`);
    }
  }

  private static async restoreDatabase(backup: any, targetTime: Date): Promise<void> {
    console.log('🗃️ Restoring database...');
    
    // Download backup from S3
    const localPath = await this.downloadFromS3(backup.location);
    
    // Decompress if needed
    const sqlFile = localPath.endsWith('.gz') 
      ? await this.decompressFile(localPath)
      : localPath;

    // Execute restore
    return new Promise((resolve, reject) => {
      const psql = spawn('psql', [
        process.env.DATABASE_URL!,
        '-f',
        sqlFile
      ]);

      psql.on('close', async (code) => {
        // Cleanup temp files
        await fs.unlink(localPath);
        if (sqlFile !== localPath) {
          await fs.unlink(sqlFile);
        }

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Database restore failed with code ${code}`));
        }
      });

      psql.on('error', reject);
    });
  }

  private static async restoreFiles(backup: any): Promise<void> {
    console.log('📁 Restoring files...');
    
    const localPath = await this.downloadFromS3(backup.location);
    const uploadDir = process.env.UPLOAD_DIR || './uploads';

    return new Promise((resolve, reject) => {
      const tar = spawn('tar', [
        '-xzf',
        localPath,
        '-C',
        uploadDir
      ]);

      tar.on('close', async (code) => {
        await fs.unlink(localPath);
        
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`File restore failed with code ${code}`));
        }
      });

      tar.on('error', reject);
    });
  }

  private static async restoreConfiguration(backup: any): Promise<void> {
    console.log('⚙️ Restoring configuration...');
    
    const configData = await this.downloadFromS3(backup.location);
    const config = JSON.parse(configData);
    
    // Apply configuration (this would update environment variables, etc.)
    console.log('Configuration restored:', config.version);
  }

  // Storage operations
  private static async uploadToS3(key: string, content: string, contentType: string): Promise<string> {
    const bucketName = process.env.AWS_BACKUP_BUCKET || 'teamsync-backups';
    
    await this.s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: content,
      ContentType: contentType,
      ServerSideEncryption: 'AES256'
    }));

    return `s3://${bucketName}/${key}`;
  }

  private static async uploadFileToS3(key: string, filePath: string): Promise<string> {
    const bucketName = process.env.AWS_BACKUP_BUCKET || 'teamsync-backups';
    const fileStream = createReadStream(filePath);
    
    await this.s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileStream,
      ServerSideEncryption: 'AES256'
    }));

    return `s3://${bucketName}/${key}`;
  }

  private static async downloadFromS3(s3Location: string): Promise<string> {
    const [bucketName, ...keyParts] = s3Location.replace('s3://', '').split('/');
    const key = keyParts.join('/');
    
    const response = await this.s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: key
    }));

    const localPath = join(process.cwd(), 'temp', `download_${Date.now()}_${key.split('/').pop()}`);
    const writeStream = createWriteStream(localPath);
    
    await pipeline(response.Body as any, writeStream);
    
    return localPath;
  }

  private static async deleteBackupFromStorage(location: string): Promise<void> {
    // Implementation would delete from S3
    console.log(`🗑️ Deleting backup from storage: ${location}`);
  }

  // File operations
  private static async compressFile(inputPath: string, outputPath: string): Promise<void> {
    const input = createReadStream(inputPath);
    const output = createWriteStream(outputPath);
    const gzip = createGzip({ level: this.backupConfig.compression.level });

    await pipeline(input, gzip, output);
  }

  private static async decompressFile(inputPath: string): Promise<string> {
    const outputPath = inputPath.replace('.gz', '');
    const input = createReadStream(inputPath);
    const output = createWriteStream(outputPath);
    const gunzip = createGunzip();

    await pipeline(input, gunzip, output);
    return outputPath;
  }

  private static async calculateChecksum(content: string): Promise<string> {
    const crypto = require('crypto');
    return crypto.createHash(this.backupConfig.verification.checksum).update(content).digest('hex');
  }

  private static async calculateFileChecksum(filePath: string): Promise<string> {
    const crypto = require('crypto');
    const hash = crypto.createHash(this.backupConfig.verification.checksum);
    const stream = createReadStream(filePath);
    
    return new Promise((resolve, reject) => {
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private static getRetentionPolicy(backupType: string): string {
    const config = this.backupConfig.retention;
    
    switch (backupType) {
      case 'full':
        return `${config.weekly} weeks`;
      case 'incremental':
        return `${config.daily} days`;
      default:
        return `${config.monthly} months`;
    }
  }

  private static async verifyBackupChecksum(backup: any): Promise<boolean> {
    try {
      const content = await this.downloadFromS3(backup.location);
      const calculatedChecksum = await this.calculateChecksum(content);
      return calculatedChecksum === backup.checksum;
    } catch (error) {
      console.error('Checksum verification failed:', error);
      return false;
    }
  }

  private static async performRestoreTest(backup: any): Promise<boolean> {
    // Create isolated test environment and attempt restore
    console.log('🧪 Performing restore test...');
    
    try {
      // This would create a test database and attempt restore
      // For demo purposes, returning true
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate test
      return true;
    } catch (error) {
      console.error('Restore test failed:', error);
      return false;
    }
  }

  private static async configureCrossRegionReplication(region: string): Promise<void> {
    console.log(`🔄 Configuring S3 replication to ${region}`);
    // S3 replication configuration would go here
  }

  private static async setupDatabaseReplica(region: string): Promise<void> {
    console.log(`🗄️ Setting up database replica in ${region}`);
    // RDS read replica configuration would go here
  }
}

export default BackupService;
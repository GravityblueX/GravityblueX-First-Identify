import { PrismaClient } from '@prisma/client';
import { createWriteStream } from 'fs';
import * as fs from 'fs';
import { join } from 'path';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { AdvancedAnalyticsService } from './advancedAnalyticsService';

const prisma = new PrismaClient();

export interface ReportConfig {
  id: string;
  name: string;
  description: string;
  type: 'dashboard' | 'scheduled' | 'ad_hoc';
  format: 'pdf' | 'excel' | 'csv' | 'json' | 'html';
  schedule?: {
    frequency: 'daily' | 'weekly' | 'monthly';
    time: string;
    recipients: string[];
  };
  filters: Record<string, any>;
  sections: ReportSection[];
  styling?: {
    theme: 'corporate' | 'modern' | 'minimal';
    colors: string[];
    logo?: string;
  };
}

export interface ReportSection {
  id: string;
  title: string;
  type: 'summary' | 'chart' | 'table' | 'kpi' | 'text';
  query: string;
  visualization?: {
    chartType: 'line' | 'bar' | 'pie' | 'area' | 'scatter' | 'heatmap';
    options: any;
  };
  formatting?: {
    numberFormat?: string;
    dateFormat?: string;
    conditionalFormatting?: Array<{
      condition: string;
      style: any;
    }>;
  };
}

export class ReportingEngine {
  private static reportTemplates = new Map<string, ReportConfig>();

  // Initialize default report templates
  static initializeTemplates(): void {
    this.registerTemplate({
      id: 'executive_summary',
      name: 'Executive Summary',
      description: 'High-level overview for leadership',
      type: 'scheduled',
      format: 'pdf',
      schedule: {
        frequency: 'weekly',
        time: '09:00',
        recipients: ['executives@teamsync.com']
      },
      filters: { timeRange: '7d' },
      sections: [
        {
          id: 'kpi_overview',
          title: 'Key Performance Indicators',
          type: 'kpi',
          query: 'executive_kpis'
        },
        {
          id: 'project_health',
          title: 'Project Health Status',
          type: 'chart',
          query: 'project_health_metrics',
          visualization: {
            chartType: 'bar',
            options: { stacked: true }
          }
        }
      ],
      styling: {
        theme: 'corporate',
        colors: ['#2563eb', '#10b981', '#f59e0b', '#ef4444']
      }
    });

    this.registerTemplate({
      id: 'technical_performance',
      name: 'Technical Performance Report',
      description: 'Detailed technical metrics for engineering teams',
      type: 'scheduled',
      format: 'excel',
      schedule: {
        frequency: 'daily',
        time: '08:00',
        recipients: ['engineering@teamsync.com']
      },
      filters: { timeRange: '24h' },
      sections: [
        {
          id: 'system_metrics',
          title: 'System Performance Metrics',
          type: 'table',
          query: 'system_performance'
        },
        {
          id: 'error_analysis',
          title: 'Error Rate Analysis',
          type: 'chart',
          query: 'error_metrics',
          visualization: {
            chartType: 'line',
            options: { smooth: true }
          }
        }
      ]
    });
  }

  static registerTemplate(template: ReportConfig): void {
    this.reportTemplates.set(template.id, template);
  }

  // Generate report from template
  static async generateReport(
    templateId: string,
    customFilters?: Record<string, any>,
    format?: ReportConfig['format']
  ): Promise<{
    reportId: string;
    filePath: string;
    metadata: {
      generatedAt: Date;
      format: string;
      size: number;
      sections: number;
    };
  }> {
    const template = this.reportTemplates.get(templateId);
    if (!template) {
      throw new Error(`Report template '${templateId}' not found`);
    }

    const reportId = `report_${templateId}_${Date.now()}`;
    const reportFormat = format || template.format;
    const filters = { ...template.filters, ...customFilters };

    // Collect data for all sections
    const sectionData = await Promise.all(
      template.sections.map(async (section) => {
        const data = await this.executeSectionQuery(section.query, filters);
        return { ...section, data };
      })
    );

    // Generate report based on format
    let filePath: string;
    switch (reportFormat) {
      case 'pdf':
        filePath = await this.generatePDFReport(reportId, template, sectionData);
        break;
      case 'excel':
        filePath = await this.generateExcelReport(reportId, template, sectionData);
        break;
      case 'csv':
        filePath = await this.generateCSVReport(reportId, template, sectionData);
        break;
      case 'html':
        filePath = await this.generateHTMLReport(reportId, template, sectionData);
        break;
      default:
        filePath = await this.generateJSONReport(reportId, template, sectionData);
    }

    // Get file size
    const stats = fs.statSync(filePath);

    return {
      reportId,
      filePath,
      metadata: {
        generatedAt: new Date(),
        format: reportFormat,
        size: stats.size,
        sections: sectionData.length
      }
    };
  }

  // PDF report generation
  private static async generatePDFReport(
    reportId: string,
    template: ReportConfig,
    sectionData: any[]
  ): Promise<string> {
    const filePath = join(process.cwd(), 'reports', `${reportId}.pdf`);
    const doc = new PDFDocument({ margin: 50 });
    const stream = createWriteStream(filePath);
    doc.pipe(stream);

    // Header
    doc.fontSize(24).text(template.name, { align: 'center' });
    doc.fontSize(12).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);

    // Sections
    for (const section of sectionData) {
      doc.addPage();
      doc.fontSize(18).text(section.title);
      doc.moveDown();

      switch (section.type) {
        case 'kpi':
          this.addKPISection(doc, section.data);
          break;
        case 'table':
          this.addTableSection(doc, section.data);
          break;
        case 'summary':
          doc.fontSize(12).text(JSON.stringify(section.data, null, 2));
          break;
        default:
          doc.fontSize(12).text(`Chart: ${section.title} (${section.visualization?.chartType})`);
          doc.text('Chart visualization would be rendered here in production');
      }
      
      doc.moveDown();
    }

    // Footer
    doc.fontSize(10).text(`Report ID: ${reportId}`, 50, doc.page.height - 50);

    doc.end();

    return new Promise((resolve, reject) => {
      stream.on('finish', () => resolve(filePath));
      stream.on('error', reject);
    });
  }

  // Excel report generation
  private static async generateExcelReport(
    reportId: string,
    template: ReportConfig,
    sectionData: any[]
  ): Promise<string> {
    const filePath = join(process.cwd(), 'reports', `${reportId}.xlsx`);
    const workbook = new ExcelJS.Workbook();

    // Metadata
    workbook.creator = 'TeamSync Analytics Engine';
    workbook.created = new Date();
    workbook.title = template.name;

    // Summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.addRow([template.name]);
    summarySheet.addRow([`Generated: ${new Date().toLocaleString()}`]);
    summarySheet.addRow([template.description]);
    summarySheet.addRow([]);

    // Add sections as separate worksheets
    for (const section of sectionData) {
      const worksheet = workbook.addWorksheet(section.title.substring(0, 31)); // Excel limit
      
      switch (section.type) {
        case 'table':
          this.addExcelTable(worksheet, section.data);
          break;
        case 'kpi':
          this.addExcelKPIs(worksheet, section.data);
          break;
        default:
          worksheet.addRow([section.title]);
          worksheet.addRow([JSON.stringify(section.data, null, 2)]);
      }
    }

    await workbook.xlsx.writeFile(filePath);
    return filePath;
  }

  // CSV report generation
  private static async generateCSVReport(
    reportId: string,
    template: ReportConfig,
    sectionData: any[]
  ): Promise<string> {
    const filePath = join(process.cwd(), 'reports', `${reportId}.csv`);
    
    let csvContent = `Report: ${template.name}\n`;
    csvContent += `Generated: ${new Date().toISOString()}\n\n`;

    for (const section of sectionData) {
      csvContent += `\n${section.title}\n`;
      csvContent += this.convertToCSV(section.data);
      csvContent += '\n';
    }

    fs.writeFileSync(filePath, csvContent);
    return filePath;
  }

  // HTML report generation
  private static async generateHTMLReport(
    reportId: string,
    template: ReportConfig,
    sectionData: any[]
  ): Promise<string> {
    const filePath = join(process.cwd(), 'reports', `${reportId}.html`);
    
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>${template.name}</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 40px; color: #333; }
        .header { background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; padding: 30px; border-radius: 8px; margin-bottom: 30px; }
        .header h1 { margin: 0; font-size: 2.5em; }
        .header p { margin: 10px 0 0 0; opacity: 0.9; }
        .section { background: #f8fafc; padding: 25px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #2563eb; }
        .section h2 { margin-top: 0; color: #1e40af; }
        .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }
        .kpi-card { background: white; padding: 20px; border-radius: 6px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .kpi-value { font-size: 2.5em; font-weight: bold; color: #2563eb; }
        .kpi-label { color: #64748b; margin-top: 8px; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
        th { background: #f1f5f9; font-weight: 600; color: #374151; }
        .chart-placeholder { background: #e2e8f0; padding: 40px; text-align: center; color: #64748b; border-radius: 6px; }
        .footer { margin-top: 50px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 0.9em; }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <div class="header">
        <h1>${template.name}</h1>
        <p>${template.description}</p>
        <p>Generated: ${new Date().toLocaleString()}</p>
    </div>

    ${sectionData.map(section => `
    <div class="section">
        <h2>${section.title}</h2>
        ${this.renderHTMLSection(section)}
    </div>
    `).join('')}

    <div class="footer">
        <p>Report ID: ${reportId} | Generated by TeamSync Analytics Engine</p>
    </div>
</body>
</html>`;

    fs.writeFileSync(filePath, html);
    return filePath;
  }

  // JSON report generation
  private static async generateJSONReport(
    reportId: string,
    template: ReportConfig,
    sectionData: any[]
  ): Promise<string> {
    const filePath = join(process.cwd(), 'reports', `${reportId}.json`);
    
    const reportData = {
      reportId,
      template: {
        name: template.name,
        description: template.description,
        type: template.type
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        format: 'json',
        sections: sectionData.length
      },
      sections: sectionData,
      performance: {
        generationTime: Date.now(),
        dataPoints: sectionData.reduce((sum, section) => 
          sum + (Array.isArray(section.data) ? section.data.length : 1), 0
        )
      }
    };

    fs.writeFileSync(filePath, JSON.stringify(reportData, null, 2));
    return filePath;
  }

  // Query execution for report sections
  private static async executeSectionQuery(query: string, filters: Record<string, any>): Promise<any> {
    const cacheKey = `report_query:${query}:${JSON.stringify(filters)}`;
    
    // Check cache first
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    let result: any;

    switch (query) {
      case 'executive_kpis':
        result = await this.getExecutiveKPIs(filters);
        break;
      case 'project_health_metrics':
        result = await this.getProjectHealthMetrics(filters);
        break;
      case 'system_performance':
        result = await this.getSystemPerformanceData(filters);
        break;
      case 'error_metrics':
        result = await this.getErrorMetrics(filters);
        break;
      case 'user_engagement':
        result = await this.getUserEngagementData(filters);
        break;
      case 'financial_overview':
        result = await this.getFinancialOverview(filters);
        break;
      default:
        throw new Error(`Unknown query: ${query}`);
    }

    // Cache for 10 minutes
    await CacheService.set(cacheKey, result, 600);
    return result;
  }

  // Scheduled report management
  static async scheduleReport(config: ReportConfig): Promise<void> {
    if (!config.schedule) {
      throw new Error('Schedule configuration required for scheduled reports');
    }

    // Store report configuration
    await prisma.reportConfig.create({
      data: {
        id: config.id,
        name: config.name,
        description: config.description,
        type: config.type,
        format: config.format,
        schedule: JSON.stringify(config.schedule),
        filters: JSON.stringify(config.filters),
        sections: JSON.stringify(config.sections),
        styling: JSON.stringify(config.styling),
        isActive: true
      }
    });

    console.log(`📅 Scheduled report '${config.name}' configured`);
  }

  static async processScheduledReports(): Promise<void> {
    const activeReports = await prisma.reportConfig.findMany({
      where: { 
        isActive: true,
        type: 'scheduled'
      }
    });

    for (const reportConfig of activeReports) {
      const schedule = JSON.parse(reportConfig.schedule || '{}');
      
      if (this.shouldGenerateReport(schedule)) {
        try {
          const config = {
            ...reportConfig,
            schedule: JSON.parse(reportConfig.schedule || '{}'),
            filters: JSON.parse(reportConfig.filters || '{}'),
            sections: JSON.parse(reportConfig.sections || '[]'),
            styling: JSON.parse(reportConfig.styling || '{}')
          } as ReportConfig;

          const report = await this.generateReport(reportConfig.id);
          await this.distributeReport(report, schedule.recipients);
          
          console.log(`📊 Generated scheduled report: ${reportConfig.name}`);
        } catch (error) {
          console.error(`❌ Failed to generate report ${reportConfig.name}:`, error);
        }
      }
    }
  }

  // Interactive dashboard data
  static async getDashboardData(
    dashboardId: string,
    userId: string,
    filters: Record<string, any> = {}
  ): Promise<{
    widgets: Array<{
      id: string;
      title: string;
      type: string;
      data: any;
      refreshRate: number;
    }>;
    lastUpdate: Date;
    nextUpdate: Date;
  }> {
    const cacheKey = `dashboard:${dashboardId}:${userId}`;
    
    // Check for cached dashboard data
    let dashboardData = await CacheService.get(cacheKey);
    
    if (!dashboardData) {
      dashboardData = await this.buildDashboardData(dashboardId, userId, filters);
      await CacheService.set(cacheKey, dashboardData, 300); // 5 minutes cache
    }

    return {
      ...dashboardData,
      lastUpdate: new Date(),
      nextUpdate: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    };
  }

  // Custom query builder
  static async executeCustomQuery(
    userId: string,
    query: {
      select: string[];
      from: string;
      where?: Record<string, any>;
      groupBy?: string[];
      orderBy?: Array<{ field: string; direction: 'asc' | 'desc' }>;
      limit?: number;
    }
  ): Promise<any> {
    // Validate user permissions for custom queries
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (user?.role !== 'ADMIN' && user?.role !== 'ANALYST') {
      throw new Error('Insufficient permissions for custom queries');
    }

    // Build and execute safe query
    // This would implement a query builder with SQL injection protection
    console.log('🔍 Executing custom query:', query);
    
    // For demo purposes, returning sample data
    return {
      columns: query.select,
      rows: [
        { id: 1, name: 'Sample Data', value: 42 },
        { id: 2, name: 'More Data', value: 84 }
      ],
      total: 2,
      executionTime: 156
    };
  }

  // Data visualization helpers
  private static renderHTMLSection(section: any): string {
    switch (section.type) {
      case 'kpi':
        return this.renderHTMLKPIs(section.data);
      case 'table':
        return this.renderHTMLTable(section.data);
      case 'chart':
        return this.renderHTMLChart(section);
      default:
        return `<pre>${JSON.stringify(section.data, null, 2)}</pre>`;
    }
  }

  private static renderHTMLKPIs(data: any): string {
    if (!Array.isArray(data)) return '<p>No KPI data available</p>';
    
    return `
    <div class="kpi-grid">
        ${data.map(kpi => `
        <div class="kpi-card">
            <div class="kpi-value">${kpi.value}</div>
            <div class="kpi-label">${kpi.label}</div>
        </div>
        `).join('')}
    </div>`;
  }

  private static renderHTMLTable(data: any): string {
    if (!Array.isArray(data) || data.length === 0) {
      return '<p>No table data available</p>';
    }

    const headers = Object.keys(data[0]);
    
    return `
    <table>
        <thead>
            <tr>
                ${headers.map(header => `<th>${header}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
            ${data.map(row => `
            <tr>
                ${headers.map(header => `<td>${row[header]}</td>`).join('')}
            </tr>
            `).join('')}
        </tbody>
    </table>`;
  }

  private static renderHTMLChart(section: any): string {
    const chartId = `chart_${section.id}`;
    return `
    <div class="chart-placeholder">
        <canvas id="${chartId}" width="400" height="200"></canvas>
        <p>Chart: ${section.visualization?.chartType} visualization</p>
        <p>Data points: ${Array.isArray(section.data) ? section.data.length : 'N/A'}</p>
    </div>
    <script>
        // Chart.js implementation would go here
        console.log('Chart data for ${chartId}:', ${JSON.stringify(section.data)});
    </script>`;
  }

  // Query implementations
  private static async getExecutiveKPIs(filters: any): Promise<any[]> {
    const projects = await prisma.project.count();
    const activeProjects = await prisma.project.count({ where: { status: 'ACTIVE' } });
    const totalTasks = await prisma.task.count();
    const completedTasks = await prisma.task.count({ where: { status: 'DONE' } });
    const activeUsers = await prisma.user.count({ where: { isActive: true } });

    return [
      { label: 'Total Projects', value: projects, unit: '', trend: '+5%' },
      { label: 'Active Projects', value: activeProjects, unit: '', trend: '+2%' },
      { label: 'Completion Rate', value: Math.round((completedTasks / totalTasks) * 100), unit: '%', trend: '+3%' },
      { label: 'Active Users', value: activeUsers, unit: '', trend: '+8%' },
      { label: 'System Uptime', value: 99.9, unit: '%', trend: 'stable' }
    ];
  }

  private static async getProjectHealthMetrics(filters: any): Promise<any[]> {
    const projects = await prisma.project.findMany({
      include: {
        tasks: true,
        members: true
      }
    });

    return projects.map(project => {
      const completionRate = project.tasks.length > 0 
        ? (project.tasks.filter(t => t.status === 'DONE').length / project.tasks.length) * 100
        : 0;

      return {
        name: project.name,
        completion: Math.round(completionRate),
        teamSize: project.members.length,
        status: project.status,
        health: completionRate > 75 ? 'healthy' : completionRate > 50 ? 'warning' : 'critical'
      };
    });
  }

  private static async getSystemPerformanceData(filters: any): Promise<any> {
    const performance = await ObservabilityService.getSystemHealth();
    return performance;
  }

  private static async getErrorMetrics(filters: any): Promise<any[]> {
    // Sample error metrics - would be from actual monitoring data
    return Array.from({ length: 24 }, (_, i) => ({
      hour: new Date(Date.now() - (23 - i) * 60 * 60 * 1000),
      errorCount: Math.floor(Math.random() * 10),
      errorRate: Math.random() * 2,
      criticalErrors: Math.floor(Math.random() * 3)
    }));
  }

  private static async getUserEngagementData(filters: any): Promise<any[]> {
    const engagementData = await prisma.user.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        lastLogin: true,
        isActive: true,
        tasks: {
          where: {
            createdAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
            }
          }
        },
        comments: {
          where: {
            createdAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            }
          }
        }
      }
    });

    return engagementData.map(user => ({
      userId: user.id,
      name: `${user.firstName} ${user.lastName}`,
      lastLogin: user.lastLogin,
      isActive: user.isActive,
      tasksCreated: user.tasks.length,
      commentsPosted: user.comments.length,
      engagementScore: (user.tasks.length * 2) + (user.comments.length * 1)
    }));
  }

  private static async getFinancialOverview(filters: any): Promise<any> {
    // Mock financial data - would integrate with actual financial systems
    return {
      totalRevenue: 125000,
      operatingCosts: 78000,
      infrastructureCosts: 15000,
      teamCosts: 95000,
      profitMargin: 22.4,
      monthlyGrowth: 8.5,
      costBreakdown: [
        { category: 'Personnel', amount: 95000, percentage: 60.8 },
        { category: 'Infrastructure', amount: 15000, percentage: 9.6 },
        { category: 'Software Licenses', amount: 12000, percentage: 7.7 },
        { category: 'Marketing', amount: 18000, percentage: 11.5 },
        { category: 'Operations', amount: 16000, percentage: 10.3 }
      ]
    };
  }

  // Utility methods
  private static shouldGenerateReport(schedule: any): boolean {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const [scheduleHour, scheduleMinute] = schedule.time.split(':').map(Number);

    // Check if current time matches schedule time (within 5 minutes)
    if (Math.abs(hour - scheduleHour) === 0 && Math.abs(minute - scheduleMinute) <= 5) {
      const dayOfWeek = now.getDay();
      const dayOfMonth = now.getDate();

      switch (schedule.frequency) {
        case 'daily':
          return true;
        case 'weekly':
          return dayOfWeek === 1; // Monday
        case 'monthly':
          return dayOfMonth === 1; // First day of month
      }
    }

    return false;
  }

  private static async distributeReport(report: any, recipients: string[]): Promise<void> {
    // Email distribution logic would go here
    console.log(`📧 Distributing report ${report.reportId} to ${recipients.length} recipients`);
    
    // For demo purposes, just log the distribution
    recipients.forEach(recipient => {
      console.log(`  → ${recipient}`);
    });
  }

  private static async buildDashboardData(dashboardId: string, userId: string, filters: any): Promise<any> {
    // Build dynamic dashboard based on user permissions and preferences
    const widgets = [
      {
        id: 'overview_metrics',
        title: 'Overview Metrics',
        type: 'kpi',
        data: await this.getExecutiveKPIs(filters),
        refreshRate: 30000 // 30 seconds
      },
      {
        id: 'recent_activity',
        title: 'Recent Activity',
        type: 'timeline',
        data: await this.getRecentActivity(userId, filters),
        refreshRate: 10000 // 10 seconds
      },
      {
        id: 'performance_chart',
        title: 'System Performance',
        type: 'line_chart',
        data: await this.getPerformanceTimeSeries(filters),
        refreshRate: 60000 // 1 minute
      }
    ];

    return { widgets };
  }

  private static async getRecentActivity(userId: string, filters: any): Promise<any[]> {
    const activities = await prisma.auditLog.findMany({
      where: {
        userId,
        timestamp: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
        }
      },
      orderBy: { timestamp: 'desc' },
      take: 20
    });

    return activities.map(activity => ({
      id: activity.id,
      type: activity.eventType,
      timestamp: activity.timestamp,
      description: `${activity.eventType.replace('_', ' ').toLowerCase()}`,
      severity: activity.severity
    }));
  }

  private static async getPerformanceTimeSeries(filters: any): Promise<any[]> {
    // Mock time series data - would be from actual monitoring
    return Array.from({ length: 24 }, (_, i) => ({
      timestamp: new Date(Date.now() - (23 - i) * 60 * 60 * 1000),
      responseTime: Math.random() * 500 + 200,
      throughput: Math.floor(Math.random() * 100) + 50,
      errorRate: Math.random() * 2
    }));
  }

  // Excel helpers
  private static addExcelTable(worksheet: any, data: any): void {
    if (!Array.isArray(data) || data.length === 0) return;

    const headers = Object.keys(data[0]);
    worksheet.addRow(headers);

    data.forEach((row: any) => {
      worksheet.addRow(headers.map(header => row[header]));
    });

    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' }
    };
  }

  private static addExcelKPIs(worksheet: any, data: any): void {
    if (!Array.isArray(data)) return;

    worksheet.addRow(['Metric', 'Value', 'Unit', 'Trend']);
    
    data.forEach((kpi: any) => {
      worksheet.addRow([kpi.label, kpi.value, kpi.unit || '', kpi.trend || '']);
    });
  }

  // PDF helpers
  private static addKPISection(doc: any, data: any): void {
    if (!Array.isArray(data)) return;

    data.forEach((kpi, index) => {
      if (index > 0 && index % 2 === 0) doc.moveDown();
      
      const x = 50 + (index % 2) * 250;
      const y = doc.y;
      
      doc.rect(x, y, 200, 60).stroke();
      doc.fontSize(24).text(kpi.value.toString(), x + 10, y + 10);
      doc.fontSize(12).text(kpi.label, x + 10, y + 40);
    });
    
    doc.moveDown(4);
  }

  private static addTableSection(doc: any, data: any): void {
    if (!Array.isArray(data) || data.length === 0) return;

    const headers = Object.keys(data[0]);
    const startY = doc.y;
    
    // Headers
    headers.forEach((header, index) => {
      doc.text(header, 50 + index * 100, startY, { width: 90 });
    });
    
    doc.moveDown();
    
    // Data rows
    data.slice(0, 20).forEach((row: any) => { // Limit to 20 rows for PDF
      const rowY = doc.y;
      headers.forEach((header, index) => {
        doc.text(row[header]?.toString() || '', 50 + index * 100, rowY, { width: 90 });
      });
      doc.moveDown();
    });
  }

  private static convertToCSV(data: any): string {
    if (!Array.isArray(data) || data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const csvRows = [
      headers.join(','),
      ...data.map(row => 
        headers.map(header => `"${row[header]?.toString()?.replace(/"/g, '""') || ''}"`)
               .join(',')
      )
    ];

    return csvRows.join('\n');
  }
}

export default ReportingEngine;
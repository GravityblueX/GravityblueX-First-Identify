import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
export const errorRate = new Rate('errors');
export const responseTime = new Trend('response_time');
export const throughput = new Counter('requests_total');

// Test configuration
export const options = {
  stages: [
    // Warm-up
    { duration: '2m', target: 10 },
    // Load test
    { duration: '5m', target: 50 },
    // Stress test
    { duration: '3m', target: 100 },
    // Peak load
    { duration: '2m', target: 200 },
    // Cool down
    { duration: '3m', target: 0 }
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests under 2s
    http_req_failed: ['rate<0.05'],     // Error rate under 5%
    errors: ['rate<0.05'],
    response_time: ['p(95)<2000']
  },
  ext: {
    loadimpact: {
      distribution: {
        'amazon:us:ashburn': { loadZone: 'amazon:us:ashburn', percent: 50 },
        'amazon:ie:dublin': { loadZone: 'amazon:ie:dublin', percent: 25 },
        'amazon:sg:singapore': { loadZone: 'amazon:sg:singapore', percent: 25 }
      }
    }
  }
};

// Base configuration
const BASE_URL = __ENV.API_URL || 'https://staging-api.teamsync.com';
const API_TOKEN = __ENV.API_TOKEN || 'test-token';

// Test data
const TEST_USER = {
  email: `loadtest-${Math.random().toString(36).substr(2, 9)}@example.com`,
  password: 'LoadTest123!',
  firstName: 'Load',
  lastName: 'Test'
};

let authToken = '';
let projectId = '';
let taskIds = [];

// Setup function
export function setup() {
  console.log('🚀 Starting load test setup...');
  
  // Register test user
  const registerResponse = http.post(`${BASE_URL}/api/auth/register`, JSON.stringify(TEST_USER), {
    headers: { 'Content-Type': 'application/json' }
  });
  
  check(registerResponse, {
    'User registration successful': (r) => r.status === 201
  });

  // Login to get auth token
  const loginResponse = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: TEST_USER.email,
    password: TEST_USER.password
  }), {
    headers: { 'Content-Type': 'application/json' }
  });

  const loginData = JSON.parse(loginResponse.body);
  authToken = loginData.token;

  // Create test project
  const projectResponse = http.post(`${BASE_URL}/api/projects`, JSON.stringify({
    name: 'Load Test Project',
    description: 'Project for load testing purposes'
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    }
  });

  const projectData = JSON.parse(projectResponse.body);
  projectId = projectData.id;

  console.log(`✅ Setup complete - Project ID: ${projectId}`);
  
  return { authToken, projectId };
}

// Main test scenarios
export default function(data) {
  authToken = data.authToken;
  projectId = data.projectId;

  group('Authentication Flow', () => {
    testLogin();
    testTokenRefresh();
  });

  group('Project Management', () => {
    testProjectOperations();
    testProjectListing();
  });

  group('Task Management', () => {
    testTaskCreation();
    testTaskUpdates();
    testTaskSearch();
  });

  group('Real-time Features', () => {
    testWebSocketConnection();
    testNotifications();
  });

  group('Analytics and Reporting', () => {
    testAnalyticsDashboard();
    testDataExport();
  });

  group('File Operations', () => {
    testFileUpload();
    testFileDownload();
  });

  sleep(Math.random() * 2 + 1); // Random sleep between 1-3 seconds
}

// Test scenarios
function testLogin() {
  const response = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: TEST_USER.email,
    password: TEST_USER.password
  }), {
    headers: { 'Content-Type': 'application/json' }
  });

  const success = check(response, {
    'Login successful': (r) => r.status === 200,
    'Response time < 500ms': (r) => r.timings.duration < 500,
    'Has auth token': (r) => JSON.parse(r.body).token !== undefined
  });

  errorRate.add(!success);
  responseTime.add(response.timings.duration);
  throughput.add(1);
}

function testTokenRefresh() {
  const response = http.post(`${BASE_URL}/api/auth/refresh`, null, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  const success = check(response, {
    'Token refresh successful': (r) => r.status === 200,
    'Response time < 200ms': (r) => r.timings.duration < 200
  });

  errorRate.add(!success);
  responseTime.add(response.timings.duration);
  throughput.add(1);
}

function testProjectOperations() {
  // Get projects list
  const listResponse = http.get(`${BASE_URL}/api/projects`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  check(listResponse, {
    'Projects list loaded': (r) => r.status === 200,
    'Response time < 1s': (r) => r.timings.duration < 1000
  });

  // Get specific project
  const projectResponse = http.get(`${BASE_URL}/api/projects/${projectId}`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  const success = check(projectResponse, {
    'Project details loaded': (r) => r.status === 200,
    'Response time < 800ms': (r) => r.timings.duration < 800,
    'Project has tasks': (r) => JSON.parse(r.body).tasks !== undefined
  });

  errorRate.add(!success);
  responseTime.add(projectResponse.timings.duration);
  throughput.add(2);
}

function testProjectListing() {
  // Test pagination
  const paginatedResponse = http.get(`${BASE_URL}/api/projects?page=1&limit=10`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  const success = check(paginatedResponse, {
    'Pagination works': (r) => r.status === 200,
    'Has pagination info': (r) => JSON.parse(r.body).pagination !== undefined
  });

  errorRate.add(!success);
  responseTime.add(paginatedResponse.timings.duration);
  throughput.add(1);
}

function testTaskCreation() {
  const taskData = {
    title: `Load Test Task ${Math.random().toString(36).substr(2, 5)}`,
    description: 'Task created during load testing',
    projectId: projectId,
    priority: ['LOW', 'MEDIUM', 'HIGH'][Math.floor(Math.random() * 3)]
  };

  const response = http.post(`${BASE_URL}/api/tasks`, JSON.stringify(taskData), {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    }
  });

  const success = check(response, {
    'Task created successfully': (r) => r.status === 201,
    'Response time < 1s': (r) => r.timings.duration < 1000,
    'Task has ID': (r) => JSON.parse(r.body).id !== undefined
  });

  if (success) {
    const taskData = JSON.parse(response.body);
    taskIds.push(taskData.id);
  }

  errorRate.add(!success);
  responseTime.add(response.timings.duration);
  throughput.add(1);
}

function testTaskUpdates() {
  if (taskIds.length === 0) return;

  const randomTaskId = taskIds[Math.floor(Math.random() * taskIds.length)];
  const updateData = {
    status: ['TODO', 'IN_PROGRESS', 'DONE'][Math.floor(Math.random() * 3)]
  };

  const response = http.put(`${BASE_URL}/api/tasks/${randomTaskId}`, JSON.stringify(updateData), {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    }
  });

  const success = check(response, {
    'Task updated successfully': (r) => r.status === 200,
    'Response time < 500ms': (r) => r.timings.duration < 500
  });

  errorRate.add(!success);
  responseTime.add(response.timings.duration);
  throughput.add(1);
}

function testTaskSearch() {
  const searchResponse = http.post(`${BASE_URL}/api/search/global`, JSON.stringify({
    q: 'load test',
    type: 'tasks'
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    }
  });

  const success = check(searchResponse, {
    'Search completed': (r) => r.status === 200,
    'Response time < 1.5s': (r) => r.timings.duration < 1500,
    'Has search results': (r) => JSON.parse(r.body).tasks !== undefined
  });

  errorRate.add(!success);
  responseTime.add(searchResponse.timings.duration);
  throughput.add(1);
}

function testWebSocketConnection() {
  // Simulate WebSocket connection test via HTTP endpoint
  const wsTestResponse = http.get(`${BASE_URL}/api/realtime/test`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  const success = check(wsTestResponse, {
    'WebSocket test successful': (r) => r.status === 200
  });

  errorRate.add(!success);
  responseTime.add(wsTestResponse.timings.duration);
  throughput.add(1);
}

function testNotifications() {
  const notificationsResponse = http.get(`${BASE_URL}/api/notifications`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  const success = check(notificationsResponse, {
    'Notifications loaded': (r) => r.status === 200,
    'Response time < 300ms': (r) => r.timings.duration < 300
  });

  errorRate.add(!success);
  responseTime.add(notificationsResponse.timings.duration);
  throughput.add(1);
}

function testAnalyticsDashboard() {
  const analyticsResponse = http.get(`${BASE_URL}/api/analytics/dashboard/${projectId}`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  const success = check(analyticsResponse, {
    'Analytics loaded': (r) => r.status === 200,
    'Response time < 2s': (r) => r.timings.duration < 2000,
    'Has analytics data': (r) => JSON.parse(r.body).overview !== undefined
  });

  errorRate.add(!success);
  responseTime.add(analyticsResponse.timings.duration);
  throughput.add(1);
}

function testDataExport() {
  const exportResponse = http.get(`${BASE_URL}/api/analytics/export/${projectId}?format=json`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  const success = check(exportResponse, {
    'Data export successful': (r) => r.status === 200,
    'Response time < 3s': (r) => r.timings.duration < 3000
  });

  errorRate.add(!success);
  responseTime.add(exportResponse.timings.duration);
  throughput.add(1);
}

function testFileUpload() {
  // Simulate file upload with small test data
  const testFile = 'data:text/plain;base64,VGhpcyBpcyBhIHRlc3QgZmlsZSBmb3IgbG9hZCB0ZXN0aW5n';
  
  const uploadResponse = http.post(`${BASE_URL}/api/files/upload`, {
    file: http.file(testFile, 'load-test.txt', 'text/plain'),
    projectId: projectId
  }, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  const success = check(uploadResponse, {
    'File upload successful': (r) => r.status === 201,
    'Response time < 2s': (r) => r.timings.duration < 2000
  });

  errorRate.add(!success);
  responseTime.add(uploadResponse.timings.duration);
  throughput.add(1);
}

function testFileDownload() {
  const filesResponse = http.get(`${BASE_URL}/api/files/project/${projectId}`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  const success = check(filesResponse, {
    'Files list loaded': (r) => r.status === 200,
    'Response time < 800ms': (r) => r.timings.duration < 800
  });

  errorRate.add(!success);
  responseTime.add(filesResponse.timings.duration);
  throughput.add(1);
}

// Cleanup function
export function teardown(data) {
  console.log('🧹 Cleaning up load test data...');
  
  // Clean up created tasks
  if (taskIds.length > 0) {
    taskIds.forEach(taskId => {
      http.del(`${BASE_URL}/api/tasks/${taskId}`, null, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
    });
  }

  // Clean up project
  if (projectId) {
    http.del(`${BASE_URL}/api/projects/${projectId}`, null, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
  }

  console.log('✅ Load test cleanup completed');
}

// Scenario functions for specific testing
export function apiEndpointsTest() {
  const endpoints = [
    { method: 'GET', url: '/api/projects', weight: 40 },
    { method: 'GET', url: '/api/tasks', weight: 30 },
    { method: 'GET', url: '/api/notifications', weight: 20 },
    { method: 'GET', url: '/api/analytics/overview', weight: 10 }
  ];

  const randomEndpoint = weightedRandom(endpoints);
  
  const response = http.request(randomEndpoint.method, `${BASE_URL}${randomEndpoint.url}`, null, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });

  check(response, {
    [`${randomEndpoint.method} ${randomEndpoint.url} successful`]: (r) => r.status < 400
  });

  throughput.add(1);
}

export function databaseIntensiveTest() {
  group('Database Heavy Operations', () => {
    // Complex analytics query
    const analyticsResponse = http.get(`${BASE_URL}/api/analytics/detailed/${projectId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    check(analyticsResponse, {
      'Complex query successful': (r) => r.status === 200,
      'Query time < 3s': (r) => r.timings.duration < 3000
    });

    // Bulk operations
    const bulkTasks = Array.from({ length: 10 }, (_, i) => ({
      title: `Bulk Task ${i}`,
      projectId: projectId
    }));

    const bulkResponse = http.post(`${BASE_URL}/api/tasks/bulk`, JSON.stringify(bulkTasks), {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      }
    });

    check(bulkResponse, {
      'Bulk creation successful': (r) => r.status === 201,
      'Bulk operation < 5s': (r) => r.timings.duration < 5000
    });

    throughput.add(2);
  });
}

export function realtimeStressTest() {
  group('Real-time Stress Test', () => {
    // Rapid WebSocket message simulation
    for (let i = 0; i < 5; i++) {
      const messageResponse = http.post(`${BASE_URL}/api/chat/messages`, JSON.stringify({
        content: `Stress test message ${i}`,
        projectId: projectId
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });

      check(messageResponse, {
        'Message sent successfully': (r) => r.status === 201
      });

      sleep(0.1); // Small delay between messages
    }

    throughput.add(5);
  });
}

// Utility functions
function weightedRandom(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const item of items) {
    random -= item.weight;
    if (random <= 0) {
      return item;
    }
  }
  
  return items[0];
}

// Performance benchmarks
export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    duration: data.state.testRunDurationMs,
    iterations: data.metrics.iterations.values.count,
    requests: data.metrics.http_reqs.values.count,
    errorRate: data.metrics.http_req_failed.values.rate,
    avgResponseTime: data.metrics.http_req_duration.values.avg,
    p95ResponseTime: data.metrics.http_req_duration.values['p(95)'],
    p99ResponseTime: data.metrics.http_req_duration.values['p(99)'],
    throughputRPS: data.metrics.http_reqs.values.rate,
    dataReceived: data.metrics.data_received.values.count,
    dataSent: data.metrics.data_sent.values.count,
    
    // Custom metrics
    customErrorRate: data.metrics.errors?.values.rate || 0,
    customResponseTime: data.metrics.response_time?.values.avg || 0,
    
    // Performance score calculation
    performanceScore: calculatePerformanceScore(data)
  };

  // Generate HTML report
  const htmlReport = generateHTMLReport(summary);
  
  return {
    'performance-report.html': htmlReport,
    'performance-results.json': JSON.stringify(summary, null, 2),
    stdout: `
    🏁 Load Test Summary 🏁
    
    📊 Requests: ${summary.requests}
    ⚡ Throughput: ${summary.throughputRPS.toFixed(2)} req/s
    📈 Avg Response: ${summary.avgResponseTime.toFixed(2)}ms
    📉 95th Percentile: ${summary.p95ResponseTime.toFixed(2)}ms
    🚨 Error Rate: ${(summary.errorRate * 100).toFixed(2)}%
    🏆 Performance Score: ${summary.performanceScore}/100
    
    ${summary.performanceScore >= 80 ? '✅ PASSED' : '❌ FAILED'} - Performance benchmarks
    `
  };
}

function calculatePerformanceScore(data) {
  let score = 100;
  
  // Response time penalties
  const p95 = data.metrics.http_req_duration.values['p(95)'];
  if (p95 > 2000) score -= 30;      // > 2s
  else if (p95 > 1000) score -= 15;  // > 1s
  else if (p95 > 500) score -= 5;    // > 500ms

  // Error rate penalties
  const errorRate = data.metrics.http_req_failed.values.rate;
  if (errorRate > 0.05) score -= 40;      // > 5%
  else if (errorRate > 0.02) score -= 20; // > 2%
  else if (errorRate > 0.01) score -= 10; // > 1%

  // Throughput bonus
  const throughput = data.metrics.http_reqs.values.rate;
  if (throughput > 100) score += 10;
  else if (throughput > 50) score += 5;

  return Math.max(0, Math.min(100, score));
}

function generateHTMLReport(summary) {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>TeamSync Load Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .header { background: #2563eb; color: white; padding: 20px; border-radius: 8px; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .metric-card { background: #f8fafc; padding: 20px; border-radius: 8px; border-left: 4px solid #2563eb; }
        .metric-value { font-size: 2em; font-weight: bold; color: #2563eb; }
        .metric-label { color: #64748b; margin-top: 5px; }
        .status { padding: 10px; border-radius: 4px; text-align: center; font-weight: bold; }
        .passed { background: #dcfce7; color: #166534; }
        .failed { background: #fef2f2; color: #dc2626; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚀 TeamSync Load Test Report</h1>
        <p>Generated: ${summary.timestamp}</p>
        <p>Test Duration: ${(summary.duration / 1000 / 60).toFixed(2)} minutes</p>
    </div>
    
    <div class="status ${summary.performanceScore >= 80 ? 'passed' : 'failed'}">
        Performance Score: ${summary.performanceScore}/100 - ${summary.performanceScore >= 80 ? 'PASSED' : 'FAILED'}
    </div>
    
    <div class="metrics">
        <div class="metric-card">
            <div class="metric-value">${summary.requests}</div>
            <div class="metric-label">Total Requests</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">${summary.throughputRPS.toFixed(1)}</div>
            <div class="metric-label">Requests/Second</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">${summary.avgResponseTime.toFixed(0)}ms</div>
            <div class="metric-label">Avg Response Time</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">${summary.p95ResponseTime.toFixed(0)}ms</div>
            <div class="metric-label">95th Percentile</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">${(summary.errorRate * 100).toFixed(2)}%</div>
            <div class="metric-label">Error Rate</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">${(summary.dataReceived / 1024 / 1024).toFixed(2)}MB</div>
            <div class="metric-label">Data Received</div>
        </div>
    </div>
</body>
</html>`;
}
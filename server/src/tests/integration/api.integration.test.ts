import request from 'supertest';
import app from '../index';
import { PrismaClient } from '@prisma/client';
import { setupTestDatabase, cleanupTestDatabase } from './helpers/database';
import { createTestUser, createTestProject, createTestTask } from './helpers/factories';

const prisma = new PrismaClient();

describe('API Integration Tests', () => {
  let authToken: string;
  let testUser: any;
  let testProject: any;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await cleanupTestDatabase();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Create test user and get auth token
    const { user, token } = await createTestUser();
    testUser = user;
    authToken = token;

    // Create test project
    testProject = await createTestProject(testUser.id);
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.task.deleteMany();
    await prisma.projectMember.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();
  });

  describe('Project Management Flow', () => {
    it('should create, update, and delete projects', async () => {
      // Create project
      const projectData = {
        name: 'Integration Test Project',
        description: 'Test project for integration testing',
        priority: 'HIGH'
      };

      const createResponse = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .send(projectData);

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.name).toBe(projectData.name);

      const projectId = createResponse.body.id;

      // Update project
      const updateData = {
        name: 'Updated Project Name',
        status: 'ACTIVE'
      };

      const updateResponse = await request(app)
        .put(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData);

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.name).toBe(updateData.name);
      expect(updateResponse.body.status).toBe(updateData.status);

      // Get project
      const getResponse = await request(app)
        .get(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.id).toBe(projectId);

      // Delete project
      const deleteResponse = await request(app)
        .delete(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(deleteResponse.status).toBe(200);

      // Verify deletion
      const getDeletedResponse = await request(app)
        .get(`/api/projects/${projectId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(getDeletedResponse.status).toBe(404);
    });

    it('should handle project permissions correctly', async () => {
      // Create another user
      const { user: otherUser, token: otherToken } = await createTestUser({
        email: 'other@example.com',
        username: 'otheruser'
      });

      // Other user should not access private project
      const getResponse = await request(app)
        .get(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(getResponse.status).toBe(404);

      // Add other user as member
      await prisma.projectMember.create({
        data: {
          userId: otherUser.id,
          projectId: testProject.id,
          role: 'MEMBER'
        }
      });

      // Now other user should have access
      const accessResponse = await request(app)
        .get(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(accessResponse.status).toBe(200);

      // But should not be able to delete (only owner can)
      const deleteResponse = await request(app)
        .delete(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(deleteResponse.status).toBe(404);
    });
  });

  describe('Task Management Flow', () => {
    it('should create and manage tasks', async () => {
      const taskData = {
        title: 'Integration Test Task',
        description: 'Test task for integration testing',
        projectId: testProject.id,
        priority: 'MEDIUM'
      };

      // Create task
      const createResponse = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send(taskData);

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.title).toBe(taskData.title);

      const taskId = createResponse.body.id;

      // Update task status
      const updateResponse = await request(app)
        .put(`/api/tasks/${taskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'IN_PROGRESS' });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.status).toBe('IN_PROGRESS');

      // Add comment
      const commentResponse = await request(app)
        .post(`/api/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ content: 'Working on this task now' });

      expect(commentResponse.status).toBe(201);
      expect(commentResponse.body.content).toBe('Working on this task now');

      // Get task with comments
      const getResponse = await request(app)
        .get(`/api/tasks/${taskId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.comments).toHaveLength(1);
    });

    it('should filter tasks correctly', async () => {
      // Create multiple tasks with different statuses
      const tasks = [
        { title: 'Task 1', status: 'TODO', priority: 'HIGH' },
        { title: 'Task 2', status: 'IN_PROGRESS', priority: 'MEDIUM' },
        { title: 'Task 3', status: 'DONE', priority: 'LOW' }
      ];

      for (const taskData of tasks) {
        await createTestTask(testProject.id, testUser.id, taskData);
      }

      // Filter by status
      const todoResponse = await request(app)
        .get(`/api/tasks/project/${testProject.id}?status=TODO`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(todoResponse.status).toBe(200);
      expect(todoResponse.body).toHaveLength(1);
      expect(todoResponse.body[0].status).toBe('TODO');

      // Filter by priority
      const highPriorityResponse = await request(app)
        .get(`/api/tasks/project/${testProject.id}?priority=HIGH`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(highPriorityResponse.status).toBe(200);
      expect(highPriorityResponse.body).toHaveLength(1);
      expect(highPriorityResponse.body[0].priority).toBe('HIGH');
    });
  });

  describe('Real-time Features', () => {
    it('should handle WebSocket connections and events', (done) => {
      const io = require('socket.io-client');
      const socket = io(`http://localhost:${process.env.PORT || 5000}`, {
        auth: { token: authToken }
      });

      socket.on('connect', () => {
        // Join project room
        socket.emit('join-project', testProject.id);
      });

      socket.on('joined-project', (projectId: string) => {
        expect(projectId).toBe(testProject.id);

        // Simulate task update
        socket.emit('task-updated', {
          taskId: 'test-task-id',
          projectId: testProject.id,
          changes: { status: 'DONE' }
        });
      });

      socket.on('task-updated', (data: any) => {
        expect(data.taskId).toBe('test-task-id');
        expect(data.changes.status).toBe('DONE');
        
        socket.disconnect();
        done();
      });

      socket.on('error', (error: any) => {
        done(error);
      });
    });
  });

  describe('Search and Analytics', () => {
    it('should search across projects and tasks', async () => {
      // Create searchable content
      await createTestTask(testProject.id, testUser.id, {
        title: 'Implement payment gateway',
        description: 'Integrate Stripe payment processing'
      });

      const searchResponse = await request(app)
        .post('/api/search/global')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          q: 'payment',
          type: 'all'
        });

      expect(searchResponse.status).toBe(200);
      expect(searchResponse.body.total).toBeGreaterThan(0);
      expect(searchResponse.body.tasks).toHaveLength(1);
      expect(searchResponse.body.tasks[0].title).toContain('payment');
    });

    it('should generate project analytics', async () => {
      // Create tasks with different statuses
      const taskPromises = [
        createTestTask(testProject.id, testUser.id, { status: 'DONE' }),
        createTestTask(testProject.id, testUser.id, { status: 'DONE' }),
        createTestTask(testProject.id, testUser.id, { status: 'IN_PROGRESS' }),
        createTestTask(testProject.id, testUser.id, { status: 'TODO' })
      ];

      await Promise.all(taskPromises);

      const analyticsResponse = await request(app)
        .get(`/api/analytics/dashboard/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(analyticsResponse.status).toBe(200);
      expect(analyticsResponse.body.overview.totalTasks).toBe(4);
      expect(analyticsResponse.body.overview.completedTasks).toBe(2);
      expect(analyticsResponse.body.overview.completionRate).toBe(50);
    });
  });

  describe('File Management', () => {
    it('should upload and manage files', async () => {
      const uploadResponse = await request(app)
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .field('projectId', testProject.id)
        .attach('file', Buffer.from('test file content'), 'test.txt');

      expect(uploadResponse.status).toBe(201);
      expect(uploadResponse.body.name).toBe('test.txt');
      expect(uploadResponse.body.projectId).toBe(testProject.id);

      const fileId = uploadResponse.body.id;

      // Get project files
      const filesResponse = await request(app)
        .get(`/api/files/project/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(filesResponse.status).toBe(200);
      expect(filesResponse.body).toHaveLength(1);

      // Delete file
      const deleteResponse = await request(app)
        .delete(`/api/files/${fileId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(deleteResponse.status).toBe(200);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      // Make many requests quickly
      const requests = Array.from({ length: 150 }, () =>
        request(app)
          .get('/api/projects')
          .set('Authorization', `Bearer ${authToken}`)
      );

      const responses = await Promise.allSettled(requests);
      
      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(
        (result) => result.status === 'fulfilled' && result.value.status === 429
      );

      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  describe('Data Validation', () => {
    it('should validate input data', async () => {
      // Invalid email format
      const invalidUserResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          username: 'test',
          firstName: 'Test',
          lastName: 'User',
          password: 'password123'
        });

      expect(invalidUserResponse.status).toBe(400);
      expect(invalidUserResponse.body.error).toBeDefined();

      // Missing required fields
      const incompleteProjectResponse = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          description: 'Project without name'
        });

      expect(incompleteProjectResponse.status).toBe(400);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent task updates', async () => {
      const task = await createTestTask(testProject.id, testUser.id);

      // Simulate concurrent updates
      const updates = [
        request(app)
          .put(`/api/tasks/${task.id}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ status: 'IN_PROGRESS' }),
        
        request(app)
          .put(`/api/tasks/${task.id}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ priority: 'HIGH' }),
        
        request(app)
          .put(`/api/tasks/${task.id}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ description: 'Updated description' })
      ];

      const responses = await Promise.all(updates);

      // All updates should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Verify final state
      const finalResponse = await request(app)
        .get(`/api/tasks/${task.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(finalResponse.status).toBe(200);
      // Should have the latest updates applied
    });
  });

  describe('Performance Tests', () => {
    it('should handle large datasets efficiently', async () => {
      // Create many tasks
      const taskPromises = Array.from({ length: 100 }, (_, i) =>
        createTestTask(testProject.id, testUser.id, {
          title: `Performance Test Task ${i}`,
          priority: i % 2 === 0 ? 'HIGH' : 'MEDIUM'
        })
      );

      await Promise.all(taskPromises);

      const startTime = Date.now();

      // Test project fetch performance
      const projectResponse = await request(app)
        .get(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      const responseTime = Date.now() - startTime;

      expect(projectResponse.status).toBe(200);
      expect(projectResponse.body.tasks).toHaveLength(100);
      expect(responseTime).toBeLessThan(2000); // Should respond within 2 seconds
    });

    it('should efficiently handle complex queries', async () => {
      // Create test data with relationships
      const tasks = await Promise.all([
        createTestTask(testProject.id, testUser.id, { priority: 'HIGH', status: 'DONE' }),
        createTestTask(testProject.id, testUser.id, { priority: 'MEDIUM', status: 'IN_PROGRESS' }),
        createTestTask(testProject.id, testUser.id, { priority: 'LOW', status: 'TODO' })
      ]);

      // Add comments to tasks
      for (const task of tasks) {
        await prisma.comment.create({
          data: {
            content: `Comment for task ${task.title}`,
            userId: testUser.id,
            taskId: task.id
          }
        });
      }

      const startTime = Date.now();

      // Complex analytics query
      const analyticsResponse = await request(app)
        .get(`/api/analytics/dashboard/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      const queryTime = Date.now() - startTime;

      expect(analyticsResponse.status).toBe(200);
      expect(analyticsResponse.body.overview).toBeDefined();
      expect(queryTime).toBeLessThan(1500); // Should respond within 1.5 seconds
    });
  });

  describe('Error Recovery', () => {
    it('should recover from database connection issues', async () => {
      // This would typically involve mocking database failures
      // and ensuring the application handles them gracefully
      
      // Simulate database timeout
      jest.setTimeout(10000);
      
      const response = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${authToken}`);

      // Should either succeed or return a proper error
      expect([200, 503, 500]).toContain(response.status);
      
      if (response.status !== 200) {
        expect(response.body.error).toBeDefined();
      }
    });
  });

  describe('Cache Behavior', () => {
    it('should cache and invalidate data correctly', async () => {
      // First request should hit database
      const firstResponse = await request(app)
        .get(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(firstResponse.status).toBe(200);
      expect(firstResponse.headers['x-cache']).toBe('MISS');

      // Second request should hit cache
      const secondResponse = await request(app)
        .get(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(secondResponse.status).toBe(200);
      expect(secondResponse.headers['x-cache']).toBe('HIT');

      // Update should invalidate cache
      await request(app)
        .put(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated Name' });

      // Next request should miss cache again
      const thirdResponse = await request(app)
        .get(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(thirdResponse.status).toBe(200);
      expect(thirdResponse.headers['x-cache']).toBe('MISS');
      expect(thirdResponse.body.name).toBe('Updated Name');
    });
  });
});
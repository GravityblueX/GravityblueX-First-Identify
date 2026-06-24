import request from 'supertest';
import express from 'express';
import bcrypt from 'bcryptjs';

const mockUserDelegate = {
  findFirst: jest.fn(),
  findUnique: jest.fn(),
  create: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => ({
    user: mockUserDelegate,
  })),
}));

const authRoutes = require('../routes/auth').default;

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

const baseUser = {
  id: 'user-1',
  email: 'test@example.com',
  username: 'testuser',
  firstName: 'Test',
  lastName: 'User',
  role: 'MEMBER',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('Auth Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/auth/register', () => {
    it('registers a new user successfully', async () => {
      mockUserDelegate.findFirst.mockResolvedValue(null);
      mockUserDelegate.create.mockResolvedValue(baseUser);

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          username: 'testuser',
          firstName: 'Test',
          lastName: 'User',
          password: 'password123',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('token');
      expect(response.body.user.email).toBe('test@example.com');
      expect(response.body.user).not.toHaveProperty('password');
      expect(mockUserDelegate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'test@example.com',
            password: expect.any(String),
          }),
        })
      );
    });

    it('returns 400 for invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          username: 'testuser',
          firstName: 'Test',
          lastName: 'User',
          password: 'password123',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(mockUserDelegate.create).not.toHaveBeenCalled();
    });

    it('returns 400 for duplicate email or username', async () => {
      mockUserDelegate.findFirst.mockResolvedValue(baseUser);

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          username: 'testuser2',
          firstName: 'Test',
          lastName: 'User',
          password: 'password123',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('User already exists');
    });
  });

  describe('POST /api/auth/login', () => {
    it('logs in with correct credentials', async () => {
      const password = await bcrypt.hash('password123', 12);
      mockUserDelegate.findUnique.mockResolvedValue({
        ...baseUser,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        avatar: null,
        password,
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('token');
      expect(response.body.user.email).toBe('test@example.com');
      expect(response.body.user).not.toHaveProperty('password');
    });

    it('returns 401 for invalid credentials', async () => {
      const password = await bcrypt.hash('password123', 12);
      mockUserDelegate.findUnique.mockResolvedValue({
        ...baseUser,
        password,
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid credentials');
    });

    it('returns 401 for a missing user', async () => {
      mockUserDelegate.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'missing@example.com',
          password: 'password123',
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid credentials');
    });
  });
});

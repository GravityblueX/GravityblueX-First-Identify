import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { AuthRequest } from '../middleware/auth';

const mockUserDelegate = {
  findUnique: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => ({
    user: mockUserDelegate,
  })),
}));

const { authenticateToken } = require('../middleware/auth');

const app = express();
app.get('/protected', authenticateToken, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

const user = {
  id: 'user-1',
  email: 'owner@example.com',
  username: 'owner',
  role: 'MEMBER',
};

describe('Authentication middleware contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects requests without bearer tokens', async () => {
    const response = await request(app).get('/protected').expect(401);

    expect(response.body.error).toBe('Access token required');
    expect(mockUserDelegate.findUnique).not.toHaveBeenCalled();
  });

  it('rejects invalid bearer tokens', async () => {
    const response = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer not-a-token')
      .expect(403);

    expect(response.body.error).toBe('Invalid or expired token');
    expect(mockUserDelegate.findUnique).not.toHaveBeenCalled();
  });

  it('rejects tokens whose user no longer exists', async () => {
    mockUserDelegate.findUnique.mockResolvedValue(null);
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'test-secret');

    const response = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    expect(response.body.error).toBe('User not found');
    expect(mockUserDelegate.findUnique).toHaveBeenCalledWith({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
      },
    });
  });

  it('attaches the authenticated user to protected requests', async () => {
    mockUserDelegate.findUnique.mockResolvedValue(user);
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'test-secret');

    const response = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.user).toEqual(user);
  });
});

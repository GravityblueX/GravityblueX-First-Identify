import express from 'express';
import request from 'supertest';

const mockProjectDelegate = {
  findMany: jest.fn(),
  findFirst: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => ({
    project: mockProjectDelegate,
  })),
}));

const projectRoutes = require('../routes/projects').default;

const user = {
  id: 'user-1',
  email: 'owner@example.com',
  username: 'owner',
  role: 'MEMBER',
};

const baseProject = {
  id: 'project-1',
  name: 'Reference-grounded workspace',
  description: 'A project with boring, testable contracts.',
  priority: 'HIGH',
  ownerId: user.id,
  owner: {
    id: user.id,
    username: user.username,
    firstName: 'Owner',
    lastName: 'User',
    avatar: null,
  },
  members: [],
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as typeof req & { user: typeof user }).user = user;
  next();
});
app.use('/api/projects', projectRoutes);

describe('Project route contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists only projects owned by or shared with the current user', async () => {
    mockProjectDelegate.findMany.mockResolvedValue([baseProject]);

    const response = await request(app).get('/api/projects').expect(200);

    expect(response.body).toHaveLength(1);
    expect(mockProjectDelegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { ownerId: user.id },
            { members: { some: { userId: user.id } } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
      })
    );
  });

  it('creates projects with the requester as owner and OWNER member', async () => {
    mockProjectDelegate.create.mockResolvedValue(baseProject);

    const response = await request(app)
      .post('/api/projects')
      .send({
        name: 'Reference-grounded workspace',
        description: 'A project with boring, testable contracts.',
        priority: 'HIGH',
      })
      .expect(201);

    expect(response.body.id).toBe(baseProject.id);
    expect(mockProjectDelegate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Reference-grounded workspace',
          priority: 'HIGH',
          owner: { connect: { id: user.id } },
          members: {
            create: {
              user: { connect: { id: user.id } },
              role: 'OWNER',
            },
          },
        }),
      })
    );
  });

  it('rejects incomplete project creation before touching persistence', async () => {
    const response = await request(app)
      .post('/api/projects')
      .send({ description: 'missing a name' })
      .expect(400);

    expect(response.body).toHaveProperty('error');
    expect(mockProjectDelegate.create).not.toHaveBeenCalled();
  });

  it('requires owner access before deleting a project', async () => {
    mockProjectDelegate.findFirst.mockResolvedValue(null);

    const response = await request(app).delete('/api/projects/project-1').expect(404);

    expect(response.body.error).toContain('insufficient permissions');
    expect(mockProjectDelegate.delete).not.toHaveBeenCalled();
    expect(mockProjectDelegate.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'project-1',
        ownerId: user.id,
      },
    });
  });
});

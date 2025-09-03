# TeamSync API Documentation

## 🔗 Base URL
```
Development: http://localhost:5000/api
Production: https://api.teamsync.com/api
```

## 🔐 Authentication

All API endpoints (except auth routes) require a Bearer token in the Authorization header:

```http
Authorization: Bearer <your-jwt-token>
```

### POST /auth/register
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "username": "johndoe",
  "firstName": "John",
  "lastName": "Doe",
  "password": "securepassword123"
}
```

**Response:**
```json
{
  "message": "User created successfully",
  "user": {
    "id": "clx123abc",
    "email": "user@example.com",
    "username": "johndoe",
    "firstName": "John",
    "lastName": "Doe",
    "role": "MEMBER",
    "createdAt": "2025-01-15T10:30:00Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### POST /auth/login
Authenticate user and get access token.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

## 📁 Projects API

### GET /projects
Get all projects accessible to the current user.

**Response:**
```json
[
  {
    "id": "clx123abc",
    "name": "Website Redesign",
    "description": "Complete redesign of company website",
    "status": "ACTIVE",
    "priority": "HIGH",
    "startDate": "2025-01-01T00:00:00Z",
    "endDate": "2025-03-01T00:00:00Z",
    "owner": {
      "id": "clx456def",
      "username": "projectowner",
      "firstName": "Jane",
      "lastName": "Smith"
    },
    "members": [...],
    "_count": {
      "tasks": 25,
      "members": 5
    }
  }
]
```

### POST /projects
Create a new project.

**Request Body:**
```json
{
  "name": "New Project",
  "description": "Project description",
  "priority": "MEDIUM",
  "startDate": "2025-02-01T00:00:00Z",
  "endDate": "2025-04-01T00:00:00Z"
}
```

### GET /projects/:id
Get detailed project information.

### PUT /projects/:id
Update project information.

### DELETE /projects/:id
Delete a project (owner only).

## ✅ Tasks API

### GET /tasks/project/:projectId
Get all tasks for a specific project.

**Query Parameters:**
- `status` (optional): Filter by task status
- `assigneeId` (optional): Filter by assignee

**Response:**
```json
[
  {
    "id": "clx789ghi",
    "title": "Implement user authentication",
    "description": "Add JWT-based authentication system",
    "status": "IN_PROGRESS",
    "priority": "HIGH",
    "dueDate": "2025-02-15T00:00:00Z",
    "assignee": {
      "id": "clx456def",
      "username": "developer",
      "firstName": "John",
      "lastName": "Developer"
    },
    "creator": {...},
    "_count": {
      "comments": 3
    }
  }
]
```

### POST /tasks
Create a new task.

**Request Body:**
```json
{
  "title": "Task title",
  "description": "Task description",
  "projectId": "clx123abc",
  "assigneeId": "clx456def",
  "priority": "MEDIUM",
  "dueDate": "2025-02-20T00:00:00Z"
}
```

### PUT /tasks/:id
Update task information.

### DELETE /tasks/:id
Delete a task.

### POST /tasks/:id/comments
Add a comment to a task.

**Request Body:**
```json
{
  "content": "This is a comment on the task"
}
```

## 👥 Users API

### GET /users/me
Get current user profile.

### PUT /users/me
Update user profile.

### GET /users/search
Search for users.

**Query Parameters:**
- `q`: Search query string

### GET /users/notifications
Get user notifications.

### PUT /users/notifications/:id/read
Mark notification as read.

## 💬 Chat API

### GET /chats/project/:projectId
Get or create project chat room.

### POST /chats/:id/messages
Send a message to a chat.

**Request Body:**
```json
{
  "content": "Hello team!",
  "type": "TEXT"
}
```

### GET /chats/:id/messages
Get chat message history.

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Messages per page (default: 50)

## 📊 Analytics API

### GET /analytics/dashboard/:projectId
Get project analytics dashboard data.

**Query Parameters:**
- `timeRange`: Number of days (default: 30)

**Response:**
```json
{
  "overview": {
    "totalTasks": 50,
    "completedTasks": 30,
    "inProgressTasks": 15,
    "pendingTasks": 5,
    "completionRate": 60
  },
  "tasksByStatus": {
    "TODO": 5,
    "IN_PROGRESS": 15,
    "IN_REVIEW": 0,
    "DONE": 30
  },
  "tasksByPriority": {
    "LOW": 10,
    "MEDIUM": 25,
    "HIGH": 12,
    "URGENT": 3
  },
  "memberProductivity": [...],
  "progressData": [...],
  "recentActivity": [...]
}
```

### GET /analytics/team-performance
Get team performance metrics.

### GET /analytics/project-insights/:projectId
Get AI-powered project insights and recommendations.

## 🔍 Search API

### POST /search/global
Perform global search across projects, tasks, and users.

**Request Body:**
```json
{
  "q": "search query",
  "type": "all",
  "projectId": "clx123abc",
  "filters": {
    "status": "IN_PROGRESS",
    "priority": "HIGH",
    "assigneeId": "clx456def",
    "dateRange": {
      "start": "2025-01-01T00:00:00Z",
      "end": "2025-02-01T00:00:00Z"
    }
  }
}
```

### GET /search/suggestions
Get search suggestions based on query.

## 📎 Files API

### POST /files/upload
Upload a file to a project or task.

**Form Data:**
- `file`: File to upload
- `projectId`: Project ID (optional)
- `taskId`: Task ID (optional)

### GET /files/project/:projectId
Get all files for a project.

### GET /files/task/:taskId
Get all files for a task.

### DELETE /files/:id
Delete a file.

## 🔒 Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Error message",
  "details": "Additional error details (optional)"
}
```

### HTTP Status Codes
- `200`: Success
- `201`: Created
- `400`: Bad Request
- `401`: Unauthorized
- `403`: Forbidden
- `404`: Not Found
- `429`: Too Many Requests
- `500`: Internal Server Error

## 🚀 Rate Limiting

- **Authentication routes**: 5 requests per 15 minutes per IP
- **General routes**: 100 requests per 15 minutes per IP  
- **File uploads**: 20 uploads per hour per IP

## 📡 WebSocket Events

### Client to Server Events

```javascript
// Join project room for real-time updates
socket.emit('join-project', projectId);

// Join chat room
socket.emit('join-chat', chatId);

// Send message
socket.emit('send-message', {
  chatId: 'chat123',
  content: 'Hello!',
  type: 'TEXT'
});

// Notify task update
socket.emit('task-updated', {
  taskId: 'task123',
  projectId: 'project123',
  changes: { status: 'DONE' }
});

// Typing indicators
socket.emit('typing-start', { chatId: 'chat123' });
socket.emit('typing-stop', { chatId: 'chat123' });
```

### Server to Client Events

```javascript
// New message received
socket.on('new-message', (message) => {
  console.log('New message:', message);
});

// Task updated
socket.on('task-updated', (data) => {
  console.log('Task updated:', data);
});

// User typing
socket.on('user-typing', (data) => {
  console.log('User typing:', data.userId);
});

// New notification
socket.on('new-notification', (notification) => {
  console.log('New notification:', notification);
});
```

## 🛡️ Security Features

- **JWT Authentication**: Secure token-based authentication
- **Rate Limiting**: Prevents API abuse
- **Input Validation**: Zod schema validation
- **SQL Injection Prevention**: Parameterized queries with Prisma
- **XSS Protection**: Input sanitization
- **CORS Configuration**: Controlled cross-origin requests
- **File Upload Security**: Type and size restrictions
- **Password Encryption**: bcrypt hashing

## 📝 Examples

### Creating a Complete Workflow

```javascript
// 1. Create a project
const project = await fetch('/api/projects', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Mobile App Development',
    description: 'Build iOS and Android app',
    priority: 'HIGH'
  })
});

// 2. Create tasks
const task = await fetch('/api/tasks', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    title: 'Design UI mockups',
    projectId: project.id,
    priority: 'HIGH',
    dueDate: '2025-02-10T00:00:00Z'
  })
});

// 3. Join project chat
socket.emit('join-project', project.id);

// 4. Send team message
socket.emit('send-message', {
  chatId: projectChatId,
  content: 'Project kickoff meeting tomorrow!',
  type: 'TEXT'
});
```
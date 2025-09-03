export interface User {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  avatar?: string;
  role: 'ADMIN' | 'MEMBER';
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  startDate?: string;
  endDate?: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  owner: User;
  members: ProjectMember[];
  tasks?: Task[];
  _count?: {
    tasks: number;
    members: number;
  };
}

export interface ProjectMember {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  joinedAt: string;
  userId: string;
  projectId: string;
  user: User;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  projectId: string;
  assigneeId?: string;
  creatorId: string;
  assignee?: User;
  creator: User;
  comments?: Comment[];
  _count?: {
    comments: number;
  };
}

export interface Comment {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  taskId: string;
  user: User;
}

export interface Chat {
  id: string;
  name?: string;
  type: 'PROJECT' | 'DIRECT' | 'GROUP';
  createdAt: string;
  projectId?: string;
  members: ChatMember[];
  messages: Message[];
}

export interface ChatMember {
  id: string;
  joinedAt: string;
  userId: string;
  chatId: string;
  user: User;
}

export interface Message {
  id: string;
  content: string;
  type: 'TEXT' | 'FILE' | 'IMAGE' | 'SYSTEM';
  createdAt: string;
  senderId: string;
  chatId: string;
  sender: User;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'TASK_ASSIGNED' | 'TASK_UPDATED' | 'PROJECT_UPDATED' | 'MESSAGE_RECEIVED' | 'MENTION';
  read: boolean;
  createdAt: string;
  userId: string;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface ApiError {
  error: string;
  details?: any;
}
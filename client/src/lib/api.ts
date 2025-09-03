import { Project, Task, User, Chat, Message, Comment } from '../types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

class ApiClient {
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = localStorage.getItem('token');
    
    const config: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
      ...options,
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint);
  }

  post<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  put<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'DELETE',
    });
  }
}

const apiClient = new ApiClient();

export const authApi = {
  login: (data: { email: string; password: string }) =>
    apiClient.post<{ user: User; token: string; message: string }>('/api/auth/login', data),
  
  register: (data: {
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    password: string;
  }) =>
    apiClient.post<{ user: User; token: string; message: string }>('/api/auth/register', data),
  
  refresh: (token: string) =>
    apiClient.post<{ user: User; token: string }>('/api/auth/refresh', { token }),
};

export const projectApi = {
  getAll: () => apiClient.get<Project[]>('/api/projects'),
  
  getById: (id: string) => apiClient.get<Project>(`/api/projects/${id}`),
  
  create: (data: {
    name: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  }) => apiClient.post<Project>('/api/projects', data),
  
  update: (id: string, data: Partial<Project>) =>
    apiClient.put<Project>(`/api/projects/${id}`, data),
  
  delete: (id: string) => apiClient.delete(`/api/projects/${id}`),
};

export const taskApi = {
  getByProject: (projectId: string, filters?: {
    status?: string;
    assigneeId?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.assigneeId) params.append('assigneeId', filters.assigneeId);
    
    return apiClient.get<Task[]>(`/api/tasks/project/${projectId}?${params.toString()}`);
  },
  
  getById: (id: string) => apiClient.get<Task>(`/api/tasks/${id}`),
  
  create: (data: {
    title: string;
    description?: string;
    projectId: string;
    assigneeId?: string;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    dueDate?: string;
  }) => apiClient.post<Task>('/api/tasks', data),
  
  update: (id: string, data: Partial<Task>) =>
    apiClient.put<Task>(`/api/tasks/${id}`, data),
  
  delete: (id: string) => apiClient.delete(`/api/tasks/${id}`),
  
  addComment: (taskId: string, content: string) =>
    apiClient.post<Comment>(`/api/tasks/${taskId}/comments`, { content }),
};

export const userApi = {
  getProfile: () => apiClient.get<User>('/api/users/me'),
  
  updateProfile: (data: {
    firstName?: string;
    lastName?: string;
    avatar?: string;
  }) => apiClient.put<User>('/api/users/me', data),
  
  search: (query: string) => apiClient.get<User[]>(`/api/users/search?q=${encodeURIComponent(query)}`),
  
  getNotifications: () => apiClient.get<Notification[]>('/api/users/notifications'),
  
  markNotificationRead: (id: string) =>
    apiClient.put(`/api/users/notifications/${id}/read`),
  
  markAllNotificationsRead: () =>
    apiClient.put('/api/users/notifications/read-all'),
};

export const chatApi = {
  getProjectChat: (projectId: string) =>
    apiClient.get<Chat>(`/api/chats/project/${projectId}`),
  
  getMessages: (chatId: string, page = 1, limit = 50) =>
    apiClient.get<Message[]>(`/api/chats/${chatId}/messages?page=${page}&limit=${limit}`),
  
  sendMessage: (chatId: string, data: {
    content: string;
    type?: 'TEXT' | 'FILE' | 'IMAGE';
  }) => apiClient.post<Message>(`/api/chats/${chatId}/messages`, data),
};
'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { Message, Task } from '../types';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  joinProject: (projectId: string) => void;
  leaveProject: (projectId: string) => void;
  joinChat: (chatId: string) => void;
  sendMessage: (chatId: string, content: string) => void;
  onNewMessage: (callback: (message: Message) => void) => void;
  onTaskUpdated: (callback: (data: { taskId: string; task: Task; changes: Partial<Task> }) => void) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      const token = localStorage.getItem('token');
      if (!token) return;

      const socketInstance = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5000', {
        auth: { token }
      });

      socketInstance.on('connect', () => {
        console.log('Connected to server');
        setIsConnected(true);
        socketInstance.emit('user-online');
      });

      socketInstance.on('disconnect', () => {
        console.log('Disconnected from server');
        setIsConnected(false);
      });

      socketInstance.on('error', (error: string) => {
        console.error('Socket error:', error);
      });

      setSocket(socketInstance);

      return () => {
        socketInstance.disconnect();
        setSocket(null);
        setIsConnected(false);
      };
    }
  }, [user]);

  const joinProject = (projectId: string) => {
    socket?.emit('join-project', projectId);
  };

  const leaveProject = (projectId: string) => {
    socket?.emit('leave-project', projectId);
  };

  const joinChat = (chatId: string) => {
    socket?.emit('join-chat', chatId);
  };

  const sendMessage = (chatId: string, content: string) => {
    socket?.emit('send-message', { chatId, content, type: 'TEXT' });
  };

  const onNewMessage = (callback: (message: Message) => void) => {
    socket?.on('new-message', callback);
    return () => socket?.off('new-message', callback);
  };

  const onTaskUpdated = (callback: (data: { taskId: string; task: Task; changes: Partial<Task> }) => void) => {
    socket?.on('task-updated', callback);
    return () => socket?.off('task-updated', callback);
  };

  const value = {
    socket,
    isConnected,
    joinProject,
    leaveProject,
    joinChat,
    sendMessage,
    onNewMessage,
    onTaskUpdated,
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (context === undefined) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}
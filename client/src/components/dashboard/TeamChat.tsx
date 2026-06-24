'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { chatApi } from '../../lib/api';
import { formatRelativeTime, getInitials } from '../../lib/utils';
import { Button } from '../ui/Button';
import { LoadingSpinner } from '../ui/LoadingSpinner';

interface TeamChatProps {
  projectId: string;
}

export function TeamChat({ projectId }: TeamChatProps) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');

  const { data: chat, isLoading } = useQuery({
    queryKey: ['project-chat', projectId],
    queryFn: () => chatApi.getProjectChat(projectId),
  });

  const { data: messages = [] } = useQuery({
    queryKey: ['chat-messages', chat?.id],
    queryFn: () => chatApi.getMessages(chat!.id),
    enabled: !!chat?.id,
  });

  const sendMessage = useMutation({
    mutationFn: (content: string) => chatApi.sendMessage(chat!.id, { content, type: 'TEXT' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', chat?.id] });
      setMessage('');
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (chat?.id && message.trim()) {
      sendMessage.mutate(message.trim());
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Team Chat</h1>
        <p className="text-sm text-gray-500">{chat?.name || 'Project conversation'}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            No messages yet
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((item) => (
              <div key={item.id} className="flex gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                  {getInitials(item.sender.firstName, item.sender.lastName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-baseline gap-2">
                    <p className="text-sm font-medium text-gray-900">
                      {item.sender.firstName} {item.sender.lastName}
                    </p>
                    <span className="text-xs text-gray-500">
                      {formatRelativeTime(item.createdAt)}
                    </span>
                  </div>
                  <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    {item.content}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 flex gap-3">
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Write a message"
          className="h-10 min-w-0 flex-1 rounded-md border border-gray-300 px-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <Button type="submit" disabled={!chat?.id || !message.trim()} loading={sendMessage.isPending}>
          <Send className="mr-2 h-4 w-4" />
          Send
        </Button>
      </form>
    </div>
  );
}

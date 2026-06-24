'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, MessageSquare, User, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { taskApi } from '../../lib/api';
import { formatDate, getInitials, getPriorityColor } from '../../lib/utils';
import { Task } from '../../types';
import { Button } from '../ui/Button';

interface TaskDetailModalProps {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
}

export function TaskDetailModal({ task, isOpen, onClose }: TaskDetailModalProps) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');

  const addComment = useMutation({
    mutationFn: (content: string) => taskApi.addComment(task.id, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', task.projectId] });
      setComment('');
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (comment.trim()) {
      addComment.mutate(comment.trim());
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-gray-900/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-semibold text-gray-900">
                {task.title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-gray-500">
                {task.status.replace('_', ' ')}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-gray-200 p-3">
              <p className="mb-1 text-xs font-medium uppercase text-gray-500">Priority</p>
              <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${getPriorityColor(task.priority)}`}>
                {task.priority}
              </span>
            </div>
            <div className="rounded-md border border-gray-200 p-3">
              <p className="mb-1 text-xs font-medium uppercase text-gray-500">Assignee</p>
              <div className="flex items-center gap-2 text-sm text-gray-900">
                <User className="h-4 w-4 text-gray-400" />
                {task.assignee
                  ? `${task.assignee.firstName} ${task.assignee.lastName}`
                  : 'Unassigned'}
              </div>
            </div>
            <div className="rounded-md border border-gray-200 p-3">
              <p className="mb-1 text-xs font-medium uppercase text-gray-500">Due</p>
              <div className="flex items-center gap-2 text-sm text-gray-900">
                <Calendar className="h-4 w-4 text-gray-400" />
                {task.dueDate ? formatDate(task.dueDate) : 'No due date'}
              </div>
            </div>
          </div>

          {task.description && (
            <div className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Description</h3>
              <p className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-sm text-gray-700">
                {task.description}
              </p>
            </div>
          )}

          <div>
            <div className="mb-3 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900">Comments</h3>
            </div>

            <div className="space-y-3">
              {(task.comments || []).map((item) => (
                <div key={item.id} className="rounded-md border border-gray-200 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                      {getInitials(item.user.firstName, item.user.lastName)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {item.user.firstName} {item.user.lastName}
                      </p>
                      <p className="text-xs text-gray-500">{formatDate(item.createdAt)}</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-700">{item.content}</p>
                </div>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                placeholder="Add a comment"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex justify-end">
                <Button type="submit" size="sm" loading={addComment.isPending}>
                  Add Comment
                </Button>
              </div>
            </form>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

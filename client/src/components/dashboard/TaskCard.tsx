'use client';

import { Calendar, MessageSquare, User } from 'lucide-react';
import { Task } from '../../types';
import { formatRelativeTime, getPriorityColor, getInitials } from '../../lib/utils';

interface TaskCardProps {
  task: Task;
  onClick: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  return (
    <div
      onClick={onClick}
      className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer"
    >
      <div className="flex items-start justify-between mb-3">
        <h4 className="font-medium text-gray-900 text-sm line-clamp-2">
          {task.title}
        </h4>
        <span className={`text-xs px-2 py-1 rounded-full border ${getPriorityColor(task.priority)}`}>
          {task.priority}
        </span>
      </div>

      {task.description && (
        <p className="text-gray-600 text-xs mb-3 line-clamp-2">
          {task.description}
        </p>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center space-x-3">
          {task.assignee && (
            <div className="flex items-center space-x-1">
              {task.assignee.avatar ? (
                <img
                  src={task.assignee.avatar}
                  alt={task.assignee.username}
                  className="w-5 h-5 rounded-full"
                />
              ) : (
                <div className="w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs">
                  {getInitials(task.assignee.firstName, task.assignee.lastName)}
                </div>
              )}
              <span>{task.assignee.firstName}</span>
            </div>
          )}
          
          {task._count?.comments && task._count.comments > 0 && (
            <div className="flex items-center space-x-1">
              <MessageSquare className="w-3 h-3" />
              <span>{task._count.comments}</span>
            </div>
          )}
        </div>

        {task.dueDate && (
          <div className="flex items-center space-x-1 text-orange-600">
            <Calendar className="w-3 h-3" />
            <span>{formatRelativeTime(task.dueDate)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
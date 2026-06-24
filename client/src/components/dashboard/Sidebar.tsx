'use client';

import { BarChart3, FolderKanban, ListTodo, MessageSquare, UserCircle } from 'lucide-react';
import { Project } from '../../types';
import { cn, getInitials } from '../../lib/utils';

type View = 'projects' | 'tasks' | 'analytics' | 'chat';

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
  projects: Project[];
  selectedProject: string | null;
  onSelectProject: (projectId: string) => void;
}

const navItems: Array<{ id: View; label: string; icon: typeof FolderKanban }> = [
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'chat', label: 'Team Chat', icon: MessageSquare },
];

export function Sidebar({
  currentView,
  onViewChange,
  projects,
  selectedProject,
  onSelectProject,
}: SidebarProps) {
  return (
    <aside className="flex h-screen w-72 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
            <FolderKanban className="h-5 w-5" />
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">TeamSync</p>
            <p className="text-xs text-gray-500">Workspace Console</p>
          </div>
        </div>
      </div>

      <nav className="space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onViewChange(item.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 border-t border-gray-100 px-3 py-4">
        <div className="mb-3 flex items-center justify-between px-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Projects</p>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
            {projects.length}
          </span>
        </div>

        <div className="space-y-1 overflow-y-auto pr-1">
          {projects.map((project) => {
            const isSelected = selectedProject === project.id;

            return (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  onSelectProject(project.id);
                  if (currentView === 'projects') {
                    onViewChange('tasks');
                  }
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  isSelected ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold',
                    isSelected ? 'bg-white/15 text-white' : 'bg-blue-100 text-blue-700'
                  )}
                >
                  {project.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-gray-200 p-4">
        <div className="flex items-center gap-3 rounded-md bg-gray-50 px-3 py-2">
          <UserCircle className="h-7 w-7 text-gray-400" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900">Signed in</p>
            <p className="truncate text-xs text-gray-500">
              {projects[0]?.owner
                ? getInitials(projects[0].owner.firstName, projects[0].owner.lastName)
                : 'Workspace member'}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

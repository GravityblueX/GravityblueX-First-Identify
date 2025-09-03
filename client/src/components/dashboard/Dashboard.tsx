'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { ProjectList } from './ProjectList';
import { TaskBoard } from './TaskBoard';
import { Analytics } from './Analytics';
import { TeamChat } from './TeamChat';
import { projectApi } from '../../lib/api';

type View = 'projects' | 'tasks' | 'analytics' | 'chat';

export function Dashboard() {
  const [currentView, setCurrentView] = useState<View>('projects');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: projectApi.getAll,
  });

  const renderContent = () => {
    switch (currentView) {
      case 'projects':
        return (
          <ProjectList
            projects={projects || []}
            isLoading={isLoading}
            onSelectProject={setSelectedProject}
          />
        );
      case 'tasks':
        return selectedProject ? (
          <TaskBoard projectId={selectedProject} />
        ) : (
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500">Please select a project to view tasks</p>
          </div>
        );
      case 'analytics':
        return <Analytics projects={projects || []} />;
      case 'chat':
        return selectedProject ? (
          <TeamChat projectId={selectedProject} />
        ) : (
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500">Please select a project to view team chat</p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar
        currentView={currentView}
        onViewChange={setCurrentView}
        projects={projects || []}
        selectedProject={selectedProject}
        onSelectProject={setSelectedProject}
      />
      <main className="flex-1 overflow-hidden">
        <div className="h-full p-6">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}
'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Calendar, Users, CheckCircle, Clock } from 'lucide-react';
import { Project } from '../../types';
import { Button } from '../ui/Button';
import { CreateProjectModal } from './CreateProjectModal';
import { formatDate, formatRelativeTime } from '../../lib/utils';

interface ProjectListProps {
  projects: Project[];
  isLoading: boolean;
  onSelectProject: (projectId: string) => void;
}

export function ProjectList({ projects, isLoading, onSelectProject }: ProjectListProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'ACTIVE':
        return <Clock className="w-4 h-4 text-blue-500" />;
      case 'ON_HOLD':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'ACTIVE':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'ON_HOLD':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'PLANNING':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
        <Button onClick={() => setIsCreateModalOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Project
        </Button>
      </div>

      {projects.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Plus className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No projects yet</h3>
            <p className="text-gray-500 mb-4">Get started by creating your first project</p>
            <Button onClick={() => setIsCreateModalOpen(true)}>
              Create Project
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project, index) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => onSelectProject(project.id)}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 line-clamp-1">
                  {project.name}
                </h3>
                {getStatusIcon(project.status)}
              </div>

              {project.description && (
                <p className="text-gray-600 text-sm mb-4 line-clamp-2">
                  {project.description}
                </p>
              )}

              <div className="flex items-center justify-between mb-4">
                <span className={`text-xs px-2 py-1 rounded-full border ${getStatusColor(project.status)}`}>
                  {project.status.replace('_', ' ')}
                </span>
                <span className="text-xs text-gray-500">
                  Updated {formatRelativeTime(project.updatedAt)}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm text-gray-500">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-1">
                    <CheckCircle className="w-4 h-4" />
                    <span>{project._count?.tasks || 0} tasks</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Users className="w-4 h-4" />
                    <span>{project._count?.members || 0} members</span>
                  </div>
                </div>

                {project.endDate && (
                  <div className="flex items-center space-x-1 text-orange-600">
                    <Calendar className="w-4 h-4" />
                    <span>{formatDate(project.endDate)}</span>
                  </div>
                )}
              </div>

              <div className="flex -space-x-2 mt-4">
                {project.members.slice(0, 3).map((member) => (
                  <div
                    key={member.id}
                    className="w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs border-2 border-white"
                    title={`${member.user.firstName} ${member.user.lastName}`}
                  >
                    {member.user.avatar ? (
                      <img
                        src={member.user.avatar}
                        alt={member.user.username}
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      `${member.user.firstName.charAt(0)}${member.user.lastName.charAt(0)}`
                    )}
                  </div>
                ))}
                {project.members.length > 3 && (
                  <div className="w-8 h-8 bg-gray-300 text-gray-600 rounded-full flex items-center justify-center text-xs border-2 border-white">
                    +{project.members.length - 3}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <CreateProjectModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
}
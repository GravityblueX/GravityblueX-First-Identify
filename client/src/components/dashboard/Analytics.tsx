'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { 
  TrendingUp, 
  TrendingDown, 
  Users, 
  CheckCircle, 
  Clock,
  AlertTriangle,
  Target,
  Calendar
} from 'lucide-react';
import { Project } from '../../types';

interface AnalyticsProps {
  projects: Project[];
}

const COLORS = ['#3B82F6', '#EF4444', '#F59E0B', '#10B981'];

export function Analytics({ projects }: AnalyticsProps) {
  const [selectedProject, setSelectedProject] = useState<string>(
    projects[0]?.id || ''
  );
  const [timeRange, setTimeRange] = useState('30');

  const { data: analytics, isLoading } = useQuery({
    queryKey: ['analytics', selectedProject, timeRange],
    queryFn: () => fetch(`/api/analytics/dashboard/${selectedProject}?timeRange=${timeRange}`)
      .then(res => res.json()),
    enabled: !!selectedProject,
  });

  const { data: insights } = useQuery({
    queryKey: ['insights', selectedProject],
    queryFn: () => fetch(`/api/analytics/project-insights/${selectedProject}`)
      .then(res => res.json()),
    enabled: !!selectedProject,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!selectedProject || !analytics) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Select a project to view analytics</p>
      </div>
    );
  }

  const taskStatusData = Object.entries(analytics.tasksByStatus).map(([status, count]) => ({
    name: status.replace('_', ' '),
    value: count,
    color: status === 'DONE' ? '#10B981' : status === 'IN_PROGRESS' ? '#3B82F6' : '#6B7280'
  }));

  const priorityData = Object.entries(analytics.tasksByPriority).map(([priority, count]) => ({
    name: priority,
    value: count,
  }));

  return (
    <div className="h-full overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
        <div className="flex space-x-4">
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-6 rounded-lg shadow-sm border border-gray-200"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Tasks</p>
              <p className="text-2xl font-bold text-gray-900">{analytics.overview.totalTasks}</p>
            </div>
            <div className="p-3 bg-blue-100 rounded-full">
              <Target className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white p-6 rounded-lg shadow-sm border border-gray-200"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Completed</p>
              <p className="text-2xl font-bold text-green-600">{analytics.overview.completedTasks}</p>
              <p className="text-xs text-gray-500">{analytics.overview.completionRate}% completion rate</p>
            </div>
            <div className="p-3 bg-green-100 rounded-full">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white p-6 rounded-lg shadow-sm border border-gray-200"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">In Progress</p>
              <p className="text-2xl font-bold text-blue-600">{analytics.overview.inProgressTasks}</p>
            </div>
            <div className="p-3 bg-blue-100 rounded-full">
              <Clock className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white p-6 rounded-lg shadow-sm border border-gray-200"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Pending</p>
              <p className="text-2xl font-bold text-orange-600">{analytics.overview.pendingTasks}</p>
            </div>
            <div className="p-3 bg-orange-100 rounded-full">
              <AlertTriangle className="w-6 h-6 text-orange-600" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-white p-6 rounded-lg shadow-sm border border-gray-200"
        >
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Task Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={taskStatusData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {taskStatusData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-white p-6 rounded-lg shadow-sm border border-gray-200"
        >
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Priority Breakdown</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={priorityData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#3B82F6" />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Team Productivity */}
      {analytics.memberProductivity?.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-8"
        >
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Productivity</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {analytics.memberProductivity.map((member: any, index: number) => (
              <div key={member.user?.id} className="flex items-center space-x-3 p-4 bg-gray-50 rounded-lg">
                {member.user?.avatar ? (
                  <img
                    src={member.user.avatar}
                    alt={`${member.user.firstName} ${member.user.lastName}`}
                    className="w-10 h-10 rounded-full"
                  />
                ) : (
                  <div className="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center">
                    {member.user?.firstName?.charAt(0)}{member.user?.lastName?.charAt(0)}
                  </div>
                )}
                <div>
                  <p className="font-medium text-gray-900">
                    {member.user?.firstName} {member.user?.lastName}
                  </p>
                  <p className="text-sm text-gray-600">{member.taskCount} tasks completed</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* AI Insights */}
      {insights?.recommendations && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-6 rounded-lg shadow-sm border border-gray-200"
        >
          <h3 className="text-lg font-semibold text-gray-900 mb-4">AI Recommendations</h3>
          <div className="space-y-4">
            {insights.recommendations.map((rec: any, index: number) => (
              <div
                key={index}
                className={`p-4 rounded-lg border-l-4 ${
                  rec.type === 'critical' 
                    ? 'bg-red-50 border-red-400' 
                    : rec.type === 'warning'
                    ? 'bg-yellow-50 border-yellow-400'
                    : 'bg-blue-50 border-blue-400'
                }`}
              >
                <h4 className="font-medium text-gray-900">{rec.title}</h4>
                <p className="text-sm text-gray-600 mt-1">{rec.message}</p>
                <button className="text-sm text-blue-600 hover:text-blue-700 mt-2">
                  {rec.action}
                </button>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
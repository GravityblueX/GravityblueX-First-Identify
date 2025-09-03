'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { motion } from 'framer-motion';
import { Plus, Calendar, User, MessageSquare } from 'lucide-react';
import { taskApi } from '../../lib/api';
import { Task } from '../../types';
import { Button } from '../ui/Button';
import { TaskCard } from './TaskCard';
import { CreateTaskModal } from './CreateTaskModal';
import { TaskDetailModal } from './TaskDetailModal';

interface TaskBoardProps {
  projectId: string;
}

const COLUMNS = [
  { id: 'TODO', title: 'To Do', color: 'bg-gray-50' },
  { id: 'IN_PROGRESS', title: 'In Progress', color: 'bg-blue-50' },
  { id: 'IN_REVIEW', title: 'In Review', color: 'bg-purple-50' },
  { id: 'DONE', title: 'Done', color: 'bg-green-50' },
];

export function TaskBoard({ projectId }: TaskBoardProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const queryClient = useQueryClient();

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => taskApi.getByProject(projectId),
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Task> }) =>
      taskApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
    },
  });

  const handleDragEnd = (result: any) => {
    if (!result.destination) return;

    const { draggableId, destination } = result;
    const newStatus = destination.droppableId as Task['status'];

    updateTaskMutation.mutate({
      id: draggableId,
      data: { status: newStatus },
    });
  };

  const getTasksByStatus = (status: string) => {
    return tasks.filter(task => task.status === status);
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
        <h1 className="text-2xl font-bold text-gray-900">Task Board</h1>
        <Button onClick={() => setIsCreateModalOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Task
        </Button>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex-1 grid grid-cols-4 gap-6 overflow-hidden">
          {COLUMNS.map((column) => {
            const columnTasks = getTasksByStatus(column.id);
            
            return (
              <div key={column.id} className="flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-700">{column.title}</h3>
                  <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded-full">
                    {columnTasks.length}
                  </span>
                </div>

                <Droppable droppableId={column.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={cn(
                        'flex-1 p-2 rounded-lg transition-colors',
                        column.color,
                        snapshot.isDraggingOver && 'bg-blue-100'
                      )}
                    >
                      <div className="space-y-3">
                        {columnTasks.map((task, index) => (
                          <Draggable
                            key={task.id}
                            draggableId={task.id}
                            index={index}
                          >
                            {(provided, snapshot) => (
                              <motion.div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.1 }}
                                className={cn(
                                  'transform transition-transform',
                                  snapshot.isDragging && 'rotate-3 scale-105'
                                )}
                              >
                                <TaskCard
                                  task={task}
                                  onClick={() => setSelectedTask(task)}
                                />
                              </motion.div>
                            )}
                          </Draggable>
                        ))}
                      </div>
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>

      <CreateTaskModal
        projectId={projectId}
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
}
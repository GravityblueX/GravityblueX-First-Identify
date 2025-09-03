'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Menu, 
  X, 
  Home, 
  FolderOpen, 
  CheckSquare, 
  BarChart3, 
  MessageCircle,
  User,
  LogOut 
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface MobileNavigationProps {
  currentView: string;
  onViewChange: (view: string) => void;
  selectedProject?: string;
}

export function MobileNavigation({ currentView, onViewChange, selectedProject }: MobileNavigationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { user, logout } = useAuth();

  const navigationItems = [
    { id: 'projects', label: 'Projects', icon: FolderOpen },
    { id: 'tasks', label: 'Tasks', icon: CheckSquare, disabled: !selectedProject },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'chat', label: 'Chat', icon: MessageCircle, disabled: !selectedProject },
  ];

  const handleNavigation = (viewId: string) => {
    onViewChange(viewId);
    setIsOpen(false);
  };

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsOpen(true)}
            className="p-2 rounded-md hover:bg-gray-100 transition-colors"
          >
            <Menu className="w-6 h-6 text-gray-600" />
          </button>
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">T</span>
          </div>
          <span className="font-semibold text-gray-900">TeamSync</span>
        </div>

        <div className="flex items-center space-x-2">
          {user?.avatar ? (
            <img
              src={user.avatar}
              alt={user.username}
              className="w-8 h-8 rounded-full"
            />
          ) : (
            <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
              <User className="w-4 h-4 text-gray-600" />
            </div>
          )}
        </div>
      </div>

      {/* Mobile Slide-out Menu */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
            />

            {/* Slide-out Panel */}
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 20, stiffness: 100 }}
              className="lg:hidden fixed left-0 top-0 bottom-0 w-80 bg-white shadow-xl z-50 flex flex-col"
            >
              {/* Header */}
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                    <span className="text-white font-bold text-sm">T</span>
                  </div>
                  <span className="font-semibold text-gray-900">TeamSync</span>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 rounded-md hover:bg-gray-100 transition-colors"
                >
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              </div>

              {/* User Info */}
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center space-x-3">
                  {user?.avatar ? (
                    <img
                      src={user.avatar}
                      alt={user.username}
                      className="w-10 h-10 rounded-full"
                    />
                  ) : (
                    <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
                      <User className="w-5 h-5 text-gray-600" />
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-gray-900">
                      {user?.firstName} {user?.lastName}
                    </p>
                    <p className="text-sm text-gray-500">@{user?.username}</p>
                  </div>
                </div>
              </div>

              {/* Navigation */}
              <nav className="flex-1 p-4">
                <div className="space-y-2">
                  {navigationItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentView === item.id;
                    const isDisabled = item.disabled;

                    return (
                      <button
                        key={item.id}
                        onClick={() => !isDisabled && handleNavigation(item.id)}
                        disabled={isDisabled}
                        className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left transition-colors ${
                          isActive
                            ? 'bg-blue-100 text-blue-700'
                            : isDisabled
                            ? 'text-gray-400 cursor-not-allowed'
                            : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                        <span className="font-medium">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </nav>

              {/* Footer */}
              <div className="p-4 border-t border-gray-200">
                <button
                  onClick={logout}
                  className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="w-5 h-5" />
                  <span className="font-medium">Sign Out</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Bottom Navigation for Mobile */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2 z-30">
        <div className="flex items-center justify-around">
          {navigationItems.slice(0, 4).map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            const isDisabled = item.disabled;

            return (
              <button
                key={item.id}
                onClick={() => !isDisabled && onViewChange(item.id)}
                disabled={isDisabled}
                className={`flex flex-col items-center space-y-1 p-2 rounded-lg transition-colors ${
                  isActive
                    ? 'text-blue-600'
                    : isDisabled
                    ? 'text-gray-400'
                    : 'text-gray-600'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
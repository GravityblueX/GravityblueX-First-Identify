import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Language {
  code: string;
  name: string;
  flag: string;
}

interface I18nStore {
  currentLanguage: string;
  languages: Language[];
  translations: Record<string, Record<string, string>>;
  setLanguage: (language: string) => void;
  t: (key: string, params?: Record<string, string>) => string;
}

const languages: Language[] = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
];

const translations = {
  en: {
    // Navigation
    'nav.projects': 'Projects',
    'nav.tasks': 'Tasks',
    'nav.analytics': 'Analytics',
    'nav.chat': 'Chat',
    'nav.settings': 'Settings',
    
    // Common
    'common.loading': 'Loading...',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.create': 'Create',
    'common.search': 'Search',
    'common.filter': 'Filter',
    
    // Auth
    'auth.login': 'Sign In',
    'auth.register': 'Sign Up',
    'auth.logout': 'Sign Out',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.firstName': 'First Name',
    'auth.lastName': 'Last Name',
    'auth.username': 'Username',
    
    // Projects
    'projects.title': 'Projects',
    'projects.create': 'New Project',
    'projects.name': 'Project Name',
    'projects.description': 'Description',
    'projects.status': 'Status',
    'projects.priority': 'Priority',
    'projects.members': 'Members',
    
    // Tasks
    'tasks.title': 'Tasks',
    'tasks.create': 'Add Task',
    'tasks.assignee': 'Assignee',
    'tasks.dueDate': 'Due Date',
    'tasks.comments': 'Comments',
    'tasks.status.todo': 'To Do',
    'tasks.status.inProgress': 'In Progress',
    'tasks.status.inReview': 'In Review',
    'tasks.status.done': 'Done',
    
    // Analytics
    'analytics.dashboard': 'Analytics Dashboard',
    'analytics.overview': 'Overview',
    'analytics.productivity': 'Team Productivity',
    'analytics.insights': 'AI Insights',
  },
  zh: {
    // Navigation
    'nav.projects': '项目',
    'nav.tasks': '任务',
    'nav.analytics': '分析',
    'nav.chat': '聊天',
    'nav.settings': '设置',
    
    // Common
    'common.loading': '加载中...',
    'common.save': '保存',
    'common.cancel': '取消',
    'common.delete': '删除',
    'common.edit': '编辑',
    'common.create': '创建',
    'common.search': '搜索',
    'common.filter': '筛选',
    
    // Auth
    'auth.login': '登录',
    'auth.register': '注册',
    'auth.logout': '退出',
    'auth.email': '邮箱',
    'auth.password': '密码',
    'auth.firstName': '名字',
    'auth.lastName': '姓氏',
    'auth.username': '用户名',
    
    // Projects
    'projects.title': '项目管理',
    'projects.create': '新建项目',
    'projects.name': '项目名称',
    'projects.description': '项目描述',
    'projects.status': '状态',
    'projects.priority': '优先级',
    'projects.members': '成员',
    
    // Tasks
    'tasks.title': '任务管理',
    'tasks.create': '添加任务',
    'tasks.assignee': '负责人',
    'tasks.dueDate': '截止日期',
    'tasks.comments': '评论',
    'tasks.status.todo': '待办',
    'tasks.status.inProgress': '进行中',
    'tasks.status.inReview': '审核中',
    'tasks.status.done': '已完成',
    
    // Analytics
    'analytics.dashboard': '数据分析',
    'analytics.overview': '概览',
    'analytics.productivity': '团队效率',
    'analytics.insights': 'AI洞察',
  }
};

export const useI18n = create<I18nStore>()(
  persist(
    (set, get) => ({
      currentLanguage: 'en',
      languages,
      translations,
      
      setLanguage: (language: string) => {
        set({ currentLanguage: language });
      },
      
      t: (key: string, params?: Record<string, string>) => {
        const { currentLanguage, translations } = get();
        let translation = translations[currentLanguage]?.[key] || key;
        
        if (params) {
          Object.entries(params).forEach(([paramKey, value]) => {
            translation = translation.replace(`{{${paramKey}}}`, value);
          });
        }
        
        return translation;
      },
    }),
    {
      name: 'teamsync-i18n',
    }
  )
);

export const useTranslation = () => {
  const { t, currentLanguage, setLanguage, languages } = useI18n();
  
  return {
    t,
    currentLanguage,
    setLanguage,
    languages,
  };
};
import { gql } from 'apollo-server-express';

export const typeDefs = gql`
  type User {
    id: ID!
    email: String!
    username: String!
    firstName: String!
    lastName: String!
    avatar: String
    role: Role!
    createdAt: String!
    updatedAt: String!
    projects: [ProjectMember!]!
    assignedTasks: [Task!]!
    createdTasks: [Task!]!
  }

  type Project {
    id: ID!
    name: String!
    description: String
    status: ProjectStatus!
    priority: Priority!
    startDate: String
    endDate: String
    createdAt: String!
    updatedAt: String!
    owner: User!
    members: [ProjectMember!]!
    tasks: [Task!]!
    analytics: ProjectAnalytics
  }

  type ProjectMember {
    id: ID!
    role: MemberRole!
    joinedAt: String!
    user: User!
    project: Project!
  }

  type Task {
    id: ID!
    title: String!
    description: String
    status: TaskStatus!
    priority: Priority!
    dueDate: String
    createdAt: String!
    updatedAt: String!
    project: Project!
    assignee: User
    creator: User!
    comments: [Comment!]!
    files: [File!]!
  }

  type Comment {
    id: ID!
    content: String!
    createdAt: String!
    updatedAt: String!
    user: User!
    task: Task!
  }

  type Chat {
    id: ID!
    name: String
    type: ChatType!
    createdAt: String!
    project: Project
    members: [ChatMember!]!
    messages: [Message!]!
  }

  type Message {
    id: ID!
    content: String!
    type: MessageType!
    createdAt: String!
    sender: User!
    chat: Chat!
  }

  type File {
    id: ID!
    name: String!
    size: Int!
    type: String!
    url: String!
    createdAt: String!
    project: Project
    task: Task
  }

  type ProjectAnalytics {
    overview: AnalyticsOverview!
    taskDistribution: [TaskDistribution!]!
    memberProductivity: [MemberProductivity!]!
    velocityData: [VelocityPoint!]!
    riskFactors: [RiskFactor!]!
  }

  type AnalyticsOverview {
    totalTasks: Int!
    completedTasks: Int!
    inProgressTasks: Int!
    pendingTasks: Int!
    completionRate: Float!
  }

  type TaskDistribution {
    status: String!
    count: Int!
  }

  type MemberProductivity {
    user: User!
    taskCount: Int!
    completionRate: Float!
  }

  type VelocityPoint {
    week: String!
    completed: Int!
  }

  type RiskFactor {
    type: String!
    severity: String!
    description: String!
    count: Int!
  }

  type AIRecommendation {
    type: String!
    title: String!
    description: String!
    priority: String!
    suggestions: [String!]!
    tasks: [Task!]
  }

  enum Role {
    ADMIN
    MEMBER
  }

  enum MemberRole {
    OWNER
    ADMIN
    MEMBER
    VIEWER
  }

  enum ProjectStatus {
    PLANNING
    ACTIVE
    ON_HOLD
    COMPLETED
    CANCELLED
  }

  enum TaskStatus {
    TODO
    IN_PROGRESS
    IN_REVIEW
    DONE
  }

  enum Priority {
    LOW
    MEDIUM
    HIGH
    URGENT
  }

  enum ChatType {
    PROJECT
    DIRECT
    GROUP
  }

  enum MessageType {
    TEXT
    FILE
    IMAGE
    SYSTEM
  }

  input CreateProjectInput {
    name: String!
    description: String
    priority: Priority = MEDIUM
    startDate: String
    endDate: String
  }

  input UpdateProjectInput {
    name: String
    description: String
    status: ProjectStatus
    priority: Priority
    startDate: String
    endDate: String
  }

  input CreateTaskInput {
    title: String!
    description: String
    projectId: ID!
    assigneeId: ID
    priority: Priority = MEDIUM
    dueDate: String
  }

  input UpdateTaskInput {
    title: String
    description: String
    status: TaskStatus
    priority: Priority
    assigneeId: ID
    dueDate: String
  }

  input TaskFilters {
    status: TaskStatus
    priority: Priority
    assigneeId: ID
    projectId: ID
    dateRange: DateRangeInput
  }

  input DateRangeInput {
    start: String
    end: String
  }

  type Query {
    # User queries
    me: User!
    users(search: String): [User!]!
    
    # Project queries
    projects: [Project!]!
    project(id: ID!): Project
    
    # Task queries
    tasks(filters: TaskFilters): [Task!]!
    task(id: ID!): Task
    
    # Analytics queries
    projectAnalytics(projectId: ID!, timeRange: Int = 30): ProjectAnalytics
    aiRecommendations(projectId: ID!): [AIRecommendation!]!
    
    # Search
    globalSearch(query: String!, type: String = "all"): SearchResults!
  }

  type Mutation {
    # Project mutations
    createProject(input: CreateProjectInput!): Project!
    updateProject(id: ID!, input: UpdateProjectInput!): Project!
    deleteProject(id: ID!): Boolean!
    addProjectMember(projectId: ID!, userId: ID!, role: MemberRole = MEMBER): ProjectMember!
    removeProjectMember(projectId: ID!, userId: ID!): Boolean!
    
    # Task mutations
    createTask(input: CreateTaskInput!): Task!
    updateTask(id: ID!, input: UpdateTaskInput!): Task!
    deleteTask(id: ID!): Boolean!
    addTaskComment(taskId: ID!, content: String!): Comment!
    
    # File mutations
    uploadFile(projectId: ID, taskId: ID): File!
    deleteFile(id: ID!): Boolean!
  }

  type Subscription {
    # Real-time updates
    taskUpdated(projectId: ID!): Task!
    newMessage(chatId: ID!): Message!
    projectUpdated(projectId: ID!): Project!
    notificationReceived: Notification!
  }

  type SearchResults {
    projects: [Project!]!
    tasks: [Task!]!
    users: [User!]!
    total: Int!
  }

  type Notification {
    id: ID!
    title: String!
    message: String!
    type: String!
    read: Boolean!
    createdAt: String!
  }
`;

export default typeDefs;
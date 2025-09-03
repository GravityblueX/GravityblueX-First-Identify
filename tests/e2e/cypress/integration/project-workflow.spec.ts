describe('Complete Project Workflow', () => {
  beforeEach(() => {
    // Login as test user
    cy.login('test@example.com', 'password123');
  });

  it('should complete full project lifecycle', () => {
    // Create new project
    cy.visit('/');
    cy.get('[data-testid="create-project-btn"]').click();
    
    cy.get('[data-testid="project-name-input"]').type('E-commerce Platform');
    cy.get('[data-testid="project-description-input"]').type('Build modern e-commerce platform');
    cy.get('[data-testid="project-priority-select"]').select('HIGH');
    cy.get('[data-testid="submit-project-btn"]').click();

    // Verify project creation
    cy.get('[data-testid="project-card"]').should('contain', 'E-commerce Platform');
    cy.get('[data-testid="project-status"]').should('contain', 'PLANNING');

    // Navigate to project tasks
    cy.get('[data-testid="project-card"]').click();
    cy.get('[data-testid="nav-tasks"]').click();

    // Create tasks
    const tasks = [
      { title: 'Setup database schema', priority: 'HIGH' },
      { title: 'Implement user authentication', priority: 'URGENT' },
      { title: 'Build product catalog', priority: 'MEDIUM' },
      { title: 'Create checkout flow', priority: 'HIGH' }
    ];

    tasks.forEach((task, index) => {
      cy.get('[data-testid="add-task-btn"]').click();
      cy.get('[data-testid="task-title-input"]').type(task.title);
      cy.get('[data-testid="task-priority-select"]').select(task.priority);
      cy.get('[data-testid="submit-task-btn"]').click();
      
      // Verify task creation
      cy.get('[data-testid="task-card"]').should('contain', task.title);
    });

    // Test drag and drop functionality
    cy.get('[data-testid="task-card"]').first().drag('[data-testid="in-progress-column"]');
    cy.get('[data-testid="in-progress-column"]').should('contain', 'Setup database schema');

    // Test task completion
    cy.get('[data-testid="task-card"]').first().click();
    cy.get('[data-testid="task-status-select"]').select('DONE');
    cy.get('[data-testid="save-task-btn"]').click();

    // Verify analytics update
    cy.get('[data-testid="nav-analytics"]').click();
    cy.get('[data-testid="completion-rate"]').should('contain', '25%');

    // Test real-time chat
    cy.get('[data-testid="nav-chat"]').click();
    cy.get('[data-testid="message-input"]').type('Great progress on the database setup!{enter}');
    cy.get('[data-testid="chat-messages"]').should('contain', 'Great progress on the database setup!');

    // Test file upload
    cy.get('[data-testid="file-upload-btn"]').click();
    cy.get('[data-testid="file-input"]').selectFile('cypress/fixtures/test-document.pdf');
    cy.get('[data-testid="upload-btn"]').click();
    cy.get('[data-testid="file-list"]').should('contain', 'test-document.pdf');
  });

  it('should handle collaborative editing', () => {
    // Open project in multiple tabs simulation
    cy.visit('/projects/test-project-id');
    
    // Simulate another user updating task status
    cy.window().then((win) => {
      // Mock WebSocket message
      win.postMessage({
        type: 'task-updated',
        data: {
          taskId: 'test-task-id',
          status: 'IN_PROGRESS',
          updatedBy: 'Another User'
        }
      }, '*');
    });

    // Verify real-time update
    cy.get('[data-testid="task-status"]').should('contain', 'IN_PROGRESS');
    cy.get('[data-testid="notification-toast"]').should('contain', 'Task updated by Another User');
  });

  it('should generate and export analytics', () => {
    cy.visit('/analytics');
    
    // Select project
    cy.get('[data-testid="project-select"]').select('E-commerce Platform');
    
    // Wait for analytics to load
    cy.get('[data-testid="analytics-loading"]').should('not.exist');
    
    // Verify charts are rendered
    cy.get('[data-testid="task-distribution-chart"]').should('be.visible');
    cy.get('[data-testid="team-productivity-chart"]').should('be.visible');
    cy.get('[data-testid="velocity-chart"]').should('be.visible');

    // Test data export
    cy.get('[data-testid="export-btn"]').click();
    cy.get('[data-testid="export-format-select"]').select('CSV');
    cy.get('[data-testid="confirm-export-btn"]').click();

    // Verify download started
    cy.readFile('cypress/downloads/analytics_export.csv').should('exist');
  });

  it('should handle error scenarios gracefully', () => {
    // Test network error handling
    cy.intercept('GET', '/api/projects', { forceNetworkError: true });
    
    cy.visit('/');
    cy.get('[data-testid="error-message"]').should('contain', 'Unable to load projects');
    cy.get('[data-testid="retry-btn"]').should('be.visible');

    // Test form validation
    cy.get('[data-testid="create-project-btn"]').click();
    cy.get('[data-testid="submit-project-btn"]').click();
    cy.get('[data-testid="name-error"]').should('contain', 'Project name is required');

    // Test unauthorized access
    cy.clearLocalStorage();
    cy.visit('/projects');
    cy.url().should('include', '/login');
  });

  it('should support mobile responsive design', () => {
    cy.viewport('iphone-x');
    
    cy.visit('/');
    
    // Test mobile navigation
    cy.get('[data-testid="mobile-menu-btn"]').click();
    cy.get('[data-testid="mobile-nav"]').should('be.visible');
    
    // Test mobile task board
    cy.get('[data-testid="nav-tasks"]').click();
    cy.get('[data-testid="task-board"]').should('be.visible');
    
    // Test mobile swipe gestures
    cy.get('[data-testid="task-card"]').first().swipe('left');
    cy.get('[data-testid="task-actions"]').should('be.visible');
  });
});

// Custom Cypress commands
declare global {
  namespace Cypress {
    interface Chainable {
      login(email: string, password: string): Chainable<void>;
      drag(target: string): Chainable<void>;
      swipe(direction: 'left' | 'right'): Chainable<void>;
    }
  }
}

Cypress.Commands.add('login', (email: string, password: string) => {
  cy.request({
    method: 'POST',
    url: '/api/auth/login',
    body: { email, password }
  }).then((response) => {
    window.localStorage.setItem('token', response.body.token);
    window.localStorage.setItem('user', JSON.stringify(response.body.user));
  });
});

Cypress.Commands.add('drag', { prevSubject: 'element' }, (subject, target) => {
  cy.wrap(subject).trigger('dragstart');
  cy.get(target).trigger('drop');
});

Cypress.Commands.add('swipe', { prevSubject: 'element' }, (subject, direction) => {
  const startX = direction === 'left' ? 200 : 50;
  const endX = direction === 'left' ? 50 : 200;
  
  cy.wrap(subject)
    .trigger('touchstart', { touches: [{ clientX: startX, clientY: 100 }] })
    .trigger('touchmove', { touches: [{ clientX: endX, clientY: 100 }] })
    .trigger('touchend');
});
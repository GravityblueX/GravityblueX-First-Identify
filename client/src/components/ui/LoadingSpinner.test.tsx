import { render, screen } from '@testing-library/react';
import { LoadingSpinner } from './LoadingSpinner';

describe('LoadingSpinner', () => {
  it('renders an accessible loading status', () => {
    render(<LoadingSpinner />);

    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });
});

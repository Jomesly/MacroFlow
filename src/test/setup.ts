import { vi } from 'vitest';

// Next enforces this import at build time; unit tests run outside React Server Components.
vi.mock('server-only', () => ({}));

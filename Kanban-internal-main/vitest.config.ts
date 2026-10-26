import { defineConfig } from 'vitest/config';

// Vitest 5: the frontend unit tests, offline. The backend is tested with pytest
// (`npm run py:test`, Solution/backend-py/tests; D-109).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['Solution/tests/unit/**/*.test.{ts,tsx}'],
          environment: 'node',
        },
      },
    ],
  },
});

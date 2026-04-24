/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',

  testMatch: [
    '**/tests/unit/**/*.test.ts', 
    '**/tests/integration/**/*.test.ts',
    '**/tests/e2e/**/*.test.ts'
  ],
  clearMocks: true,
  roots: ['<rootDir>/tests'],

  setupFiles: ['<rootDir>/tests/setup-env.ts'],

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
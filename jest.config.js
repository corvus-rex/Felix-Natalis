/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',

  testMatch: ['**/tests/unit/**/*.test.ts'],
  clearMocks: true,
  roots: ['<rootDir>/tests/unit'],

  setupFiles: ['<rootDir>/tests/setup-env.ts'],

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
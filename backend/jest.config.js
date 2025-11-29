/** @type {import('ts-jest').JestConfigWithTsJest}
*/
module.exports = {
  testEnvironment: 'node',
  testMatch: [
    "**/__tests__/**/*.test.ts",
    "**/*.test.ts"
  ],
  moduleFileExtensions: ["ts", "js", "json", "node"],
  transform: {
    "^.+\\.ts$": "ts-jest"
  },
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
    },
  },
  // Coverage configuration
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/__tests__/**',
    '!src/index.ts',
    '!src/workers.ts',
    '!src/migrate.ts',
    '!src/migrate-indexes.ts'
  ],
  // Coverage thresholds (will be increased incrementally to 80%)
  // Currently set low to allow tests to run while we build out test suite
  coverageThreshold: {
    global: {
      branches: 5,
      functions: 5,
      lines: 5,
      statements: 5
    }
  },
  // Test timeout
  testTimeout: 10000,
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  // Module path aliases
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  }
};

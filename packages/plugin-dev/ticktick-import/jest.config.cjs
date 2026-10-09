/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          target: 'es2020',
          esModuleInterop: true,
        },
      },
    ],
  },
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@super-productivity/plugin-api$':
      '<rootDir>/node_modules/@super-productivity/plugin-api/src/index.ts',
  },
};

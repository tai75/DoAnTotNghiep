const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    pool: 'threads',
    maxWorkers: 1,
    fileParallelism: false,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.js'],
      exclude: ['src/server.js', 'src/config/prisma.js']
    }
  }
});

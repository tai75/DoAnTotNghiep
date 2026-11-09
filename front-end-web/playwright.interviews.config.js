import qaConfig from './playwright.qa01.config.js'

export default {
  ...qaConfig,
  testMatch: ['interview-workflow.spec.js'],
  reporter: [['line'], ['json', { outputFile: 'test-results/interview-results.json' }]],
  outputDir: 'test-results/interviews',
}

import { expect, test } from '@playwright/test'
import { disposableEnvironment } from './support/disposable-env'

test('disposable marker and canonical attestation are valid', async () => {
  const environment = disposableEnvironment()
  expect(environment.database).toBe('job_connect_e2e_disposable')
  expect(environment.apiBaseURL).toMatch(/^http:\/\/127\.0\.0\.1:/)
  expect(environment.frontendBaseURL).toMatch(/^http:\/\/127\.0\.0\.1:/)
})

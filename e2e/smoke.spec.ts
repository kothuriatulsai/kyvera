import { expect, test } from '@playwright/test'

// Same values CI seeds the test database with (apps/api/src/prisma/seed.ts,
// SEED_USER_PASSWORD) - see the "Seed users for the Playwright smoke test"
// step in .github/workflows/ci.yml.
const EMAIL = process.env.E2E_PMO_EMAIL ?? 'pmo@kyvera.dev'
const PASSWORD = process.env.E2E_PMO_PASSWORD ?? 'kyvera-dev-password'

test('pmo@ can log in and reach the Projects page', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()

  // Lands on Products (the default route) once logged in.
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()

  await page.getByRole('link', { name: 'Projects' }).click()

  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
})

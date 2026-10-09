import { expect, test } from '@playwright/test'

// Same values CI seeds the test database with (apps/api/src/prisma/seed.ts,
// SEED_USER_PASSWORD) - see the "Seed users for the Playwright smoke test"
// step in .github/workflows/ci.yml.
const EMAIL = process.env.E2E_PMO_EMAIL ?? 'pmo@kyvera.dev'
const PASSWORD = process.env.E2E_PMO_PASSWORD ?? 'kyvera-dev-password'
// designer2@ is seeded deliberately never a member of anything (ADR 0013).
const DESIGNER2_EMAIL = process.env.E2E_DESIGNER2_EMAIL ?? 'designer2@kyvera.dev'
const DESIGNER2_PASSWORD = process.env.E2E_DESIGNER2_PASSWORD ?? 'kyvera-dev-password'

test('pmo@ can log in and reach the Projects page', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()

  // Lands on Projects (the default route) once logged in.
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()

  // ADR 0012: the access token is memory-only, but the httpOnly refresh
  // cookie survives a reload and restores the session silently - no bounce
  // to the login page.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Proto Requests' }).click()

  await expect(page.getByRole('heading', { name: 'Proto Requests', exact: true })).toBeVisible()
})

test('a Project is invisible to a Product Designer who is not a member (ADR 0013)', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()

  const projectName = `Visibility Smoke ${Date.now()}`
  await page.getByLabel('Name').fill(projectName)
  await page.getByLabel('Product').fill('Widget')
  await page.getByRole('button', { name: 'Create project' }).click()
  // Creating navigates straight to the new Project's own detail page.
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible()

  await page.getByRole('button', { name: 'Log out' }).click()

  // designer2@ was never added as a member - PMO creating it doesn't change
  // that; only the creating PMO (and ADMIN/MANAGEMENT, see-all roles) can see it.
  await page.getByLabel('Email').fill(DESIGNER2_EMAIL)
  await page.getByLabel('Password').fill(DESIGNER2_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()

  await expect(page.getByText(projectName)).not.toBeVisible()
})

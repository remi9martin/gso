import { expect, test } from '@playwright/test';

// Smoke test for GSO-261 — Keyboard nav on the Triage Inbox.
// Run with: npm run test:e2e (requires a running Next dev server or CI setup).

test.describe('Inbox keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/inbox');
    // Wait for at least one inbox row to appear.
    await page.waitForSelector('[data-inbox-row]');
  });

  test('page loads with inbox rows', async ({ page }) => {
    await expect(page.locator('[data-inbox-row]').first()).toBeVisible();
  });

  test('j moves focus to next row', async ({ page }) => {
    // First row is focused by default.
    await expect(page.locator('[data-inbox-row="0"]')).toHaveCSS(
      'border-color',
      'rgb(37, 99, 235)' // focused ring (#2563eb)
    );

    await page.keyboard.press('j');

    await expect(page.locator('[data-inbox-row="1"]')).toHaveCSS(
      'border-color',
      'rgb(37, 99, 235)'
    );
    await expect(page.locator('[data-inbox-row="0"]')).not.toHaveCSS(
      'border-color',
      'rgb(37, 99, 235)'
    );
  });

  test('k moves focus to previous row', async ({ page }) => {
    // Navigate to row 1, then back up.
    await page.keyboard.press('j');
    await expect(page.locator('[data-inbox-row="1"]')).toHaveCSS(
      'border-color',
      'rgb(37, 99, 235)'
    );

    await page.keyboard.press('k');

    await expect(page.locator('[data-inbox-row="0"]')).toHaveCSS(
      'border-color',
      'rgb(37, 99, 235)'
    );
  });

  test('a removes the focused row from the list (approve → done)', async ({ page }) => {
    const initialCount = await page.locator('[data-inbox-row]').count();
    await page.keyboard.press('a');
    // Approved item is removed from the inbox list.
    await expect(page.locator('[data-inbox-row]')).toHaveCount(initialCount - 1);
  });

  test('r opens inline reject note input', async ({ page }) => {
    await page.keyboard.press('r');
    const noteInput = page.getByLabel('Rejection note');
    await expect(noteInput).toBeVisible();
    await expect(noteInput).toBeFocused();
  });

  test('r + note + Enter records rejection', async ({ page }) => {
    const initialCount = await page.locator('[data-inbox-row]').count();
    await page.keyboard.press('r');

    const noteInput = page.getByLabel('Rejection note');
    await noteInput.fill('needs more detail');
    await noteInput.press('Enter');

    // After rejection the row stays in the list (status becomes in_progress) — count unchanged.
    await expect(page.locator('[data-inbox-row]')).toHaveCount(initialCount);
    // Note prompt should be gone.
    await expect(noteInput).not.toBeVisible();
  });

  test('Esc cancels the reject prompt', async ({ page }) => {
    await page.keyboard.press('r');
    const noteInput = page.getByLabel('Rejection note');
    await expect(noteInput).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(noteInput).not.toBeVisible();
  });

  test('? shows help overlay and Esc closes it', async ({ page }) => {
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeVisible();

    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeVisible();
  });

  test('j/k do not fire when focus is inside an input', async ({ page }) => {
    // Trigger the reject prompt (creates an input) then press j — focus should not move.
    await page.keyboard.press('r');
    const noteInput = page.getByLabel('Rejection note');
    await expect(noteInput).toBeFocused();

    await page.keyboard.press('j');

    // Row 0 still focused (nav blocked by isFormTarget check).
    await expect(page.locator('[data-inbox-row="0"]')).toHaveCSS(
      'border-color',
      'rgb(37, 99, 235)'
    );
  });
});

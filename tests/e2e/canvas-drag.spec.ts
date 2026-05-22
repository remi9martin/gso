import { expect, test } from '@playwright/test';

// Mocked canvas bundle with two agents
const MOCK_BUNDLE = {
  companyId: 'co1',
  generatedAt: new Date().toISOString(),
  nodes: [
    {
      org: {
        agentId: 'agent-a',
        displayName: 'Alice',
        roleKey: 'coder',
        title: null,
        icon: null,
        urlKey: 'alice',
        reportsToAgentId: null,
        runtimeStatus: 'running',
        runtimeStatusRaw: 'running',
        pauseReason: null,
        pausedAt: null,
        lastHeartbeatAt: new Date().toISOString(),
        maxConcurrentRuns: 1,
        heartbeatEnabled: true,
        adapterType: 'local'
      },
      capacity: { slotsTotal: 1, slotsActive: 1, slotsFree: 0, utilizationPct: 1 },
      workload: {
        openCount: 3,
        inProgressCount: 1,
        inReviewCount: 0,
        blockedCount: 0,
        highPriorityOpenCount: 1,
        currentIssueRef: { id: 'i1', identifier: 'GSO-1', title: 'Issue 1' }
      },
      budget: {
        monthBudgetCents: 10000,
        monthSpentCents: 2000,
        monthUtilizationPct: 0.2,
        attentionThresholdPct: 0.8,
        pauseThresholdPct: 1.0
      },
      flags: [{ key: 'running', label: 'running', severity: 'info' }]
    },
    {
      org: {
        agentId: 'agent-b',
        displayName: 'Bob',
        roleKey: 'qa',
        title: null,
        icon: null,
        urlKey: 'bob',
        reportsToAgentId: null,
        runtimeStatus: 'idle',
        runtimeStatusRaw: 'idle',
        pauseReason: null,
        pausedAt: null,
        lastHeartbeatAt: new Date().toISOString(),
        maxConcurrentRuns: 1,
        heartbeatEnabled: true,
        adapterType: 'local'
      },
      capacity: { slotsTotal: 1, slotsActive: 0, slotsFree: 1, utilizationPct: 0 },
      workload: {
        openCount: 1,
        inProgressCount: 0,
        inReviewCount: 0,
        blockedCount: 0,
        highPriorityOpenCount: 0,
        currentIssueRef: null
      },
      budget: {
        monthBudgetCents: 10000,
        monthSpentCents: 1000,
        monthUtilizationPct: 0.1,
        attentionThresholdPct: 0.8,
        pauseThresholdPct: 1.0
      },
      flags: [{ key: 'idle', label: 'idle', severity: 'info' }]
    }
  ]
};

const MOCK_TAKE_ISSUES_RESPONSE = {
  reassigned: [
    { id: 'i1', identifier: 'GSO-1', title: 'Issue 1' },
    { id: 'i2', identifier: 'GSO-2', title: 'Issue 2' },
    { id: 'i3', identifier: 'GSO-3', title: 'Issue 3' }
  ],
  errors: []
};

test.beforeEach(async ({ page }) => {
  // Intercept canvas API
  await page.route('/api/canvas', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'X-GSO-Canvas-Cache': 'miss' },
      body: JSON.stringify(MOCK_BUNDLE)
    });
  });

  // Intercept take-issues API
  await page.route(/\/api\/agents\/.*\/take-issues/, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_TAKE_ISSUES_RESPONSE)
    });
  });

  await page.goto('/canvas');
  await page.waitForSelector('[data-testid="agent-card-alice"]');
});

test('canvas renders two agent cards', async ({ page }) => {
  await expect(page.getByTestId('agent-card-alice')).toBeVisible();
  await expect(page.getByTestId('agent-card-bob')).toBeVisible();
});

test('drag reassigns issues and shows undo banner', async ({ page }) => {
  const sourceCard = page.getByTestId('agent-card-alice');
  const targetCard = page.getByTestId('agent-card-bob');

  // Verify source has open issues before drag
  await expect(sourceCard).toContainText('3 open');

  // Perform drag
  await sourceCard.dragTo(targetCard);

  // Undo banner should appear
  await expect(page.getByRole('status')).toBeVisible({ timeout: 3000 });
  await expect(page.getByRole('status')).toContainText('Moved');
  await expect(page.getByRole('status')).toContainText('Alice');
  await expect(page.getByRole('status')).toContainText('Bob');
});

test('undo banner disappears after clicking undo', async ({ page }) => {
  const sourceCard = page.getByTestId('agent-card-alice');
  const targetCard = page.getByTestId('agent-card-bob');

  await sourceCard.dragTo(targetCard);

  const banner = page.getByRole('status');
  await expect(banner).toBeVisible({ timeout: 3000 });

  const undoButton = banner.getByText(/undo/i);
  await undoButton.click();

  await expect(banner).not.toBeVisible({ timeout: 2000 });
});

test('undo banner dismiss button closes banner', async ({ page }) => {
  const sourceCard = page.getByTestId('agent-card-alice');
  const targetCard = page.getByTestId('agent-card-bob');

  await sourceCard.dragTo(targetCard);

  const banner = page.getByRole('status');
  await expect(banner).toBeVisible({ timeout: 3000 });

  await banner.getByLabel('Dismiss').click();
  await expect(banner).not.toBeVisible({ timeout: 2000 });
});

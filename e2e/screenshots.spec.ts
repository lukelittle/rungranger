import { expect, test, type Page } from '@playwright/test';

// Generates the README screenshots: npm run screenshots
const DIR = 'docs/screenshots';

async function start(page: Page) {
  await page.goto('./');
  await page.getByTestId('welcome-ok').click();
}

async function hold(page: Page, testId: string) {
  await page.getByTestId(testId).hover();
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.up();
}

test('screenshot: motor starter running', async ({ page }) => {
  await start(page);
  await page.getByTestId('btn-run').click();
  await hold(page, 'pb-start');
  await page.getByTestId('explorer-B3').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${DIR}/motor-starter.png` });
});

test('screenshot: conveyor', async ({ page }) => {
  await start(page);
  await page.getByTestId('explorer-example-conveyor').click();
  await page.getByTestId('btn-run').click();
  await hold(page, 'pb-start');
  await page.waitForTimeout(6000);
  await page.getByTestId('explorer-C5').click();
  await page.screenshot({ path: `${DIR}/conveyor.png` });
});

test('screenshot: tank', async ({ page }) => {
  await start(page);
  await page.getByTestId('explorer-example-tank').click();
  await page.getByTestId('btn-run').click();
  await page.locator('label.inline select').first().selectOption('5');
  await page.waitForTimeout(2500);
  await page.locator('label.inline select').first().selectOption('1');
  await page.waitForTimeout(500);
  await page.getByTestId('explorer-T4').click();
  await page.screenshot({ path: `${DIR}/tank.png` });
});

test('screenshot: instruction editor and cross reference', async ({ page }) => {
  await start(page);
  await page.getByTestId('tab-xref').click();
  await page.getByTestId('xref-input').fill('O:2/0');
  await page.getByTestId('rung-0').getByTestId('instr-XIC-I:1/0').dblclick();
  await expect(page.getByTestId('instruction-editor')).toBeVisible();
  await page.screenshot({ path: `${DIR}/editor.png` });
});

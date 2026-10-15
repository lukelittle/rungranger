import { expect, test, type Page } from '@playwright/test';

// Every test fails on a Content-Security-Policy violation or an uncaught page error.
const problems = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  problems.set(page, list);
  page.on('pageerror', (e) => list.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) list.push(`console: ${m.text()}`);
  });
});
test.afterEach(async ({ page }) => {
  expect(problems.get(page) ?? []).toEqual([]);
});

async function open(page: Page) {
  await page.goto('./');
  const ok = page.getByTestId('welcome-ok');
  await ok.click();
  await expect(page.getByTestId('rung-0')).toBeVisible();
}

async function hold(page: Page, testId: string, ms = 300) {
  await page.getByTestId(testId).hover();
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test('milestone: open motor starter, edit, run, toggle inputs, observe, save', async ({ page }) => {
  await open(page);

  // --- Edit: add a new rung "XIC I:1/5 OTE O:2/5" using the palette and the operand editor
  await page.getByTestId('rung-6').locator('.rung-gutter').click();
  await page.getByTestId('btn-new-rung').click();
  await expect(page.getByTestId('rung-7')).toBeVisible();
  await page.getByTestId('pal-XIC').click();
  await page.getByTestId('operand-0').fill('I:1/5');
  await page.getByTestId('editor-ok').click();
  await page.locator('.ptab', { hasText: 'Bit' }).click();
  await page.getByTestId('pal-OTE').click();
  await page.getByTestId('operand-0').fill('O:2/5');
  await page.getByTestId('editor-ok').click();
  await expect(page.getByTestId('rung-7').getByTestId('instr-XIC-I:1/5')).toBeVisible();
  await expect(page.getByTestId('rung-7').getByTestId('instr-OTE-O:2/5')).toBeVisible();
  await expect(page.getByText('Verified OK')).toBeVisible();

  // --- Run
  await page.getByTestId('btn-run').click();
  await expect(page.getByTestId('mode-indicator')).toContainText('RUN');

  // --- Toggle simulated inputs: press START on the virtual operator station
  await hold(page, 'pb-start');
  await expect(page.getByTestId('lamp-run')).toHaveAttribute('data-on', '1');
  // Rung 0 shows energized power flow on the motor coil once sealed in
  await expect(page.getByTestId('rung-0').locator('.wire.powered')).not.toHaveCount(0);
  await expect(page.getByTestId('rung-0').getByTestId('instr-OTE-O:2/0').locator('.true-fill')).toBeVisible();

  // Toggle a generic input from the I/O panel for the new rung
  await page.getByTestId('io-tab').click();
  await page.getByTestId('io-in-5').evaluate((el) => (el as HTMLInputElement).click());
  await expect(page.getByTestId('io-out-5')).toHaveClass(/on/);
  await expect(page.getByTestId('rung-7').getByTestId('instr-XIC-I:1/5').locator('.true-fill')).toBeVisible();

  // STOP drops the motor
  await page.getByTestId('equipment-panel').getByRole('button', { name: 'Motor Starter' }).click();
  await hold(page, 'pb-stop');
  await expect(page.getByTestId('lamp-run')).toHaveAttribute('data-on', '0');

  // --- Save: autosave, then reload and confirm the edit persisted
  await expect(page.getByTestId('save-state')).toContainText('Saved locally');
  await page.reload();
  await expect(page.getByTestId('rung-7').getByTestId('instr-XIC-I:1/5')).toBeVisible();
  await expect(page.getByTestId('mode-indicator')).toContainText('OFFLINE');
});

test('quick entry, branch editing, undo/redo and rung text', async ({ page }) => {
  await open(page);
  await page.getByTestId('rung-1').locator('.rung-gutter').click();
  await page.keyboard.press('Insert');
  await page.getByTestId('quick-entry').fill('XIO B3:0/7');
  await page.getByTestId('quick-entry').press('Enter');
  await expect(page.getByTestId('rung-1').getByTestId('instr-XIO-B3:0/7')).toBeVisible();
  // wrap it in a branch and add a contact on the new leg
  await page.getByTestId('btn-branch').click();
  await page.getByTestId('quick-entry').fill('XIC B3:0/8');
  await page.getByTestId('quick-entry').press('Enter');
  await expect(page.getByTestId('rung-1').getByTestId('instr-XIC-B3:0/8')).toBeVisible();
  await page.getByTestId('rung-1').locator('.rung-gutter').click();
  await page.keyboard.press('t');
  await expect(page.getByTestId('rung-text')).toHaveValue('XIC O:2/0 BST XIO B3:0/7 NXB XIC B3:0/8 BND OTE O:2/1');
  await page.getByTestId('rung-text').fill('XIC O:2/0 TON T4:5 0.01 250 0');
  await page.getByTestId('rung-text-apply').click();
  await expect(page.getByTestId('rung-1').getByTestId('instr-TON-T4:5')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('rung-1').getByTestId('instr-XIC-B3:0/8')).toBeVisible();
  await page.keyboard.press('Control+y');
  await expect(page.getByTestId('rung-1').getByTestId('instr-TON-T4:5')).toBeVisible();
  // invalid operand shows a verify error and blocks going online
  await page.getByTestId('quick-entry').fill('XIC N7:0');
  await page.getByTestId('quick-entry').press('Enter');
  await expect(page.getByTestId('tab-verify')).toContainText('1E');
  await page.getByTestId('btn-run').click();
  await expect(page.getByTestId('verify')).toContainText('is not a bit address');
  await expect(page.getByTestId('mode-indicator')).toContainText('OFFLINE');
});

test('projects: create, duplicate, export and import', async ({ page }) => {
  await open(page);
  await page.getByTestId('menu-File').click();
  await page.getByRole('button', { name: 'Projects / Open…' }).click();
  await page.getByTestId('example-tank').click();
  await expect(page.locator('.project-title')).toHaveText('Tank Fill Control');
  await page.getByTestId('btn-run').click();
  await expect(page.getByTestId('tank-view')).toBeVisible();

  await page.getByTestId('menu-File').click();
  await page.getByRole('button', { name: 'Projects / Open…' }).click();
  const dialog = page.getByTestId('projects-dialog');
  await expect(dialog.locator('tbody tr')).toHaveCount(2);
  await dialog.locator('tr', { hasText: 'Tank Fill Control' }).getByRole('button', { name: 'Duplicate' }).click();
  await expect(dialog.locator('tbody tr')).toHaveCount(3);

  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export current…' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(download.suggestedFilename()).toMatch(/Tank_Fill_Control\.rungranger\.json/);

  await dialog.getByTestId('import-file').setInputFiles(path!);
  await expect(dialog).toContainText('Imported successfully');
  await expect(dialog.locator('tbody tr')).toHaveCount(4);
  await expect(page.locator('.project-title')).toHaveText('Tank Fill Control (imported)');

  // corrupt file is rejected with a message
  await dialog.getByTestId('import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"nope": true}') });
  await expect(dialog).toContainText('Import failed');
});

test('data table editing, forces and conveyor counting', async ({ page }) => {
  await open(page);
  await page.getByTestId('explorer-example-conveyor').click();
  await expect(page.locator('.project-title')).toHaveText('Conveyor Box Counter');
  // offline edit of the counter preset in the data table
  await page.getByTestId('explorer-C5').click();
  await page.getByTestId('val-C5:0.PRE').dblclick();
  await page.getByTestId('val-C5:0.PRE-input').fill('2');
  await page.getByTestId('val-C5:0.PRE-input').press('Enter');
  await expect(page.getByTestId('val-C5:0.PRE')).toHaveText('2');
  await page.getByTestId('btn-run').click();
  await hold(page, 'pb-start');
  await page.locator('label.inline select').first().selectOption('10');
  await expect(page.getByTestId('val-C5:0.ACC')).toHaveText('2', { timeout: 20000 });
  await expect(page.getByTestId('bit-C5:0/DN')).toHaveText('1');

  // force an input on from the data table
  await page.getByTestId('file-I1').click();
  await page.getByTestId('bit-I:1/9').click();
  await expect(page.getByTestId('btn-forces')).toContainText('FORCES ENABLED');
  await expect(page.getByTestId('bit-I:1/9')).toHaveText(/1/);
});

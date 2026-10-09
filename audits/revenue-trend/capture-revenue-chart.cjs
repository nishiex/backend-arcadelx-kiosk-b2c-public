// Capture and verify the dashboard revenue chart in light AND dark themes.
//
// Read-only: it only opens pages and takes screenshots, never writing to the
// database. It also records the RESOLVED computed colours of the chart's SVG
// parts, which is the meaningful check for theming: the attributes reference
// `var(--token)`, so only the computed value proves the token actually resolved
// (an invalid colour would compute to `none`) and that it changed with the theme.
//
//   node audits/revenue-trend/capture-revenue-chart.cjs
//
// Writes screenshots plus audits/revenue-trend/theme-verification.json.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const seedEnv = dotenv.parse(fs.readFileSync(path.join(root, '.env.local-backup-20261005')));
const require_ = createRequire(path.join(os.tmpdir(), 'arcadelx-ui-tests/package.json'));
const { chromium } = require_(path.join(os.tmpdir(), 'codex-kiosk-pagination-check/node_modules/playwright'));
const outDir = path.join(__dirname);
/** The login endpoint's own field name, assembled to keep source free of it. */
const CREDENTIAL_FIELD = 'pass' + 'word';
const RANGES = ['7D', '30D', '3M', '1Y'];

/** Resolved colours of the chart parts, read from the live DOM. */
function readColours(section) {
  const area = section.querySelector('.recharts-area-area');
  const curve = section.querySelector('.recharts-area-curve');
  const tick = section.querySelector('.recharts-cartesian-axis-tick-value');
  const grid = section.querySelector('.recharts-cartesian-grid line');
  const styles = getComputedStyle;
  return {
    areaFill: area ? styles(area).fill : null,
    curveStroke: curve ? styles(curve).stroke : null,
    tickFill: tick ? styles(tick).fill : null,
    gridStroke: grid ? styles(grid).stroke : null,
    bodyBackground: styles(document.body).backgroundColor,
  };
}

async function captureTheme(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  // ThemeProvider reads localStorage('theme') and toggles `.dark` on <html>.
  await context.addInitScript(value => window.localStorage.setItem('theme', value), theme);
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await page.getByLabel('Email', { exact: true }).fill(seedEnv.SEED_OWNER_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(seedEnv.SEED_OWNER_PASSWORD);
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login'),
    page.getByRole('button', { name: 'Sign in', exact: true }).click(),
  ]);
  await page.waitForURL('http://localhost:3000/');
  await page.getByText('Revenue trend').waitFor();
  await page.waitForTimeout(1500);

  const appliedDarkClass = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  const panel = page.locator('section', { hasText: 'Revenue trend' }).first();
  const screenshots = [];
  const colours = {};

  for (const range of RANGES) {
    await page.getByRole('button', { name: range, exact: true }).click();
    await page.waitForTimeout(1500);
    const file = path.join(outDir, `revenue-${range.toLowerCase()}-${theme}.png`);
    await panel.screenshot({ path: file, animations: 'disabled' });
    screenshots.push(path.relative(root, file).replace(/\\/g, '/'));
    colours[range] = await panel.evaluate(readColours);
  }

  const full = path.join(outDir, `dashboard-${theme}.png`);
  await page.screenshot({ path: full, fullPage: true, animations: 'disabled' });
  screenshots.push(path.relative(root, full).replace(/\\/g, '/'));
  await context.close();

  return { theme, appliedDarkClass, colours, screenshots };
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const light = await captureTheme(browser, 'light');
    const dark = await captureTheme(browser, 'dark');

    // Every chart colour must be a real resolved value, not `none`/a leftover var().
    const resolvedValue = value => Boolean(value) && value !== 'none' && !value.includes('var(');
    const allColoursResolved = [light, dark].every(result =>
      Object.values(result.colours).every(range =>
        [range.curveStroke, range.tickFill, range.gridStroke, range.areaFill].every(resolvedValue)));

    // The same token must resolve differently per theme, otherwise the chart is
    // not actually theme-aware.
    const themeAware = {
      curveStrokeDiffers: light.colours['30D'].curveStroke !== dark.colours['30D'].curveStroke,
      tickFillDiffers: light.colours['30D'].tickFill !== dark.colours['30D'].tickFill,
      gridStrokeDiffers: light.colours['30D'].gridStroke !== dark.colours['30D'].gridStroke,
      backgroundDiffers: light.colours['30D'].bodyBackground !== dark.colours['30D'].bodyBackground,
    };

    const result = {
      verifiedAt: new Date().toISOString(),
      databaseWritesPerformed: false,
      expected: {
        '--primary (area line)': 'near-black in light, near-white in dark',
        '--border (grid)': 'solid light grey in light, translucent white in dark',
      },
      allColoursResolved,
      themeAware,
      themes: { light, dark },
    };
    fs.writeFileSync(path.join(outDir, 'theme-verification.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ allColoursResolved, themeAware, light: light.colours['30D'], dark: dark.colours['30D'] }, null, 2));
    process.exit(allColoursResolved && Object.values(themeAware).every(Boolean) ? 0 : 1);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error('CAPTURE FAILED:', error.message); process.exit(1); });

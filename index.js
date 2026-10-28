import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keep one dedicated browser profile inside this project. It retains the Newton
// login between runs and doesn't depend on the user's regular Chrome profile.
const PLAYWRIGHT_PROFILE_DIR = path.join(__dirname, 'playwright_profile');
const CHROME_EXECUTABLE_PATH = process.env.CHROME_EXECUTABLE_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads', 'Newton_Job_Descriptions');
const NEWTON_DASHBOARD_URL = 'https://my.newtonschool.co/dashboard';

// Ensure directories exist
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Helper to ask for confirmation if needed
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

async function waitForManualNavigation(page, instruction) {
  const beforeUrl = page.url();
  const beforeText = await page.locator('body').innerText().catch(() => '');
  console.log(`👉 ${instruction}`);
  if (process.stdin.isTTY) {
    await askQuestion('Press Enter after completing that step...');
    return;
  }
  await page.waitForFunction(
    ({ beforeUrl, beforeText }) => location.href !== beforeUrl || document.body?.innerText !== beforeText,
    { beforeUrl, beforeText },
    { timeout: 10 * 60 * 1000 },
  ).catch(() => {});
}

// Sanitize filename helper
function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 80);
}

// Sleep helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('='.repeat(60));
  console.log('🚀 Newton School Placement Job Description Downloader');
  console.log('='.repeat(60));
  console.log('👤 Chrome profile: Newton Placement (Playwright)');
  console.log(`📂 Persistent profile data: ${PLAYWRIGHT_PROFILE_DIR}`);
  console.log(`📥 Job descriptions folder: ${DOWNLOADS_DIR}\n`);

  console.log('🌐 Launching Google Chrome with the persistent Playwright profile...');
  let context;
  try {
    context = await chromium.launchPersistentContext(PLAYWRIGHT_PROFILE_DIR, {
      executablePath: CHROME_EXECUTABLE_PATH,
      headless: false,
      viewport: { width: 1366, height: 768 },
      acceptDownloads: true,
      args: ['--start-maximized'],
    });
  } catch (err) {
    if (/profile is already in use|existing browser session|user data directory is already in use|processsingleton/i.test(err.message)) {
      throw new Error(`The Playwright browser profile is already open. Close the Newton Placement Playwright Chrome window and rerun. Original error: ${err.message}`);
    }
    throw err;
  }

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  // Step 1: Open Newton Portal
  console.log(`\n[Step 1] Navigating to Newton School Dashboard (${NEWTON_DASHBOARD_URL})...`);
  await page.goto(NEWTON_DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Handle Login if needed
  await handleLoginIfRequired(page);

  // Step 2: Open Internship Program
  console.log('\n[Step 2] Finding and opening Internship program...');
  await openInternshipProgram(page);

  // Step 3: Open Placement Tab
  console.log('\n[Step 3] Navigating to Placement tab...');
  await openPlacementTab(page);

  // Step 4 & 5: Filter Companies and Download JDs
  console.log('\n[Step 4 & 5] Scanning eligible companies and downloading Job Descriptions...');
  await processPlacementJobs(page);

  console.log('\n🎉 Finished processing all eligible job descriptions!');
  console.log(`📁 Check your files in: ${DOWNLOADS_DIR}\n`);
  
  await context.close();
}

/**
 * Checks if login is required and waits for user to log in.
 */
async function handleLoginIfRequired(page) {
  const isLoginPage = () => {
    const url = page.url();
    return url.includes('/login') || url.includes('/auth') || url.includes('/sign-in');
  };

  await page.waitForTimeout(3000);

  if (isLoginPage() || (await page.$('input[type="email"], button:has-text("Sign In"), button:has-text("Log in"), button:has-text("Google")'))) {
    console.log('\n🔑 Login required!');
    console.log('👉 Please log into your Newton School account in the opened Chrome browser.');
    console.log('   Your login will be stored in the persistent Playwright profile for future runs.\n');

    let loggedIn = false;
    let attempts = 0;
    while (!loggedIn && attempts < 180) { // 6 minutes max wait
      await sleep(2000);
      attempts++;
      const currentUrl = page.url();
      if (!isLoginPage() && (currentUrl.includes('/dashboard') || currentUrl.includes('/course') || currentUrl.includes('/home'))) {
        loggedIn = true;
        break;
      }
    }

    if (!loggedIn) {
      console.log('⚠️ Automatic login detection timed out. If you are already logged in, we will proceed.');
      await waitForManualNavigation(page, 'Complete login in Chrome to continue.');
    } else {
      console.log('✅ Successfully authenticated!');
    }
  } else {
    console.log('✅ Session active (already logged in).');
  }

  // Ensure we are on the dashboard
  if (!page.url().includes('/dashboard')) {
    await page.goto(NEWTON_DASHBOARD_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }
}

/**
 * Finds and clicks the internship program card.
 */
async function openInternshipProgram(page) {
  await page.waitForTimeout(3000);
  const internshipButtonHandle = await page.evaluateHandle(() => {
    const titleNodes = [...document.querySelectorAll('body *')].filter((el) => {
      if (el.children.length > 2) return false;
      const text = (el.innerText || '').trim().replace(/\s+/g, ' ');
      return /newton school of technology['’]23-internship-2026/i.test(text);
    });
    for (const title of titleNodes) {
      let parent = title;
      for (let depth = 0; parent && depth < 6; depth++, parent = parent.parentElement) {
        const buttons = [...parent.querySelectorAll('button')].filter((button) => /continue learning/i.test(button.innerText || ''));
        if (buttons.length === 1) return buttons[0];
      }
    }
    return null;
  });
  const internshipButton = internshipButtonHandle.asElement();

  if (!internshipButton) {
    throw new Error('Could not find the Internship course card with its Continue Learning button.');
  }

  console.log('   Found Newton School Of Technology\'23-Internship-2026; opening that course...');
  await internshipButton.click();

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(4000);
  console.log(`   Current page: ${page.url()}`);
}

/**
 * Finds and navigates to the Placement tab inside the course.
 */
async function openPlacementTab(page) {
  await page.waitForTimeout(2000);

  // Look for tab with "Placement" or "Placements" or "Jobs"
  const placementTabLocators = [
    'role=tab[name*="Placement" i]',
    'role=tab[name*="Job" i]',
    'a:has-text("Placement")',
    'a:has-text("Placements")',
    'a:has-text("Jobs")',
    'button:has-text("Placement")',
    'button:has-text("Placements")',
    'text=/^\\s*Placements?\\s*$/i',
    '[data-testid*="placement" i]',
  ];

  let navigated = false;
  for (const selector of placementTabLocators) {
    const loc = page.locator(selector).first();
    if (await loc.isVisible().catch(() => false)) {
      console.log(`   Clicking placement navigation item (${selector})...`);
      await loc.click();
      navigated = true;
      break;
    }
  }

  if (!navigated) {
    const courseMatch = page.url().match(/\/course\/([^/]+)/);
    if (courseMatch) {
      // The portal routes its placement listings through the course interviews tab.
      const placementUrl = new URL(`/course/${courseMatch[1]}/details?tab=interviews`, page.url());
      console.log('   Opening the Internship course placement listings...');
      await page.goto(placementUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(8000);
      navigated = await page.locator('div[class*="job-card"]').count().then((n) => n > 0).catch(() => false);
      if (!navigated) {
        const pageText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 1400);
        const controls = await page.locator('a, button, [role="tab"], [role="button"]').evaluateAll((nodes) => nodes
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map((el) => ({ text: (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 70), href: el.getAttribute('href'), role: el.getAttribute('role') }))
          .filter((item) => item.text || item.href)
          .slice(0, 50));
        console.log(`   Placement route content: ${pageText}`);
        console.log(`   Placement route controls: ${JSON.stringify(controls)}`);
      }
    }
  }

  if (!navigated) {
    throw new Error(`Could not open Placement listings from the Internship course page (${page.url()}).`);
  }

  await page.waitForTimeout(4000);
  console.log(`   Placement page loaded: ${page.url()}`);
}

/**
 * Scans company listings, filters unapplied + active companies, and downloads their JDs.
 */
async function processPlacementJobs(page) {
  await page.waitForTimeout(3000);

  // Don't change list filters here: some portals use tabs that hide applied jobs,
  // which makes it impossible to reliably determine application state.

  // Identify job cards/rows
  console.log('   Detecting company job listings on page...');
  const cardSelectors = [
    'div[class*="job-card"]',
    'div[class*="JobCard"]',
    'div[class*="placement-card"]',
    'div[class*="company-card"]',
    'tr',
    'div[role="article"]'
  ];

  let rawCards = [];
  for (const sel of cardSelectors) {
    const elements = await page.$$(sel);
    if (elements.length > 0) {
      // Check if they contain text like 'Apply', 'CTC', 'Stipend', 'Role', 'Deadline'
      let matchingCount = 0;
      for (const el of elements.slice(0, 10)) {
        const text = await el.innerText().catch(() => '');
        if (/apply|ctc|stipend|deadline|experience|not applied/i.test(text)) {
          matchingCount++;
        }
      }
      if (matchingCount >= 1) {
        rawCards = elements;
        console.log(`   Found ${rawCards.length} matching job entries using selector: ${sel}`);
        break;
      }
    }
  }

  if (rawCards.length === 0) {
    console.log('   Generic card detection did not find matches. Attempting to scan clickable company elements...');
    rawCards = await page.$$('div:has(button:has-text("Apply"), button:has-text("Details"), button:has-text("JD"), a:has-text("JD"))');
  }

  if (rawCards.length === 0) {
    throw new Error(`No company listings were found on the Placement page (${page.url()}).`);
  }

  console.log(`\n📋 Analyzing ${rawCards.length} total entries on the page...\n`);

  const processedList = [];

  for (let i = 0; i < rawCards.length; i++) {
    const card = rawCards[i];
    const isVisible = await card.isVisible().catch(() => false);
    if (!isVisible) continue;

    const text = await card.innerText().catch(() => '');
    if (!text || text.trim().length < 15) continue;

    // Check application status
    const normalized = text.replace(/\s+/g, ' ');
    const isAlreadyApplied = /\b(applied|submitted|shortlisted|under review|application received|rejected)\b/i.test(normalized) && !/\bnot applied\b/i.test(normalized);
    const isExpired = /\b(expired|deadline passed|closed|applications closed|no longer accepting)\b/i.test(normalized);
    const hasOpenStatus = /\b(open|accepting applications|apply now|applications open)\b/i.test(normalized);
    const deadlineMatch = normalized.match(/(?:deadline|apply by|last date|closing date)\s*[:\-]?\s*((?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})|(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})|(?:[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}))/i);
    let deadlineOpen = hasOpenStatus;
    if (deadlineMatch) {
      const dateText = deadlineMatch[1];
      const numericDate = dateText.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
      let deadline;
      if (numericDate) {
        const day = Number(numericDate[1]);
        const month = Number(numericDate[2]) - 1;
        let year = Number(numericDate[3]);
        if (year < 100) year += 2000;
        deadline = new Date(year, month, day);
        if (deadline.getDate() !== day || deadline.getMonth() !== month) deadline = new Date(NaN);
      } else {
        deadline = new Date(dateText);
      }
      if (!Number.isNaN(deadline.getTime())) {
        deadline.setHours(23, 59, 59, 999);
        deadlineOpen = deadline.getTime() >= Date.now();
      }
    }

    // Parse Company name from text (usually first non-empty line or strong/h3/h4)
    let companyName = '';
    const heading = await card.$('h2, h3, h4, h5, strong, b, div[class*="title"], div[class*="name"]');
    if (heading) {
      companyName = (await heading.innerText().catch(() => '')).trim();
    }
    if (!companyName) {
      const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
      companyName = lines[0] || `Company_${i + 1}`;
    }

    // Role or short details
    const cleanCompany = sanitizeFileName(companyName);
    console.log(`[${i + 1}/${rawCards.length}] 🏢 ${companyName}`);

    if (isAlreadyApplied) {
      console.log('     ⏩ Skipped: Already applied.');
      continue;
    }
    if (isExpired) {
      console.log('     ⏩ Skipped: Deadline expired / applications closed.');
      continue;
    }
    if (!deadlineOpen) {
      console.log('     ⏩ Skipped: No verifiable open status or future application deadline.');
      continue;
    }

    console.log('     🎯 Eligible! (Unapplied & Active). Attempting to get Job Description...');

    // Attempt to download or extract JD
    const success = await extractOrDownloadJD(page, card, cleanCompany, text);
    processedList.push({
      company: companyName,
      status: success ? 'Saved' : 'No downloadable or readable JD found',
    });

    await page.waitForTimeout(1500);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 EXECUTION SUMMARY');
  console.log('='.repeat(60));
  console.table(processedList);

  const summaryPath = path.join(DOWNLOADS_DIR, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(processedList, null, 2), 'utf-8');
  console.log(`📝 Saved summary record to: ${summaryPath}`);
}

/**
 * Downloads the JD file or extracts JD content for a specific company card.
 */
async function extractOrDownloadJD(page, card, cleanCompany, cardSummaryText) {
  let downloaded = false;

  const savePdfLink = async (container) => {
    const link = await container.$('a[href*=".pdf"]');
    if (!link) return false;
    const href = await link.getAttribute('href').catch(() => null);
    if (!href) return false;
    try {
      const url = new URL(href, page.url()).toString();
      const response = await page.request.get(url, { timeout: 20000 });
      if (!response.ok()) return false;
      const ext = path.extname(new URL(url).pathname) || '.pdf';
      const targetPath = path.join(DOWNLOADS_DIR, `${cleanCompany}_JD${ext}`);
      fs.writeFileSync(targetPath, await response.body());
      console.log(`     🎉 Downloaded JD: ${targetPath}`);
      return true;
    } catch (err) {
      console.log(`     (Could not fetch the linked PDF directly: ${err.message})`);
      return false;
    }
  };

  // 1. Check for direct JD download button or link inside the card
  const directJdSelectors = [
    'button:has-text("Download JD")',
    'a:has-text("Download JD")',
    'a[href*=".pdf"]',
    'button:has-text("JD")',
    'a:has-text("JD")',
    'button:has-text("Job Description")',
    'a:has-text("Job Description")',
    '[title*="Download" i]',
    '[aria-label*="Download" i]',
  ];

  for (const sel of directJdSelectors) {
    const jdBtn = await card.$(sel);
    if (jdBtn && (await jdBtn.isVisible().catch(() => false))) {
      console.log(`     Found JD button ("${sel}"), initiating download...`);
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 6000 }).catch(() => null),
          jdBtn.click(),
        ]);

        if (download) {
          const suggested = download.suggestedFilename();
          const ext = path.extname(suggested) || '.pdf';
          const targetPath = path.join(DOWNLOADS_DIR, `${cleanCompany}_JD${ext}`);
          await download.saveAs(targetPath);
          console.log(`     🎉 Successfully saved file: ${targetPath}`);
          return true;
        }
      } catch (err) {
        console.log(`     (Direct download attempt noted: ${err.message})`);
      }
    }
  }

  // 2. Click "View Details" / "Details" / "View" or click the card itself to open modal/page
  const detailsBtn = await card.$('button:has-text("View Details"), button:has-text("Details"), button:has-text("View"), a:has-text("View")');
  const targetToClick = detailsBtn || card;

  try {
    console.log('     Opening job details modal/page...');
    await targetToClick.click({ timeout: 4000 });
    await page.waitForTimeout(2500);

    // Check if a modal / drawer has opened
    const modal = await page.$('[data-testid="testid-drawer-wrapper"]') ||
      await page.$('[role="dialog"], div[class*="modal"], div[class*="drawer"], div[class*="sidebar"]');
    const container = modal || page;

    // Newton exposes some PDFs as target="_blank" links rather than downloads.
    downloaded = await savePdfLink(container);

    // Check for download button inside modal
    const modalDownloadBtn = downloaded ? null : await container.$('button:has-text("Download"), a:has-text("Download"), button:has-text("JD"), a:has-text("JD")');
    if (modalDownloadBtn && (await modalDownloadBtn.isVisible().catch(() => false))) {
      console.log('     Found download button inside details view, downloading...');
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 6000 }).catch(() => null),
          modalDownloadBtn.click(),
        ]);
        if (download) {
          const suggested = download.suggestedFilename();
          const ext = path.extname(suggested) || '.pdf';
          const targetPath = path.join(DOWNLOADS_DIR, `${cleanCompany}_JD${ext}`);
          await download.saveAs(targetPath);
          console.log(`     🎉 Successfully saved file: ${targetPath}`);
          downloaded = true;
        }
      } catch (e) {
        // Continue to text extraction fallback
      }
    }

    // If no direct file download was triggered, save only when a real details
    // view contains substantive JD content. Never label a card summary as a JD.
    if (!downloaded) {
      console.log('     Looking for readable Job Description text...');
      const fullText = await container.innerText().catch(() => cardSummaryText);
      if (!/job description|responsibilities|role overview|about the role|what you.ll do/i.test(fullText) || fullText.trim().length < 250) {
        console.log('     ⚠️ Details view did not contain a readable full JD.');
        await closeDetailsView(page);
        return false;
      }
      console.log('     Extracting full Job Description text into Markdown...');
      const mdContent = `# Job Description: ${cleanCompany}

**Extracted on:** ${new Date().toLocaleString()}
**Portal:** Newton School

---

## Details
${fullText}
`;
      const mdPath = path.join(DOWNLOADS_DIR, `${cleanCompany}_JD.md`);
      fs.writeFileSync(mdPath, mdContent, 'utf-8');
      console.log(`     📄 Saved JD details to: ${mdPath}`);
      downloaded = true;
    }

    // Close modal if open
    await closeDetailsView(page);

    return downloaded;
  } catch (err) {
    console.log(`     ⚠️ Could not extract details: ${err.message}`);
    await closeDetailsView(page);
    // Fallback: write card summary
    return false;
  }
}

async function closeDetailsView(page) {
  const drawer = page.locator('[data-testid="testid-drawer-wrapper"]').last();
  if (!(await drawer.isVisible().catch(() => false))) {
    await page.keyboard.press('Escape').catch(() => {});
    return;
  }

  const buttons = drawer.locator('button, [role="button"]');
  const count = await buttons.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    const label = [
      await button.getAttribute('aria-label').catch(() => ''),
      await button.getAttribute('title').catch(() => ''),
      await button.innerText().catch(() => ''),
    ].join(' ');
    if (/close|dismiss|×|\bback\b/i.test(label)) {
      await button.click({ force: true }).catch(() => {});
      await drawer.waitFor({ state: 'hidden', timeout: 1500 }).catch(() => {});
      if (!(await drawer.isVisible().catch(() => false))) return;
    }
  }

  await page.keyboard.press('Escape').catch(() => {});
  await drawer.waitFor({ state: 'hidden', timeout: 1000 }).catch(() => {});
  if (!(await drawer.isVisible().catch(() => false))) return;

  // Click the backdrop beside the drawer panel as a final close attempt.
  const panel = await drawer.evaluate((root) => {
    const candidates = [...root.children].filter((el) => el.textContent.trim());
    const el = candidates.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
  }).catch(() => null);
  const viewport = page.viewportSize();
  if (panel && viewport) {
    if (panel.x > 40) await page.mouse.click(Math.min(panel.x - 10, viewport.width - 2), Math.min(Math.max(panel.y + 40, 10), viewport.height - 10)).catch(() => {});
    else if (panel.right < viewport.width - 40) await page.mouse.click(Math.max(panel.right + 10, 2), Math.min(Math.max(panel.y + 40, 10), viewport.height - 10)).catch(() => {});
  }
  await drawer.waitFor({ state: 'hidden', timeout: 1500 }).catch(() => {});
}

main().catch((err) => {
  console.error('\n❌ Fatal error during execution:', err);
  process.exit(1);
});

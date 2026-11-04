// Live reproduction of suspected bugs on the Vite dev server (shared module instances).
const { chromium } = require('playwright');
const path = require('path');
const OUT = require('os').tmpdir();
const BASE = 'http://localhost:5173/';

async function boot(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.body.innerText.includes('Loading optical assets'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await expose(page);
}
const S = { tel: '__tel', ali: '__ali', pro: '__pro', mis: '__mis' };
async function expose(page) {
  await page.evaluate(async () => {
    window.__tel = (await import('/src/store/useTelescopeStore.ts')).useTelescopeStore;
    window.__ali = (await import('/src/store/useAlignmentStore.ts')).useAlignmentStore;
    window.__pro = (await import('/src/store/useProgressStore.ts')).useProgressStore;
    window.__mis = (await import('/src/engine/missionEngine.ts')).useMissionStore;
  });
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page);

  // ── T1: Fun mode promises a perfect finder, but the legacy pixel offset stays ──
  const t1 = await page.evaluate(async (S) => {
    const tel = window[S.tel]; const ali = window[S.ali];
    tel.getState().setSimulationMode('fun');
    await new Promise((r) => setTimeout(r, 300));
    const a = ali.getState();
    return { mode: tel.getState().simulationMode, finderErrorDeg: tel.getState().finderscopeError, legacyOffsetPx: [a.offsetX, a.offsetY], isAligned: a.isAligned };
  }, S);
  console.log('T1 Fun mode finder:', JSON.stringify(t1), '→ px→deg at 250px/7.5°:', (Math.hypot(t1.legacyOffsetPx[0], t1.legacyOffsetPx[1]) / (250 / 7.5)).toFixed(2), 'deg');

  // Visual: night sky, Moon-free target (spire is fixed), show finder vs main.
  await page.evaluate(async (S) => {
    const tel = window[S.tel];
    const st = tel.getState();
    if (st.isDustCapOn) st.toggleDustCap();
    st.setTarget('spire');
  }, S);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'fun-mode-finder.png') });

  // ── T3: "aligned" ignores the angular finder error ──
  const t3 = await page.evaluate(async (S) => {
    const tel = window[S.tel]; const ali = window[S.ali];
    tel.getState().setSimulationMode('easy');
    tel.getState().setAlignmentDifficulty('realistic');
    tel.getState().scrambleFinderscope();
    ali.getState().setOffsets(0, 0);
    await new Promise((r) => setTimeout(r, 500));
    return { finderErrorDeg: tel.getState().finderscopeError, isAligned: ali.getState().isAligned };
  }, S);
  console.log('T3 scrambled finder, legacy offset zeroed:', JSON.stringify(t3));

  // ── T2: legacy mission step 2 does not advance when alignment completes ──
  const t2 = await page.evaluate(async (S) => {
    const tel = window[S.tel]; const ali = window[S.ali]; const mis = window[S.mis];
    ali.getState().setOffsets(40, 40); // misaligned again
    mis.getState().startMission('saturn_recon');
    await new Promise((r) => setTimeout(r, 300));
    if (tel.getState().isDustCapOn) tel.getState().toggleDustCap();
    // toggle cap on→off to trigger evaluation of step 1 (cap off + mirror cooled)
    tel.getState().toggleDustCap(); tel.getState().toggleDustCap();
    await new Promise((r) => setTimeout(r, 800));
    const afterStep1 = mis.getState().currentStepIndex;
    tel.getState().setTarget('spire');
    await new Promise((r) => setTimeout(r, 800));
    ali.getState().setOffsets(0, 0); // student finishes aligning the finder
    await new Promise((r) => setTimeout(r, 3000));
    const afterAlign3s = mis.getState().currentStepIndex;
    tel.getState().setFocuserPosition(tel.getState().focuserPosition + 1); // unrelated nudge
    await new Promise((r) => setTimeout(r, 800));
    const afterNudge = mis.getState().currentStepIndex;
    return { afterStep1, isAligned: ali.getState().isAligned, afterAlign3s, afterNudge };
  }, S);
  console.log('T2 Saturn Recon step index:', JSON.stringify(t2), '(step 2 = index 1 should advance to 2 on alignment)');

  // ── T4: DSO capture with the dust cap ON still produces a graded stack ──
  await page.getByRole('button', { name: /Astrophotography/i }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Deep Sky|DSO/i }).first().click().catch(() => {});
  await page.evaluate(async (S) => {
    const tel = window[S.tel];
    const st = tel.getState();
    st.setTarget('m42');
    if (!tel.getState().isDustCapOn) tel.getState().toggleDustCap();
    tel.getState().setAstroTrackingLocked(true);
  }, S);
  await page.waitForTimeout(500);
  const before = await page.evaluate(async (S) => window[S.pro].getState().logbookEntries.length, S);
  const capBtn = page.getByRole('button', { name: /Capture|Stack/i });
  const names = await capBtn.allInnerTexts();
  const target = capBtn.filter({ hasText: /stack|capture/i }).last();
  await target.click().catch((e) => console.log('click failed', e.message));
  await page.waitForTimeout(1500);
  const t4 = await page.evaluate(async (S) => {
    const p = window[S.pro].getState();
    const tel = (window[S.tel]).getState();
    return { dustCapOn: tel.isDustCapOn, motorOn: tel.isTrackingMotorOn, astroTrackingLock: tel.isAstroTrackingLocked, newest: p.logbookEntries[0] };
  }, S);
  console.log('T4 capture buttons seen:', JSON.stringify(names));
  console.log('T4 entries before', before, '→ newest:', JSON.stringify(t4));

  // ── T5: GoTo below the horizon leaves the store pointing underground ──
  const t5 = await page.evaluate(async (S) => {
    const tel = window[S.tel];
    const st = tel.getState();
    st.setSimTime(Date.UTC(2026, 10, 4, 6, 0, 0)); // midday in Jaipur
    tel.getState().setTarget('m42');
    return { pointingAlt: tel.getState().pointingAlt.toFixed(1), target: tel.getState().activeTarget.id };
  }, S);
  console.log('T5 GoTo to a set target:', JSON.stringify(t5));

  // ── T6: two tabs — progress written in tab A is clobbered by tab B ──
  const pageB = await context.newPage();
  await boot(pageB);
  await page.evaluate(async (S) => {
    window[S.pro].getState().addLogbookEntry({ id: 'tabA-entry', timestamp: Date.now(), targetId: 'moon', magnification: 48, seeingQuality: 3, tags: ['tab A'] });
  }, S);
  await page.waitForTimeout(300);
  await pageB.evaluate(async (S) => { window[S.pro].getState().unlockAchievement('tabB-achievement'); }, S);
  await pageB.waitForTimeout(300);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('telescope-progress-storage')));
  console.log('T6 after tab A logs an entry and tab B unlocks an achievement: stored entries include tab A entry?',
    stored.state.logbookEntries.some((e) => e.id === 'tabA-entry'), '| achievements:', JSON.stringify(stored.state.achievements));

  console.log('page errors:', JSON.stringify(errors.slice(0, 5)));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

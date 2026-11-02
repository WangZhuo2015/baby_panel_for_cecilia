// Component interaction tests only: synthetic test_ store, no database or external API.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = process.cwd();
const temporary = await mkdtemp(path.join(tmpdir(), 'test_feeding_food_browser_'));
let browser;
let server;
try {
  await build({
    absWorkingDir: root,
    stdin: {
      resolveDir: root, loader: 'tsx', contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { FoodLogForm } from './components/records/FoodLogForm';
        import { FeedingForm } from './components/records/FeedingFormFields';
        import { ToastProvider } from './components/ui/Toast';
        import { useBabyStore } from './stores/useBabyStore';
        const family = { id: 'test_family_food', name: 'test_family_food' };
        const baby = { id: 'test_baby_food', familyId: family.id, nickname: 'test_baby_food' };
        useBabyStore.setState({
          user: { id: 'test_user_food', username: 'test_user_food' }, family,
          families: [family], baby, babies: [baby], selectedBabyId: baby.id,
          foodItems: [], fetchFoodItems: async () => {}, fetchUser: async () => null,
        });
        window.testLoadFoods = foods => useBabyStore.setState({ foodItems: foods });
        window.testRequests = [];
        window.fetch = async (url, init = {}) => {
          window.testRequests.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
          if (String(url).startsWith('/api/nutrition/products')) return Response.json({ formulas: [] });
          if (String(url) === '/api/food/items' && init.method === 'POST') {
            const data = JSON.parse(init.body);
            if (data.familyId !== family.id || !data.name.startsWith('test_')) throw new Error('test fixture requires test_ tenant and name');
            return Response.json({ ...data, id: 'test_food_custom' });
          }
          throw new Error('Unexpected network call in component harness: ' + url);
        };
        const host = createRoot(document.getElementById('root'));
        let version = 0;
        function Commit({ revision, children }) {
          React.useLayoutEffect(() => { window.testRenderComplete = revision; }, [revision]);
          return children;
        }
        window.renderForm = (kind, data, mode = 'edit') => {
          window.testSubmission = null;
          const Form = kind === 'food' ? FoodLogForm : FeedingForm;
          const revision = ++version;
          host.render(<Commit revision={revision}><ToastProvider><Form key={revision} mode={mode} initialData={data} onSubmit={async payload => { window.testSubmission = payload; }} /></ToastProvider></Commit>);
          return revision;
        };
      `,
    },
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    outfile: path.join(temporary, 'test.js'),
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{
      name: 'unopened-next-dynamic',
      setup(builder) {
        // Unopened AI modals are outside this UI test; real form/store code is bundled.
        builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'dynamic', namespace: 'test-next' }));
        builder.onLoad({ filter: /.*/, namespace: 'test-next' }, () => ({ contents: 'export default function dynamic() { return function UnopenedModal() { return null; }; }' }));
        builder.onResolve({ filter: /(?:^|\/)QuickAiModal$/ }, () => ({ path: 'ai-modal', namespace: 'test-modal' }));
        builder.onLoad({ filter: /.*/, namespace: 'test-modal' }, () => ({ contents: 'export function QuickAiModal() { return null; }' }));
      },
    }],
  });
  const javascript = await readFile(path.join(temporary, 'test.js'));
  server = createServer((req, res) => {
    if (req.url === '/test.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(javascript); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script src="/test.js"></script>'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3089, '127.0.0.2', resolve); });
  let executablePath = chromium.executablePath();
  if (!existsSync(executablePath)) {
    const cache = path.join(homedir(), '.cache/ms-playwright');
    executablePath = readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()
      .flatMap(name => ['chrome-linux-arm64/chrome', 'chrome-linux64/chrome'].map(binary => path.join(cache, name, binary)))
      .find(binary => existsSync(binary));
    assert.ok(executablePath, 'An installed Chromium is required');
  }
  browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.2:3089' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.2:3089');
  await page.waitForFunction(() => typeof window.renderForm === 'function');
  async function render(kind, data, mode) {
    const revision = await page.evaluate(({ kind, data, mode }) => window.renderForm(kind, data, mode), { kind, data, mode });
    await page.waitForFunction(revision => window.testRenderComplete === revision, revision);
  }
  async function save(label) {
    await page.evaluate(() => { window.testSubmission = null; });
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(() => window.testSubmission !== null);
    return page.evaluate(() => window.testSubmission);
  }

  for (const type of ['formula', 'bottle_breast', 'mixed']) {
    await render('milk', { type, amountMl: 123, leftMinutes: 1, rightMinutes: 1 });
    await page.getByRole('button', { name: '奶量增加5毫升', exact: true }).click();
    assert.equal((await save('保存修改')).amountMl, 128, type);
    await page.getByRole('button', { name: '奶量减少5毫升', exact: true }).click();
    assert.equal((await save('保存修改')).amountMl, 123, type);
  }
  for (const [value, label, expected] of [[3, '奶量减少5毫升', 0], [2998, '奶量增加5毫升', 3000]]) {
    await render('milk', { type: 'formula', amountMl: value });
    await page.getByRole('button', { name: label, exact: true }).click();
    assert.equal((await save('保存修改')).amountMl, expected);
  }
  await render('milk', { type: 'breast', amountMl: 123, leftMinutes: 10, rightMinutes: 5 });
  await page.getByRole('button', { name: '预估母乳摄入量增加5毫升' }).click();
  assert.equal((await save('保存修改')).amountMl, 128);
  await page.getByRole('button', { name: '预估母乳摄入量减少5毫升' }).click();
  assert.equal((await save('保存修改')).amountMl, 123);
  await render('milk', { type: 'breast', amountMl: 0, leftMinutes: 10, rightMinutes: 5 });
  assert.equal((await save('保存修改')).amountMl, 0);
  await page.getByRole('button', { name: '预估母乳摄入量增加5毫升' }).click();
  assert.equal((await save('保存修改')).amountMl, 5);

  // The food scenarios below are deliberately data driven: old multi-item records
  // must survive opening, saving and delayed library loads without replacement.
  const components = [
    { role: 'protein', name: '鳕鱼', foodId: 'test_cod', grams: 25 },
    { role: 'protein', name: '虾', foodId: 'test_shrimp', grams: 15 },
    { role: 'vegetable', name: 'test_custom_vegetable', grams: 32 },
    { role: 'fruit', name: 'test_custom_fruit', grams: 12 },
  ];
  await render('food', { date: '2026-11-02', time: '12:00', portion: 'all', foods: components.map(item => item.name), components });
  const restored = await save('保存修改');
  assert.deepEqual(restored.foods.slice().sort(), components.map(item => item.name).sort());
  for (const item of components) assert.deepEqual(restored.components.find(value => value.name === item.name), item);
  assert.equal(restored.totalGrams, 84);
  assert.equal(restored.portion, 'all', 'opening an edit must retain the selected portion');
  await render('food', { date: '2026-11-02', time: '12:00', foods: ['test_unknown_legacy_food'] });
  assert.deepEqual((await save('保存修改')).foods, ['test_unknown_legacy_food']);

  await render('food', { date: '2026-11-02', time: '12:00', foods: [] });
  assert.equal(await page.getByRole('button', { name: /^常吃菜分类：/ }).count(), 9);
  await page.getByRole('button', { name: '选择鳕鱼', exact: true }).click();
  await page.getByRole('button', { name: '选择虾', exact: true }).click();
  await page.getByRole('spinbutton', { name: '鳕鱼克数', exact: true }).fill('35');
  await page.getByRole('button', { name: '常吃菜分类：肉禽类', exact: true }).click();
  await page.getByRole('button', { name: '选择牛肉', exact: true }).click();
  await page.getByRole('button', { name: '常吃菜分类：蔬菜菌菇', exact: true }).click();
  await page.getByRole('button', { name: '选择西兰花', exact: true }).click();
  let selection = await save('保存修改');
  assert.deepEqual(selection.foods.slice().sort(), ['鳕鱼', '虾', '牛肉', '西兰花'].sort());
  assert.equal(selection.components.find(item => item.name === '鳕鱼').grams, 35);
  assert.equal(selection.totalGrams, 110);
  await page.getByRole('spinbutton', { name: '鳕鱼克数', exact: true }).fill('350');
  assert.equal(await page.getByRole('spinbutton', { name: '鳕鱼克数', exact: true }).inputValue(), '300');
  await page.getByRole('spinbutton', { name: '鳕鱼克数', exact: true }).fill('35');
  assert.equal(await page.evaluate(() => window.testRequests.filter(request => request.method === 'POST').length), 0,
    'selecting common foods must not create tried-food records');
  await page.getByRole('button', { name: '移除虾', exact: true }).click();
  await page.getByRole('button', { name: '常吃菜分类：鱼虾海鲜', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '选择鳕鱼', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: '选择虾', exact: true }).getAttribute('aria-pressed'), 'false');
  await page.getByRole('button', { name: '选择鳕鱼', exact: true }).click();
  selection = await save('保存修改');
  assert.deepEqual(selection.foods.slice().sort(), ['牛肉', '西兰花'].sort());

  await page.getByRole('button', { name: '+ 自定义食材', exact: true }).click();
  await page.getByRole('button', { name: '自定义食材分类：蔬菜菌菇', exact: true }).click();
  await page.getByPlaceholder('输入食材名称，如：山药、猪肝、三文鱼…').fill('test_custom_green');
  await page.getByRole('button', { name: '确认添加', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'test_custom_green克数', exact: true }).waitFor();
  selection = await save('保存修改');
  assert.ok(selection.foods.includes('test_custom_green'));
  assert.equal(selection.components.find(item => item.name === 'test_custom_green').role, 'vegetable');
  const posted = await page.evaluate(() => window.testRequests.find(request => request.method === 'POST'));
  assert.equal(posted.body.category, 'vegetable');
  assert.equal(posted.body.familyId, 'test_family_food');

  // A later family library response may add/reorder options without changing
  // the selected meal or losing a custom entry from the previous save.
  await page.evaluate(() => window.testLoadFoods([
    { id: 'test_food_delayed', name: 'test_delayed_meat', category: 'protein', status: 'tried' },
  ]));
  assert.deepEqual((await save('保存修改')).foods.slice().sort(), selection.foods.slice().sort());

  await page.evaluate(() => window.testLoadFoods([]));
  await render('food', {}, 'create');
  // Select cod through the actual protein wheel, then insert family options in
  // front of the common options. A numeric selection index used to drift here.
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await page.getByRole('spinbutton', { name: '鳕鱼克数', exact: true }).count()) break;
    await page.getByTitle('下一个', { exact: true }).nth(1).click();
  }
  assert.equal(await page.getByRole('spinbutton', { name: '鳕鱼克数', exact: true }).count(), 1);
  await page.getByRole('spinbutton', { name: '肉蛋 · 蛋白精准克数', exact: true }).fill('350');
  assert.equal(await page.getByRole('spinbutton', { name: '肉蛋 · 蛋白精准克数', exact: true }).inputValue(), '300');
  const wheelSelection = await save('保存辅食记录');
  await page.evaluate(() => window.testLoadFoods([
    { id: 'test_food_late_b', name: 'test_late_meat_b', category: 'protein', status: 'tried' },
    { id: 'test_food_late_a', name: 'test_late_meat_a', category: 'protein', status: 'tried' },
  ]));
  assert.deepEqual((await save('保存辅食记录')).foods, wheelSelection.foods);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await page.getByRole('spinbutton', { name: 'test_late_meat_a克数', exact: true }).count()) break;
    await page.getByTitle('下一个', { exact: true }).nth(1).click();
  }
  assert.equal(await page.getByRole('spinbutton', { name: 'test_late_meat_a克数', exact: true }).count(), 1);
  const familyWheelSelection = await save('保存辅食记录');
  await page.evaluate(() => window.testLoadFoods([
    { id: 'test_food_late_a', name: 'test_late_meat_a', category: 'protein', status: 'tried' },
    { id: 'test_food_late_b', name: 'test_late_meat_b', category: 'protein', status: 'tried' },
  ]));
  assert.deepEqual((await save('保存辅食记录')).foods, familyWheelSelection.foods);
  await render('food', { foods: Array.from({ length: 21 }, (_, index) => 'test_food_' + index) });
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByText('每条辅食记录最多选择20种食材，请分成多条记录保存', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.testSubmission), null);
  await render('food', { foods: ['test_food_one'], hasAbnormal: true, abnormalNotes: 'test_'.repeat(250) });
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByText('本餐食材信息或异常说明过长，请减少食材或缩短说明后保存', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.testSubmission), null);
  assert.deepEqual(errors, []);
  console.log('PASS: 5 ml controls in all feeding modes, bounds, historical values, 9 food categories, cross-category multi-select, weights, removal, custom category, delayed library and legacy edits');
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}

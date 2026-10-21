const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const project = path.resolve(__dirname, '../shortcut-hub');
const testFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcut-hub-api-'));
const database = path.join(testFolder, 'nested', 'test.db');
const validUrl = 'https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef';
const deletePassword = 'api-regression-delete-password';
const base = { title: 'テスト投稿', description: '説明文', category: '便利ツール', url: validUrl, author: '投稿者', delete_password: deletePassword };
let child;
let origin;
let port;
let attempts = 0;
let passed = 0;
const stored = [];
const logs = [];

async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve));
  const availablePort = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return availablePort;
}

async function stop() {
  if (!child) return;
  const previousChild = child;
  child = null;
  const exited = new Promise(resolve => previousChild.once('exit', resolve));
  previousChild.kill();
  await exited;
}

async function start() {
  await stop();
  attempts = 0;
  child = spawn(process.execPath, ['server.js'], {
    cwd: project,
    env: { ...process.env, PORT: String(port), DATABASE_PATH: database },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', text => logs.push(String(text)));
  child.stderr.on('data', text => logs.push(String(text)));
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${logs.join('')}`);
    try {
      const response = await fetch(`${origin}/api/shortcuts`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Server startup timeout: ${logs.join('')}`);
}

async function post(body, { expected = 400, headers, raw = false, batch = true } = {}) {
  if (batch && attempts >= 5) await start();
  attempts += 1;
  const response = await fetch(`${origin}/api/shortcuts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: raw ? body : JSON.stringify(body)
  });
  const value = await response.json();
  assert.equal(response.status, expected, JSON.stringify(value));
  if (expected === 201) stored.push(value);
  else assert.equal(typeof value.error, 'string');
  return { response, value };
}

async function rejectChange(name, patch) {
  await check(name, async () => { await post({ ...base, ...patch }); });
}

async function main() {
  for (const file of ['server.js', 'public/app.js']) {
    await check(`syntax ${file}`, () => {
      const result = spawnSync(process.execPath, ['--check', path.join(project, file)], { encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
    });
  }
  port = await freePort();
  assert.ok(![3000, 3100].includes(port));
  origin = `http://127.0.0.1:${port}`;
  await start();
  await check('GET starts empty and creates nested database', async () => {
    assert.ok(fs.existsSync(database));
    const response = await fetch(`${origin}/api/shortcuts`);
    assert.deepEqual(await response.json(), []);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  await check('valid post is trimmed and preserved with integer ID and UTC date', async () => {
    const { value } = await post({ title: '  買い物メモ  ', description: '  1行目\n2行目  ', category: ' 勉強 ', url: `  ${validUrl}  `, author: '  山田太郎  ', delete_password: deletePassword }, { expected: 201 });
    assert.deepEqual(Object.keys(value).sort(), ['id', 'title', 'description', 'category', 'url', 'author', 'created_at', 'can_delete'].sort());
    assert.ok(value.can_delete);
    assert.equal(value.title, '買い物メモ');
    assert.equal(value.description, '1行目\n2行目');
    assert.equal(value.category, '勉強');
    assert.equal(value.url, validUrl);
    assert.equal(value.author, '山田太郎');
    assert.ok(Number.isInteger(value.id) && value.id > 0);
    assert.match(value.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(Math.abs(Date.now() - Date.parse(value.created_at)) < 10000);
  });
  await check('optional author defaults to empty string', async () => {
    const { author, ...withoutAuthor } = base;
    const { value } = await post(withoutAuthor, { expected: 201 });
    assert.equal(value.author, '');
  });
  await check('maximum lengths 50 / 300 / 30 are accepted', async () => {
    const fields = { title: 'あ'.repeat(50), description: '説'.repeat(300), author: '名'.repeat(30) };
    const { value } = await post({ ...base, ...fields }, { expected: 201 });
    for (const key of Object.keys(fields)) assert.equal(value[key], fields[key]);
  });
  await rejectChange('title 51 rejected', { title: 'a'.repeat(51) });
  await rejectChange('description 301 rejected', { description: 'a'.repeat(301) });
  await rejectChange('author 31 rejected', { author: 'a'.repeat(31) });
  await rejectChange('empty title rejected', { title: '  \n ' });
  await rejectChange('empty description rejected', { description: '\t ' });
  await rejectChange('empty URL rejected', { url: '' });
  for (const field of ['title', 'description', 'category', 'url']) {
    await check(`missing ${field} rejected`, async () => {
      const input = { ...base };
      delete input[field];
      await post(input);
    });
  }
  for (const [field, value] of [['title', 1], ['description', {}], ['category', null], ['url', []], ['author', false], ['author', null]]) {
    await rejectChange(`invalid type ${field} ${JSON.stringify(value)} rejected`, { [field]: value });
  }
  for (const body of [null, [], 'string', 1]) {
    await check(`invalid top-level JSON ${JSON.stringify(body)} rejected`, async () => { await post(body); });
  }
  await rejectChange('unknown category rejected', { category: '料理' });
  for (const category of ['仕事効率化', 'エンタメ', 'その他']) {
    await check(`category ${category} accepted`, async () => {
      const { value } = await post({ ...base, category }, { expected: 201 });
      assert.equal(value.category, category);
    });
  }
  const badUrls = [
    ['HTTP scheme', validUrl.replace('https:', 'http:')],
    ['non-www host', validUrl.replace('www.', '')],
    ['host suffix', validUrl.replace('www.icloud.com', 'www.icloud.com.evil.test')],
    ['credential misleading host', validUrl.replace('www.icloud.com', 'www.icloud.com@evil.test')],
    ['credentials on valid host', validUrl.replace('www.icloud.com', 'user:pass@www.icloud.com')],
    ['explicit HTTPS port', validUrl.replace('www.icloud.com', 'www.icloud.com:443')],
    ['nonstandard port', validUrl.replace('www.icloud.com', 'www.icloud.com:444')],
    ['dot path normalization', validUrl.replace('/shortcuts/', '/other/../shortcuts/')],
    ['backslash normalization', validUrl.replace('/shortcuts/', '\\shortcuts\\')],
    ['query', `${validUrl}?x=1`],
    ['hash', `${validUrl}#x`],
    ['empty query marker', `${validUrl}?`],
    ['empty hash marker', `${validUrl}#`],
    ['trailing slash', `${validUrl}/`],
    ['short ID', validUrl.slice(0, -1)],
    ['non-hex ID', `${validUrl.slice(0, -1)}g`],
    ['percent encoded ID', validUrl.replace('0123', '%30123')],
    ['host trailing dot', validUrl.replace('www.icloud.com', 'www.icloud.com.')],
    ['embedded whitespace', validUrl.replace('/shortcuts/', '/short\ncuts/')]
  ];
  for (const [name, url] of badUrls) await rejectChange(`URL ${name} rejected`, { url });
  await check('uppercase hexadecimal ID accepted', async () => {
    const url = validUrl.slice(0, -32) + validUrl.slice(-32).toUpperCase();
    const { value } = await post({ ...base, url }, { expected: 201 });
    assert.equal(value.url, url);
  });
  await check('non-JSON media type returns 415', async () => {
    await post('title=test', { expected: 415, raw: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  });
  await check('malformed JSON returns 400', async () => { await post('{broken', { raw: true }); });
  await check('body larger than 8kb returns 413', async () => {
    await post({ ...base, description: 'x'.repeat(10000) }, { expected: 413 });
  });
  await check('SQL injection and markup stored as text; table survives', async () => {
    const title = "'); DROP TABLE shortcuts;--";
    const description = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    const { value } = await post({ ...base, title, description }, { expected: 201 });
    assert.equal(value.title, title);
    assert.equal(value.description, description);
    const response = await fetch(`${origin}/api/shortcuts`);
    const list = await response.json();
    assert.ok(list.some(row => row.id === value.id && row.description === description));
  });
  await check('listing has only saved rows and newest first with ID tie breaker', async () => {
    const response = await fetch(`${origin}/api/shortcuts`);
    const list = await response.json();
    assert.equal(list.length, stored.length);
    for (let i = 1; i < list.length; i += 1) {
      assert.ok(list[i - 1].created_at > list[i].created_at || (list[i - 1].created_at === list[i].created_at && list[i - 1].id > list[i].id));
    }
    assert.deepEqual(list.map(row => row.id), stored.map(row => row.id).reverse());
  });
  for (const pathname of ['/data/shortcuts.db', '/data', '/server.js', '/package.json', '/.env', '/%2e%2e/server.js']) {
    await check(`private path ${pathname} is not served`, async () => {
      const response = await fetch(`${origin}${pathname}`);
      assert.equal(response.status, 404);
    });
  }
  await check('public HTML CSS JS and security headers are served', async () => {
    for (const pathname of ['/', '/style.css', '/app.js']) {
      const response = await fetch(`${origin}${pathname}`);
      assert.equal(response.status, 200);
      assert.ok((await response.text()).length > 20);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(response.headers.get('content-security-policy').includes("script-src 'self'"));
    }
  });
  await check('unknown API returns JSON 404', async () => {
    const response = await fetch(`${origin}/api/missing`);
    assert.equal(response.status, 404);
    assert.equal(typeof (await response.json()).error, 'string');
  });
  await start();
  await check('restarting server preserves database records', async () => {
    const response = await fetch(`${origin}/api/shortcuts`);
    const list = await response.json();
    assert.equal(list.length, stored.length);
    assert.deepEqual(list.map(row => row.id), stored.map(row => row.id).reverse());
  });
  await check('invalid attempts count toward five requests; sixth returns 429 and Retry-After', async () => {
    for (let i = 0; i < 5; i += 1) await post({ ...base, title: '' }, { batch: false });
    const { response } = await post(base, { expected: 429, batch: false });
    const retryAfter = Number(response.headers.get('retry-after'));
    assert.ok(Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 600);
  });
  await check('forged X-Forwarded-For cannot bypass post limit', async () => {
    await post(base, { expected: 429, batch: false, headers: { 'X-Forwarded-For': '198.51.100.42' } });
  });
  console.log(`RESULT ${passed} checks passed. Node ${process.version}. Port ${port}. Saved rows ${stored.length}. Temporary database: ${database}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await stop();
  console.log('Child server stopped. Temporary database retained outside project for evidence.');
});

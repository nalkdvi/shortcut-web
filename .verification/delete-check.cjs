const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const project = path.resolve(__dirname, '../shortcut-hub');
const Database = require(path.join(project, 'node_modules/better-sqlite3'));
const testFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcut-hub-owner-delete-'));
const database = path.join(testFolder, 'isolated.db');
const secret = 'owner-A-test-delete-secret-672e27a3';
const secondSecret = 'owner-B-test-delete-secret-16558cf3';
const urls = [1, 2, 3].map(n => `https://www.icloud.com/shortcuts/${String(n).padStart(32, '0')}`);
const base = { title: '削除検証用', description: '実際の投稿ではありません。', category: '便利ツール', url: urls[0], author: 'テスト', delete_password: secret };
const logs = [];
let child;
let port;
let origin;
let passed = 0;
let attempts = 0;
let postAttempts = 0;
let groupId;
let singleId;

async function check(name, action) {
  await action();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve));
  const available = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return available;
}

async function stop() {
  if (!child) return;
  const previous = child;
  child = null;
  if (previous.exitCode !== null) return;
  const exited = new Promise(resolve => previous.once('exit', resolve));
  previous.kill();
  await exited;
}

async function start() {
  await stop();
  attempts = 0;
  postAttempts = 0;
  child = spawn(process.execPath, ['server.js'], {
    cwd: project,
    env: { ...process.env, PORT: String(port), DATABASE_PATH: database },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', data => logs.push(String(data)));
  child.stderr.on('data', data => logs.push(String(data)));
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${logs.join('')}`);
    try {
      const response = await fetch(`${origin}/api/shortcuts`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Startup timed out: ${logs.join('')}`);
}

async function list() {
  const response = await fetch(`${origin}/api/shortcuts`);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes(secret) && !text.includes(secondSecret));
  return JSON.parse(text);
}

async function post(patch, expected = 201, noRestart = false) {
  if (postAttempts >= 5 && !noRestart) await start();
  postAttempts += 1;
  const response = await fetch(`${origin}/api/shortcuts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, ...patch })
  });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  assert.ok(!JSON.stringify(result).includes(secret));
  if (expected !== 201) assert.equal(typeof result.error, 'string');
  return result;
}

async function remove(id, body = { password: secret }, expected = 200, options = {}) {
  if (attempts >= 5 && !options.noRestart) await start();
  attempts += 1;
  const response = await fetch(`${origin}/api/shortcuts/${id}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.raw ? body : JSON.stringify(body)
  });
  const text = await response.text();
  assert.ok(!text.includes(secret) && !text.includes(secondSecret), 'Response must not echo a password.');
  const result = JSON.parse(text);
  const statuses = Array.isArray(expected) ? expected : [expected];
  assert.ok(statuses.includes(response.status), `Expected ${statuses}, got ${response.status}: ${text}`);
  if (!response.ok) assert.equal(typeof result.error, 'string');
  return { response, result };
}

async function rejectUnchanged(name, id, body, expected, options) {
  await check(name, async () => {
    const before = await list();
    await remove(id, body, expected, options);
    assert.deepEqual(await list(), before, 'Rejected deletion changed the database.');
  });
}

async function main() {
  for (const filename of ['server.js', 'deletion.js', 'public/app.js', 'public/delete.js']) {
    await check(`syntax ${filename}`, () => {
      const result = spawnSync(process.execPath, ['--check', path.join(project, filename)], { encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
    });
  }
  const fixture = new Database(database);
  fixture.exec(`CREATE TABLE shortcuts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
    description TEXT NOT NULL, category TEXT NOT NULL, url TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  fixture.prepare('INSERT INTO shortcuts (title, description, category, url, author, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('LEGACY既存投稿', '仕様変更前のデータ', '勉強', urls[0], '', '2020-01-01T00:00:00.000Z');
  fixture.close();
  port = await freePort();
  assert.ok(![3000, 3100].includes(port));
  origin = `http://127.0.0.1:${port}`;
  await start();

  await check('seven-column legacy database migrates automatically without assigning deletion rights', async () => {
    const rows = await list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'LEGACY既存投稿');
    assert.equal(Boolean(rows[0].can_delete), false);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['id', 'title', 'description', 'category', 'url', 'author', 'created_at', 'can_delete'].sort());
    const inspect = new Database(database, { readonly: true });
    try {
      assert.ok(inspect.prepare('PRAGMA table_info(shortcuts)').all().some(column => column.name === 'delete_password_hash'));
      assert.equal(inspect.prepare('SELECT delete_password_hash FROM shortcuts WHERE id = 1').get().delete_password_hash, null);
    } finally { inspect.close(); }
  });
  await check('single URL owner B post remains compatible and exposes only can_delete flag', async () => {
    const result = await post({ title: '単一URLの投稿', delete_password: secondSecret });
    singleId = result.id;
    assert.equal(result.url, urls[0]);
    assert.ok(result.can_delete);
    assert.ok(!Object.hasOwn(result, 'delete_password') && !Object.hasOwn(result, 'delete_password_hash'));
  });
  await check('owner A three-URL post saves one row with ordered links', async () => {
    const result = await post({ title: '3つのリンクの投稿', url: urls.join('\n') });
    groupId = result.id;
    assert.equal(result.url, urls.join('\n'));
    assert.equal((await list()).length, 3);
  });

  for (const [label, password] of [['missing', undefined], ['null', null], ['number', 1], ['boolean', true], ['array', []], ['object', {}], ['empty', ''], ['7 characters', 'a'.repeat(7)], ['129 characters', 'a'.repeat(129)], ['whitespace only', ' '.repeat(10)]]) {
    await check(`POST ${label} deletion password rejected without saving`, async () => {
      const before = await list();
      await post({ delete_password: password }, 400);
      assert.deepEqual(await list(), before);
    });
  }
  await check('POST exactly 8 characters accepted', async () => {
    const result = await post({ title: '8文字パスワード', delete_password: 'eight888' });
    assert.ok(result.can_delete);
  });
  await check('POST exactly 128 characters accepted', async () => {
    const result = await post({ title: '128文字パスワード', delete_password: 'x'.repeat(128) });
    assert.ok(result.can_delete);
  });
  await check('same password uses different salted hashes; plain text never stored or returned', async () => {
    const other = await post({ title: '同一パスワードの別投稿' });
    const inspect = new Database(database, { readonly: true });
    try {
      const firstHash = inspect.prepare('SELECT delete_password_hash FROM shortcuts WHERE id = ?').get(groupId).delete_password_hash;
      const secondHash = inspect.prepare('SELECT delete_password_hash FROM shortcuts WHERE id = ?').get(other.id).delete_password_hash;
      assert.equal(typeof firstHash, 'string');
      assert.ok(firstHash.includes(':'));
      assert.notEqual(firstHash, secondHash);
      assert.ok(!firstHash.includes(secret) && !secondHash.includes(secret));
      const publicJson = JSON.stringify(await list());
      assert.ok(!publicJson.includes(firstHash) && !publicJson.includes(secondHash));
    } finally { inspect.close(); }
  });
  await check('nonblank leading and trailing password spaces are preserved exactly', async () => {
    const spaced = '  space-sensitive-password  ';
    const result = await post({ title: '空白を含むパスワード', delete_password: spaced });
    await remove(result.id, { password: spaced.trim() }, 401);
    assert.ok((await list()).some(row => row.id === result.id));
    await remove(result.id, { password: spaced }, 200);
    assert.ok(!(await list()).some(row => row.id === result.id));
  });

  await rejectUnchanged('missing deletion password rejected with 400', groupId, {}, 400);
  await rejectUnchanged('wrong valid-length password rejected with 401', groupId, { password: 'wrong-test-password' }, 401);
  await rejectUnchanged('owner A password cannot delete owner B post', singleId, { password: secret }, 401);
  await rejectUnchanged('owner B password cannot delete owner A post', groupId, { password: secondSecret }, 401);
  for (const password of [null, 1, true, [], {}, '', '1234567', 'x'.repeat(129), ' '.repeat(10)]) {
    await rejectUnchanged(`invalid DELETE password ${JSON.stringify(password)} rejected`, groupId, { password }, 400);
  }
  for (const body of [null, [], 'string', 1]) {
    await rejectUnchanged(`invalid top-level JSON ${JSON.stringify(body)} controlled`, groupId, body, 400);
  }
  await rejectUnchanged('non-JSON body rejected with 415', groupId, 'password=wrong', 415,
    { raw: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  await rejectUnchanged('malformed JSON rejected with 400', groupId, '{broken', 400, { raw: true });
  await rejectUnchanged('body exceeding 1kb rejected with 413', groupId, { password: 'x'.repeat(3000) }, 413);
  await rejectUnchanged('nonexistent post returns 404', 999999, { password: secret }, 404);
  await rejectUnchanged('legacy NULL password cannot be used or assigned by DELETE', 1, { password: secret }, 403);
  for (const id of ['0', '-1', '1.5', '1e2', '9007199254740992', encodeURIComponent('1 OR 1=1'), encodeURIComponent("1'; DROP TABLE shortcuts;--")]) {
    await rejectUnchanged(`invalid ID ${id} rejected safely`, id, { password: secret }, 400);
  }
  await check('passwords not exposed through static files or server source', async () => {
    for (const pathname of ['/', '/app.js', '/delete.js', '/.env', '/.env.example', '/deletion.js', '/server.js']) {
      const response = await fetch(`${origin}${pathname}`);
      const text = await response.text();
      assert.ok(!text.includes(secret) && !text.includes(secondSecret), pathname);
      if (['/.env', '/.env.example', '/deletion.js', '/server.js'].includes(pathname)) assert.equal(response.status, 404);
    }
  });
  await check('matching owner password deletes only chosen three-link row', async () => {
    const before = await list();
    const { result } = await remove(groupId);
    assert.equal(typeof result.message, 'string');
    const after = await list();
    assert.deepEqual(after, before.filter(row => row.id !== groupId));
    const inspect = new Database(database, { readonly: true });
    try { assert.equal(inspect.prepare('SELECT * FROM shortcuts WHERE id = ?').get(groupId), undefined); }
    finally { inspect.close(); }
  });
  await check('deletion and untouched rows persist after restart with idempotent migration', async () => {
    const before = await list();
    await start();
    assert.deepEqual(await list(), before);
    assert.ok(!before.some(row => row.id === groupId));
    assert.ok(before.some(row => row.id === singleId));
    assert.ok(before.some(row => row.id === 1));
    const inspect = new Database(database, { readonly: true });
    try { assert.equal(inspect.prepare('PRAGMA table_info(shortcuts)').all().filter(column => column.name === 'delete_password_hash').length, 1); }
    finally { inspect.close(); }
  });
  await rejectUnchanged('repeating successful deletion returns 404', groupId, { password: secret }, 404);

  await start();
  await check('five wrong attempts count; sixth matching attempt receives 429 and Retry-After', async () => {
    const before = await list();
    for (let i = 0; i < 5; i += 1) await remove(singleId, { password: 'wrong-test-password' }, 401, { noRestart: true });
    const { response } = await remove(singleId, { password: secondSecret }, 429, { noRestart: true });
    const retry = Number(response.headers.get('retry-after'));
    assert.ok(Number.isInteger(retry) && retry > 0 && retry <= 600);
    assert.deepEqual(await list(), before);
  });
  await rejectUnchanged('forged X-Forwarded-For does not bypass deletion limit', singleId, { password: secondSecret }, 429,
    { noRestart: true, headers: { 'X-Forwarded-For': '198.51.100.91' } });
  await check('delete limit does not block posting API', async () => {
    const result = await post({ title: '削除制限後も投稿できる' }, 201, true);
    assert.ok((await list()).some(row => row.id === result.id));
  });
  await start();
  await check('owner B can still delete own post after restart', async () => {
    const before = await list();
    await remove(singleId, { password: secondSecret });
    assert.deepEqual(await list(), before.filter(row => row.id !== singleId));
  });
  await check('server logs never contain either password', async () => {
    await stop();
    assert.ok(!logs.join('').includes(secret) && !logs.join('').includes(secondSecret));
  });
  console.log(`RESULT ${passed} owner-only deletion checks passed. Node ${process.version}. Port ${port}. Temporary DB: ${database}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await stop();
  console.log('Child server stopped. Only isolated temporary database was changed.');
});

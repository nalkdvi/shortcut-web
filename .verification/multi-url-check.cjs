const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const project = path.resolve(__dirname, '../shortcut-hub');
const Database = require(path.join(project, 'node_modules/better-sqlite3'));
const testFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcut-hub-multi-url-'));
const database = path.join(testFolder, 'test.db');
const urls = Array.from({ length: 11 }, (_, i) => `https://www.icloud.com/shortcuts/${(i + 1).toString(16).padStart(32, '0')}`);
const base = { title: 'まとめて導入するショートカット', description: '3つのショートカットで1つの機能を作ります。', category: '便利ツール', author: '確認用', url: urls[0], delete_password: 'multi-regression-delete-password' };
const legacyTitle = '既存の単一リンク投稿';
const logs = [];
let child;
let origin;
let port;
let attempts = 0;
let passed = 0;
let groupId;

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
  child = spawn(process.execPath, ['server.js'], {
    cwd: project,
    env: { ...process.env, PORT: String(port), DATABASE_PATH: database },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', value => logs.push(String(value)));
  child.stderr.on('data', value => logs.push(String(value)));
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${logs.join('')}`);
    try {
      const response = await fetch(`${origin}/api/shortcuts`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Startup timeout: ${logs.join('')}`);
}

async function list() {
  const response = await fetch(`${origin}/api/shortcuts`);
  assert.equal(response.status, 200);
  return response.json();
}

async function post(body, expected = 400) {
  if (attempts >= 5) await start();
  attempts += 1;
  const response = await fetch(`${origin}/api/shortcuts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  if (expected !== 201) assert.equal(typeof result.error, 'string');
  return result;
}

async function rejectWithoutSave(name, url) {
  await check(name, async () => {
    const before = await list();
    await post({ ...base, url });
    assert.deepEqual(await list(), before, 'An invalid group must not save any rows.');
  });
}

async function main() {
  const fixture = new Database(database);
  fixture.exec(`CREATE TABLE shortcuts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    url TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  fixture.prepare('INSERT INTO shortcuts (title, description, category, url, author, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(legacyTitle, '仕様変更前から保存されている投稿', '勉強', urls[10], '', '2020-01-01T00:00:00.000Z');
  fixture.close();
  port = await freePort();
  assert.ok(![3000, 3100].includes(port));
  origin = `http://127.0.0.1:${port}`;
  await start();

  await check('existing database and single-URL row are retained during password-column migration', async () => {
    const rows = await list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 1);
    assert.equal(rows[0].title, legacyTitle);
    assert.equal(rows[0].url, urls[10]);
    assert.equal(Boolean(rows[0].can_delete), false);
  });
  await check('three URLs with CRLF, spaces and blank lines normalize in input order as one row', async () => {
    const result = await post({ ...base, url: `  ${urls[0]} \r\n\r\n ${urls[1]}\r\n \r\n${urls[2]}  \r\n` }, 201);
    groupId = result.id;
    assert.equal(result.url, urls.slice(0, 3).join('\n'));
    assert.equal(result.title, base.title);
    const rows = await list();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, groupId);
    assert.equal(rows[0].url, result.url);
    assert.equal(rows[1].id, 1);
  });
  await check('raw SQLite keeps three ordered links in one unchanged url TEXT column', async () => {
    const inspect = new Database(database, { readonly: true });
    try {
      const columns = inspect.prepare('PRAGMA table_info(shortcuts)').all();
      assert.deepEqual(columns.map(column => column.name), ['id', 'title', 'description', 'category', 'url', 'author', 'created_at', 'delete_password_hash']);
      assert.equal(columns.find(column => column.name === 'url').type, 'TEXT');
      assert.equal(inspect.prepare('SELECT url FROM shortcuts WHERE id = ?').get(groupId).url, urls.slice(0, 3).join('\n'));
      assert.equal(inspect.prepare('SELECT COUNT(*) AS count FROM shortcuts').get().count, 2);
    } finally { inspect.close(); }
  });
  await check('maximum ten URLs are accepted in order', async () => {
    const result = await post({ ...base, title: '10本のショートカット', url: urls.slice(0, 10).join('\n') }, 201);
    assert.equal(result.url, urls.slice(0, 10).join('\n'));
  });
  await check('legacy single URL POST still works', async () => {
    const result = await post({ ...base, title: '単一リンクの新規投稿', url: `  ${urls[4]}  ` }, 201);
    assert.equal(result.url, urls[4]);
  });

  await rejectWithoutSave('zero URLs rejected atomically', '');
  await rejectWithoutSave('only whitespace and blank lines rejected atomically', ' \r\n \n\t');
  await rejectWithoutSave('eleven URLs rejected atomically', urls.join('\n'));
  await rejectWithoutSave('middle URL with evil host rejected atomically', `${urls[0]}\nhttps://evil.test/shortcuts/${'a'.repeat(32)}\n${urls[2]}`);
  const invalidLaterUrls = [
    ['HTTP scheme', urls[1].replace('https:', 'http:')],
    ['host suffix', urls[1].replace('www.icloud.com', 'www.icloud.com.evil.test')],
    ['credentials', urls[1].replace('www.icloud.com', 'user:pass@www.icloud.com')],
    ['misleading credentials host', urls[1].replace('www.icloud.com', 'www.icloud.com@evil.test')],
    ['explicit port', urls[1].replace('www.icloud.com', 'www.icloud.com:443')],
    ['alternate path', urls[1].replace('/shortcuts/', '/other/')],
    ['normalized path traversal', urls[1].replace('/shortcuts/', '/other/../shortcuts/')],
    ['query', `${urls[1]}?x=1`],
    ['empty query marker', `${urls[1]}?`],
    ['hash', `${urls[1]}#x`],
    ['trailing slash', `${urls[1]}/`],
    ['short identifier', urls[1].slice(0, -1)],
    ['non-hex identifier', urls[1].slice(0, -1) + 'g'],
    ['two links in one line', `${urls[1]} ${urls[2]}`]
  ];
  for (const [label, invalid] of invalidLaterUrls) {
    await rejectWithoutSave(`later URL ${label} rejected atomically`, `${urls[0]}\n${invalid}`);
  }
  for (const invalid of [null, [], [urls[0], urls[1]], {}, 1, true]) {
    await rejectWithoutSave(`invalid URL type ${JSON.stringify(invalid)} rejected atomically`, invalid);
  }
  await check('restart preserves grouped and existing posts and newest order', async () => {
    const before = await list();
    await start();
    const after = await list();
    assert.deepEqual(after, before);
    assert.equal(after.length, 4);
    assert.equal(after.find(row => row.id === groupId).url, urls.slice(0, 3).join('\n'));
    assert.equal(after.at(-1).title, legacyTitle);
    for (let i = 1; i < after.length; i += 1) {
      assert.ok(after[i - 1].created_at > after[i].created_at || (after[i - 1].created_at === after[i].created_at && after[i - 1].id > after[i].id));
    }
  });
  console.log(`RESULT ${passed} multi-URL checks passed. Port ${port}. Temporary DB: ${database}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await stop();
  console.log('Child server stopped. Default database untouched.');
});

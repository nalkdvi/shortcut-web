const express = require('express');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const { isIP } = require('node:net');
const { registerDeletion, hashPassword } = require('./deletion');

const app = express();
const port = Number(process.env.PORT || 3000);
// 通常は0（転送ヘッダーを信頼しない）。公開先の実際のプロキシ数だけ指定する。
const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 10
    || process.env.TRUST_PROXY_HOPS?.trim() === '') {
  throw new Error('TRUST_PROXY_HOPSは0〜10の整数で指定してください。');
}
app.set('trust proxy', proxyHops);
const useRailwayProxy = process.env.TRUST_RAILWAY_PROXY === 'true';
const categories = ['便利ツール', '勉強', '仕事効率化', 'エンタメ', 'その他'];
const databasePath = path.resolve(
  __dirname,
  process.env.DATABASE_PATH || 'data/shortcuts.db'
);

// 保存用フォルダとテーブルは、初回起動時に自動で作る。
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.exec(`
  CREATE TABLE IF NOT EXISTS shortcuts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    url TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    delete_password_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )
`);

// 既存の投稿を残したまま、新しい保存項目だけを追加する。
const columns = db.prepare('PRAGMA table_info(shortcuts)').all();
if (!columns.some((column) => column.name === 'delete_password_hash')) {
  db.exec('ALTER TABLE shortcuts ADD COLUMN delete_password_hash TEXT');
}

// パスワードのハッシュは、一覧や投稿結果に含めない。
const publicColumns = `id, title, description, category, url, author, created_at,
  (delete_password_hash IS NOT NULL) AS can_delete`;
const listShortcuts = db.prepare(
  `SELECT ${publicColumns} FROM shortcuts ORDER BY created_at DESC, id DESC`
);
// 入力値はSQLに連結せず、? の位置へ渡す。
const insertShortcut = db.prepare(`
  INSERT INTO shortcuts (title, description, category, url, author, delete_password_hash)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const findShortcut = db.prepare(`SELECT ${publicColumns} FROM shortcuts WHERE id = ?`);

app.disable('x-powered-by');
// Railwayの公開HTTP経由と設定した場合だけ、上書き済みのIPヘッダーを使う。
app.use((req, res, next) => {
  const realIp = req.get('x-real-ip') || '';
  req.clientIp = useRailwayProxy && isIP(realIp) ? realIp : req.ip;
  next();
});
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join('; '));
  next();
});

const postAttempts = new Map();
const postWindowMs = 10 * 60 * 1000;
const maxPostAttempts = 5;

// 同じIPからの投稿試行を10分間に5回までにする。
function limitPosts(req, res, next) {
  const now = Date.now();
  const ip = req.clientIp;
  let record = postAttempts.get(ip);
  if (!record || now >= record.resetAt) {
    record = { count: 0, resetAt: now + postWindowMs };
    postAttempts.set(ip, record);
  }
  if (record.count >= maxPostAttempts) {
    res.setHeader('Retry-After', Math.ceil((record.resetAt - now) / 1000));
    return res.status(429).json({ error: '投稿回数の上限です。10分ほど待ってからお試しください。' });
  }
  record.count += 1;
  next();
}

// 古い記録を消して、メモリに残り続けないようにする。
const cleanupTimer = setInterval(() => {
  for (const [ip, record] of postAttempts) {
    if (Date.now() >= record.resetAt) postAttempts.delete(ip);
  }
}, postWindowMs);
cleanupTimer.unref();

function isValidShortcutUrl(value) {
  // 余分なパス、クエリ、偽のホスト名なども拒否する。
  if (!/^https:\/\/www\.icloud\.com\/shortcuts\/[a-fA-F0-9]{32}$/.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.icloud.com'
      && /^\/shortcuts\/[a-fA-F0-9]{32}$/.test(url.pathname)
      && !url.username && !url.password && !url.port && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function validateShortcut(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: '投稿内容の形式が正しくありません。' };
  }
  for (const field of ['title', 'description', 'category', 'url']) {
    if (typeof body[field] !== 'string') {
      return { error: '必須項目を文字列で入力してください。' };
    }
  }
  if (body.author !== undefined && typeof body.author !== 'string') {
    return { error: '投稿者名を文字列で入力してください。' };
  }
  if (typeof body.delete_password !== 'string' || body.delete_password.length < 8
      || body.delete_password.length > 128 || !body.delete_password.trim()) {
    return { error: '削除用パスワードは空白だけにせず、8〜128文字で入力してください。' };
  }

  const shortcut = {
    title: body.title.trim(),
    description: body.description.trim(),
    category: body.category.trim(),
    url: body.url.trim(),
    author: (body.author || '').trim()
  };
  if (!shortcut.title || shortcut.title.length > 50) {
    return { error: 'タイトルは1〜50文字で入力してください。' };
  }
  if (!shortcut.description || shortcut.description.length > 300) {
    return { error: '説明は1〜300文字で入力してください。' };
  }
  if (!categories.includes(shortcut.category)) {
    return { error: 'カテゴリを選択してください。' };
  }
  if (shortcut.author.length > 30) {
    return { error: '投稿者名は30文字以内で入力してください。' };
  }
  // 1行を1つのURLとして扱い、空行を除いて入力順に保存する。
  const urls = shortcut.url.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
  if (urls.length < 1 || urls.length > 10) {
    return { error: 'iCloud共有URLは1〜10件を、1行に1つずつ入力してください。' };
  }
  for (let index = 0; index < urls.length; index += 1) {
    if (!isValidShortcutUrl(urls[index])) {
      return { error: `${index + 1}件目のiCloud共有URLが正しくありません。` };
    }
  }
  shortcut.url = urls.join('\n');
  return { shortcut };
}

app.get('/api/shortcuts', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(listShortcuts.all());
});

app.post('/api/shortcuts', limitPosts, express.json({ limit: '8kb' }), (req, res) => {
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'JSON形式で送信してください。' });
  }
  const result = validateShortcut(req.body);
  if (result.error) return res.status(400).json({ error: result.error });

  const { title, description, category, url, author } = result.shortcut;
  const passwordHash = hashPassword(req.body.delete_password);
  const saved = insertShortcut.run(title, description, category, url, author, passwordHash);
  res.status(201).json(findShortcut.get(saved.lastInsertRowid));
});

registerDeletion(app, db);

// ブラウザに公開するファイルはpublicフォルダだけに限定する。
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'APIが見つかりません。' });
});

app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: '送信データが大きすぎます。' });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSONの形式が正しくありません。' });
  }
  console.error(error);
  res.status(500).json({ error: 'サーバーでエラーが発生しました。時間をおいてお試しください。' });
});

const server = app.listen(port, () => {
  console.log(`Shortcut Hub: http://localhost:${port}`);
});
server.on('error', (error) => {
  console.error('サーバーを起動できませんでした:', error.message);
  clearInterval(cleanupTimer);
  db.close();
  process.exitCode = 1;
});

// 終了時は接続を閉じてから、データベースも閉じる。
function shutdown() {
  clearInterval(cleanupTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

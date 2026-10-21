const express = require('express');
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');

// 元のパスワードは保存せず、投稿ごとにランダムな値を加えてハッシュ化する。
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function matchesPassword(password, savedHash) {
  const [salt, hash] = savedHash.split(':');
  if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const enteredHash = scryptSync(password, salt, 64);
  return timingSafeEqual(Buffer.from(hash, 'hex'), enteredHash);
}

function registerDeletion(app, db) {
  const findShortcut = db.prepare('SELECT delete_password_hash FROM shortcuts WHERE id = ?');
  const deleteShortcut = db.prepare('DELETE FROM shortcuts WHERE id = ?');
  const attempts = new Map();
  const windowMs = 10 * 60 * 1000;

  // 投稿APIとは別に、削除の試行を同じIPから10分間に5回までにする。
  function limitDeletions(req, res, next) {
    const now = Date.now();
    const ip = req.clientIp || req.ip;
    let record = attempts.get(ip);
    if (!record || now >= record.resetAt) {
      record = { count: 0, resetAt: now + windowMs };
      attempts.set(ip, record);
    }
    if (record.count >= 5) {
      res.setHeader('Retry-After', Math.ceil((record.resetAt - now) / 1000));
      return res.status(429).json({ error: '削除の試行回数の上限です。10分ほど待ってからお試しください。' });
    }
    record.count += 1;
    next();
  }

  const cleanupTimer = setInterval(() => {
    for (const [ip, record] of attempts) {
      if (Date.now() >= record.resetAt) attempts.delete(ip);
    }
  }, windowMs);
  cleanupTimer.unref();

  app.delete('/api/shortcuts/:id', limitDeletions, express.json({ limit: '1kb' }), (req, res) => {
    if (!req.is('application/json')) {
      return res.status(415).json({ error: 'JSON形式で送信してください。' });
    }

    // 小数、負数、数値として安全に扱えないIDは受け付けない。
    const id = Number(req.params.id);
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(id)) {
      return res.status(400).json({ error: '投稿IDが正しくありません。' });
    }

    const enteredPassword = req.body && req.body.password;
    if (typeof enteredPassword !== 'string' || enteredPassword.length < 8
        || enteredPassword.length > 128 || !enteredPassword.trim()) {
      return res.status(400).json({ error: '削除用パスワードは空白だけにせず、8〜128文字で入力してください。' });
    }

    const shortcut = findShortcut.get(id);
    if (!shortcut) return res.status(404).json({ error: '投稿が見つかりません。' });
    // この機能より前の投稿には、削除用パスワードが設定されていない。
    if (shortcut.delete_password_hash === null) {
      return res.status(403).json({ error: 'この投稿には削除用パスワードが設定されていないため、画面から削除できません。' });
    }
    if (!matchesPassword(enteredPassword, shortcut.delete_password_hash)) {
      return res.status(401).json({ error: '削除パスワードが正しくありません。' });
    }

    // 認証を通った場合だけ、プレースホルダーを使って削除する。
    const result = deleteShortcut.run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: '投稿が見つかりません。' });
    }
    res.json({ message: '投稿を削除しました。' });
  });
}

module.exports = { registerDeletion, hashPassword };

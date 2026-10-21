// Disposable UI test proxy: DELETE never reaches the database server.
const path = require('node:path');
const express = require('../shortcut-hub/node_modules/express');
const app = express();
const target = 'http://127.0.0.1:3100';

app.use(express.json({ limit: '16kb' }));

app.delete('/api/shortcuts/:id', (req, res) => {
  if (req.body?.password !== 'qa-owner-2026') {
    return res.status(401).json({ error: '削除用パスワードが違います。' });
  }
  console.log(`Dry-run DELETE for post ${req.params.id}; no forwarding or database changes.`);
  res.json({ message: '投稿を削除しました。' });
});

app.all('/api/shortcuts', async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed by test proxy.' });
  }
  try {
    const options = { method: req.method };
    if (req.method === 'POST') {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(req.body);
    }
    const response = await fetch(`${target}${req.originalUrl}`, options);
    res.status(response.status).type('application/json').send(await response.text());
  } catch (error) {
    console.error(error.message);
    res.status(502).json({ error: 'Test API server at port 3100 is unavailable.' });
  }
});

app.use(express.static(path.resolve(__dirname, '../shortcut-hub/public')));
app.listen(3102, '127.0.0.1', () => {
  console.log(`UI test proxy: http://127.0.0.1:3102 (PID ${process.pid})`);
  console.log('DELETE is dry-run; data retained. GET/POST forward only to test server port 3100.');
});

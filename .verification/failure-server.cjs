const path = require('node:path');
const project = path.resolve(__dirname, '..', 'shortcut-hub');
const express = require(path.join(project, 'node_modules', 'express'));
const app = express();
let getCalls = 0;

app.get('/api/shortcuts', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  getCalls += 1;
  if (getCalls === 1) {
    return res.status(503).json({ error: 'テスト用：一覧を取得できませんでした。' });
  }
  try {
    const response = await fetch('http://localhost:3100/api/shortcuts');
    res.status(response.status).type('json').send(await response.text());
  } catch {
    res.status(503).json({ error: 'テスト用：転送先に接続できませんでした。' });
  }
});

app.post('/api/shortcuts', (req, res) => {
  res.status(503).json({ error: 'テスト用：通信に失敗しました。' });
});
app.use(express.static(path.join(project, 'public')));
const server = app.listen(3102, () => {
  console.log('Failure test server: http://localhost:3102 (first GET fails; every POST fails)');
});
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));

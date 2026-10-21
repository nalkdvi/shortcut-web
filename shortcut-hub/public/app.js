const categories = ['便利ツール', '勉強', '仕事効率化', 'エンタメ', 'その他'];
const searchInput = document.querySelector('#search');
const filterButtons = document.querySelectorAll('.filter-button');
const list = document.querySelector('#shortcut-list');
const template = document.querySelector('#shortcut-template');
const resultsCount = document.querySelector('#results-count');
const listMessage = document.querySelector('#list-message');
const messageTitle = document.querySelector('#list-message-title');
const messageText = document.querySelector('#list-message-text');
const emptyShareLink = document.querySelector('#empty-share-link');
const retryButton = document.querySelector('#retry-button');
const form = document.querySelector('#post-form');
const formStatus = document.querySelector('#form-status');
const submitButton = document.querySelector('#submit-button');
let shortcuts = [];
let selectedCategory = '';
let loadState = 'loading';
let isSubmitting = false;
const openDeleteDialog = setupDeletion((id) => {
  shortcuts = shortcuts.filter((shortcut) => shortcut.id !== id);
  renderShortcuts();
});

// ホスト・パスと文字列全体を確認し、別サイトや余分な情報を拒否する。
function isValidShortcutUrl(value) {
  try {
    const url = new URL(value);
    return /^https:\/\/www\.icloud\.com\/shortcuts\/[a-fA-F0-9]{32}$/.test(value)
      && url.protocol === 'https:' && url.hostname === 'www.icloud.com'
      && /^\/shortcuts\/[a-fA-F0-9]{32}$/.test(url.pathname)
      && !url.username && !url.password && !url.port && !url.search && !url.hash;
  } catch {
    return false;
  }
}

// 1行を1つのリンクとして取り出し、空行と前後の空白を除く。
function splitShortcutUrls(value) {
  return value.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
}

function showListMessage(title, description, showShare = false, showRetry = false) {
  listMessage.hidden = false;
  messageTitle.textContent = title;
  messageText.textContent = description;
  emptyShareLink.hidden = !showShare;
  retryButton.hidden = !showRetry;
}

function setCategory(category) {
  selectedCategory = category;
  filterButtons.forEach((button) => {
    const active = button.dataset.category === category;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

// templateの構造だけを複製し、投稿内容はtextContentで安全に表示する。
function createCard(shortcut) {
  const card = template.content.cloneNode(true);
  const badge = card.querySelector('.category-badge');
  badge.textContent = shortcut.category;
  badge.dataset.category = shortcut.category;
  card.querySelector('.card-title').textContent = shortcut.title;
  card.querySelector('.card-description').textContent = shortcut.description;
  card.querySelector('.card-author').textContent = shortcut.author || '匿名';
  const time = card.querySelector('time');
  time.dateTime = shortcut.created_at;
  time.textContent = new Date(shortcut.created_at).toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const links = card.querySelector('.card-links');
  const linkTemplate = links.querySelector('.card-link');
  const urls = splitShortcutUrls(shortcut.url);
  links.replaceChildren();
  // 各リンクを個別のボタンにして、投稿した順番に開けるようにする。
  (urls.length ? urls : ['']).forEach((url, index) => {
    const link = linkTemplate.cloneNode(true);
    if (isValidShortcutUrl(url)) {
      link.href = url;
      link.querySelector('.card-link-label').textContent = urls.length > 1
        ? `ショートカット${index + 1}を開く` : 'ショートカットを開く';
    } else {
      link.textContent = '共有リンクを確認できません';
      link.setAttribute('aria-disabled', 'true');
    }
    links.append(link);
  });
  const deleteButton = card.querySelector('.delete-button');
  deleteButton.setAttribute('aria-label', `${shortcut.title}の投稿を削除`);
  deleteButton.disabled = !shortcut.can_delete;
  card.querySelector('.delete-unavailable-note').hidden = Boolean(shortcut.can_delete);
  deleteButton.addEventListener('click', () => openDeleteDialog(shortcut));
  return card;
}

function renderShortcuts() {
  list.replaceChildren();
  if (loadState === 'loading') {
    resultsCount.textContent = '読み込み中…';
    showListMessage('ショートカットを読み込んでいます', '少しお待ちください。');
    return;
  }
  if (loadState === 'error') {
    resultsCount.textContent = '読み込みに失敗しました';
    showListMessage('一覧を取得できませんでした', '通信状態を確認して、もう一度お試しください。', false, true);
    return;
  }

  // キーワード検索とカテゴリ絞り込みを同時に適用する。
  const keyword = searchInput.value.trim().toLocaleLowerCase('ja-JP');
  const matches = shortcuts.filter((shortcut) => {
    const matchesKeyword = shortcut.title.toLocaleLowerCase('ja-JP').includes(keyword)
      || shortcut.description.toLocaleLowerCase('ja-JP').includes(keyword);
    return matchesKeyword && (!selectedCategory || shortcut.category === selectedCategory);
  });
  resultsCount.textContent = `${matches.length} 件のショートカット`;
  listMessage.hidden = matches.length > 0;
  matches.forEach((shortcut) => list.append(createCard(shortcut)));
  if (matches.length === 0) {
    if (shortcuts.length === 0) {
      showListMessage('まだショートカットがありません', 'あなたの「これ、便利」を、最初にシェアしてみませんか。', true);
    } else {
      showListMessage('該当するショートカットがありません', 'キーワードやカテゴリを変えて、もう一度探してみてください。');
    }
  }
}

async function loadShortcuts() {
  loadState = 'loading';
  renderShortcuts();
  retryButton.disabled = true;
  // 一覧の取得が終わるまで投稿を待ち、取得結果で新しい投稿を上書きしない。
  submitButton.disabled = true;
  showFormStatus('一覧を読み込み中です。完了すると投稿できます。');
  try {
    const response = await fetch('/api/shortcuts');
    if (!response.ok) throw new Error('一覧の取得に失敗しました。');
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('データ形式が正しくありません。');
    shortcuts = data;
    loadState = 'ready';
    showFormStatus('');
  } catch {
    loadState = 'error';
    showFormStatus('投稿するには一覧の読み込みが必要です。上の「再読み込みする」をお試しください。');
  } finally {
    retryButton.disabled = false;
    submitButton.disabled = loadState !== 'ready';
    renderShortcuts();
  }
}

function showFormStatus(message, success = false) {
  formStatus.textContent = message;
  formStatus.classList.toggle('is-success', success);
}

function validatePost(post) {
  if (!post.title || post.title.length > 50) return ['title', 'タイトルは1〜50文字で入力してください。'];
  if (!post.description || post.description.length > 300) return ['description', '説明は1〜300文字で入力してください。'];
  if (!categories.includes(post.category)) return ['category', 'カテゴリを選択してください。'];
  const urls = splitShortcutUrls(post.url);
  if (urls.length === 0 || urls.length > 10) return ['url', 'iCloud共有URLは1行に1つずつ、1〜10件入力してください。'];
  const invalidIndex = urls.findIndex((url) => !isValidShortcutUrl(url));
  if (invalidIndex !== -1) return ['url', `${invalidIndex + 1}件目に正しいiCloud共有URLを入力してください。末尾は32桁の英数字（0〜9、a〜f）です。`];
  if (post.author.length > 30) return ['author', '投稿者名は30文字以内で入力してください。'];
  if (!post.delete_password.trim() || post.delete_password.length < 8 || post.delete_password.length > 128) {
    return ['delete_password', '削除用パスワードは空白以外を含む8〜128文字で入力してください。'];
  }
  return null;
}

async function submitPost(event) {
  event.preventDefault();
  if (isSubmitting) return;
  if (loadState !== 'ready') {
    showFormStatus('一覧の読み込みが完了してから投稿してください。取得できない場合は上の「再読み込みする」をお試しください。');
    return;
  }
  form.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
  // FormDataで入力をまとめて取り出し、前後の空白を取り除く。
  const data = new FormData(form);
  const post = {};
  for (const field of ['title', 'description', 'category', 'url', 'author']) {
    post[field] = String(data.get(field) || '').trim();
  }
  // パスワードは前後の空白も含め、入力した値をそのまま使う。
  post.delete_password = String(data.get('delete_password') || '');
  post.url = splitShortcutUrls(post.url).join('\n');
  const error = validatePost(post);
  if (error) {
    showFormStatus(error[1]);
    form.elements[error[0]].setAttribute('aria-invalid', 'true');
    form.elements[error[0]].focus();
    return;
  }

  // 送信中はボタンを無効にして、連打による二重投稿を防ぐ。
  isSubmitting = true;
  submitButton.disabled = true;
  submitButton.textContent = '投稿しています…';
  form.setAttribute('aria-busy', 'true');
  showFormStatus('');
  try {
    const response = await fetch('/api/shortcuts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(post),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '投稿できませんでした。もう一度お試しください。');
    shortcuts.unshift(result);
    searchInput.value = '';
    setCategory('');
    loadState = 'ready';
    renderShortcuts();
    form.reset();
    showFormStatus('投稿しました。一覧に追加されています。ありがとうございます！', true);
    formStatus.focus();
  } catch (error) {
    const message = error instanceof TypeError
      ? '通信できませんでした。入力内容は残っています。通信状態を確認し、一覧を再読み込みして投稿結果をご確認ください。'
      : error.message;
    showFormStatus(message);
    formStatus.focus();
  } finally {
    isSubmitting = false;
    submitButton.disabled = false;
    submitButton.textContent = '＋ ショートカットを投稿する';
    form.removeAttribute('aria-busy');
  }
}

searchInput.addEventListener('input', renderShortcuts);
filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setCategory(button.dataset.category);
    renderShortcuts();
  });
});
retryButton.addEventListener('click', loadShortcuts);
form.addEventListener('submit', submitPost);
loadShortcuts();

// 削除画面と通信をまとめ、一覧側には削除できたIDだけを渡す。
function setupDeletion(onDeleted) {
  const dialog = document.querySelector('#delete-dialog');
  const form = document.querySelector('#delete-form');
  const postTitle = document.querySelector('#delete-post-title');
  const passwordInput = document.querySelector('#delete-password');
  const status = document.querySelector('#delete-status');
  const listStatus = document.querySelector('#list-status');
  const submitButton = document.querySelector('#delete-submit');
  const cancelButton = document.querySelector('#delete-cancel');
  let selectedShortcut = null;
  let previousButton = null;
  let isDeleting = false;

  function setDeleting(value) {
    isDeleting = value;
    submitButton.disabled = value;
    cancelButton.disabled = value;
    passwordInput.disabled = value;
    submitButton.textContent = value ? '削除しています…' : '削除する';
    form.setAttribute('aria-busy', String(value));
  }

  cancelButton.addEventListener('click', () => {
    if (!isDeleting) dialog.close();
  });
  // 通信中のEscapeによる閉じる操作を防ぎ、結果を必ず表示する。
  dialog.addEventListener('cancel', (event) => {
    if (isDeleting) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    // パスワードは保存せず、画面を閉じるたびに入力を消す。
    form.reset();
    passwordInput.removeAttribute('aria-invalid');
    status.textContent = '';
    selectedShortcut = null;
    const focusTarget = previousButton?.isConnected
      ? previousButton : document.querySelector('#search');
    focusTarget.focus({ preventScroll: true });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isDeleting || !selectedShortcut) return;
    const password = passwordInput.value;
    if (!password.trim() || password.length < 8 || password.length > 128) {
      status.textContent = '削除用パスワードは空白以外を含む8〜128文字で入力してください。';
      passwordInput.setAttribute('aria-invalid', 'true');
      passwordInput.focus();
      return;
    }
    const id = selectedShortcut.id;
    passwordInput.removeAttribute('aria-invalid');
    status.textContent = '';
    setDeleting(true);
    let deleted = false;
    try {
      const response = await fetch(`/api/shortcuts/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        deleted = true;
      } else {
        const result = await response.json().catch(() => ({}));
        status.textContent = result.error || '削除できませんでした。もう一度お試しください。';
        if (response.status === 401) passwordInput.setAttribute('aria-invalid', 'true');
      }
    } catch {
      // 応答が失われた場合は、実際の削除結果を断定しない。
      status.textContent = '通信結果を確認できませんでした。画面を再読み込みして、投稿が残っているか確認してください。';
    } finally {
      setDeleting(false);
      passwordInput.value = '';
    }
    if (deleted) {
      dialog.close();
      onDeleted(id);
      listStatus.textContent = '投稿を削除しました。';
    } else {
      passwordInput.focus();
    }
  });

  return function openDeleteDialog(shortcut) {
    if (dialog.open) return;
    selectedShortcut = shortcut;
    previousButton = document.activeElement;
    form.reset();
    status.textContent = '';
    listStatus.textContent = '';
    postTitle.textContent = shortcut.title;
    dialog.showModal();
    passwordInput.focus();
  };
}

for (const button of document.querySelectorAll('button[data-wiz-copy]')) {
  const line = document.getElementById(button.dataset.wizCopy);
  const status = document.getElementById(button.getAttribute('aria-describedby'));
  if (!line?.textContent || !status) continue;

  let latest = 0;
  button.addEventListener('click', async () => {
    const attempt = ++latest;
    status.textContent = '';
    let message;
    try {
      await navigator.clipboard.writeText(line.textContent);
      message = 'Paste this into your Wiz chat.';
    } catch {
      message = 'Select and copy the install line, then paste it into your Wiz chat.';
    }
    if (attempt === latest) status.textContent = message;
  });
}

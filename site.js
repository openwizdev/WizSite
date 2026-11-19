(async () => {
  const response = await fetch('https://api.github.com/repos/openwizdev/OpenWiz');
  if (!response.ok) return;
  const { stargazers_count: count } = await response.json();
  if (!Number.isSafeInteger(count) || count < 0) return;
  const formatted = new Intl.NumberFormat(document.documentElement.lang).format(count);
  for (const value of document.querySelectorAll('[data-stars]')) {
    value.textContent = formatted;
    value.hidden = false;
    value.parentElement.setAttribute('aria-label', `Star on GitHub · ${formatted} stars`);
  }
})().catch(() => {});

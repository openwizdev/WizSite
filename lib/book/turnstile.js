const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const BOOK_HOST = /^(?:openwiz\.dev|(?:book|[a-f0-9]{8})\.wizsite\.pages\.dev|localhost|127\.0\.0\.1|\[::1\])$/;

export async function verifyTurnstile(request, secret, token, fetch) {
  if (!token || token.length > 2048 || !token.trim()) return false;
  const { hostname } = new URL(request.url);
  if (!BOOK_HOST.test(hostname)) return false;

  const body = new URLSearchParams({ secret, response: token });
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) body.set('remoteip', ip);

  try {
    const response = await fetch(SITEVERIFY, {
      method: 'POST',
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.success === true && result.action === 'book' && result.hostname === hostname;
  } catch {
    return false;
  }
}

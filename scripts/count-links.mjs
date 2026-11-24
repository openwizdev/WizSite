export function clickLinkAttribute(href) {
  if (/^https:\/\/github\.com\/openwizdev\/[^/?#]+/i.test(href)) return ' data-count="github"';
  if (/^https:\/\/x\.com\//i.test(href)) return ' data-count="x"';
  return '';
}

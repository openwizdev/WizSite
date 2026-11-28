export const SITE = 'https://openwiz.dev/';
export const SECTIONS = ['pages', 'market', 'docs', 'answers'];

export const urlFor = path => SITE + path.replace(/index\.html$/, '');

export function createRegistry() {
  const entries = new Map();
  const titles = new Set();
  const descriptions = new Set();
  return {
    add(entry) {
      const { path, title, description, section, trail = [], lastmod, indexable = true } = entry;
      const where = `registry entry ${path}`;
      if (typeof path !== 'string' || !/^([a-z0-9][a-z0-9._-]*\/)*([a-z0-9][a-z0-9._-]*\.html)$/.test(path)) throw new Error(`${where}: invalid path`);
      if (entries.has(path)) throw new Error(`${where}: registered twice`);
      if (typeof title !== 'string' || !title.trim() || title.length > 60 || !title.includes('OpenWiz')) throw new Error(`${where}: title must be 1 to 60 characters and name OpenWiz`);
      if (typeof description !== 'string' || !description.trim() || description.length > 160) throw new Error(`${where}: description must be 1 to 160 characters`);
      if (titles.has(title)) throw new Error(`${where}: duplicate title`);
      if (descriptions.has(description)) throw new Error(`${where}: duplicate description`);
      if (!SECTIONS.includes(section)) throw new Error(`${where}: unknown section ${section}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(lastmod ?? '') || new Date(`${lastmod}T00:00:00Z`).toISOString().slice(0, 10) !== lastmod) {
        throw new Error(`${where}: lastmod must be a real YYYY-MM-DD date`);
      }
      if (!Array.isArray(trail) || (path === 'index.html') !== (trail.length === 0)
          || trail.some(step => typeof step?.name !== 'string' || !step.name.trim() || typeof step?.path !== 'string')
          || (trail.length && trail.at(-1).path !== path)) {
        throw new Error(`${where}: trail must run from the home to the page itself`);
      }
      titles.add(title); descriptions.add(description);
      entries.set(path, { path, title, description, section, trail, lastmod, indexable: indexable !== false });
      return entries.get(path);
    },
    get: path => entries.get(path),
    all: () => [...entries.values()],
    indexable: () => [...entries.values()].filter(entry => entry.indexable),
    verified() {
      for (const entry of entries.values()) {
        for (const step of entry.trail) {
          if (!entries.has(step.path)) throw new Error(`registry entry ${entry.path}: its trail names ${step.path}, which is not registered`);
        }
      }
      return [...entries.values()];
    },
  };
}

export function breadcrumbData(entry) {
  if (!entry.indexable || entry.trail.length === 0) return null;
  const items = [{ name: 'OpenWiz', path: 'index.html' }, ...entry.trail];
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((step, index) => ({ '@type': 'ListItem', position: index + 1, name: step.name, item: urlFor(step.path) })),
  };
}

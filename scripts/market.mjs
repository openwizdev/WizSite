import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
export const REGISTRY = new URL('market/registry.json', ROOT);
export const START = '<!-- market:start -->';
export const END = '<!-- market:end -->';
export const WIZMARKET = 'https://github.com/openwizdev/WizMarket';
export const CONTRACT = `${WIZMARKET}/blob/main/contracts/listing.v1.md`;

const ID = /^[a-z0-9-]{2,40}$/;
const TAG = /^[a-z0-9-]+$/;
const HEX40 = /^[0-9a-f]{40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})\/([A-Za-z0-9._-]{1,100})$/;
const FIELDS = { name: true, summary: true, tags: true, url: true, plugs_into: true, publisher: true, stage: true, status: true, login: false, links: false, proof: false };
const RECEIPT_KINDS = ['driver', 'harness'];
const SCHEMA_KEYS = new Set(['commit', 'contract', 'listings', 'id', ...Object.keys(FIELDS), 'label', 'receipt', 'skill', 'path', 'date', 'source', 'check']);
export const PRIVATE_SOURCE = [
  ['a token', String.raw`\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|npm_[A-Za-z0-9]{30,}|(?:AKIA|ASIA)[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.)`],
  ['a token', String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----|[A-Za-z][A-Za-z0-9+.-]*://[^/\s:@]+:[^/\s@]+@`],
  ['a token', String.raw`(?i)\b(?:password|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token)\b\s*[:=]\s*\S|\bbearer\s+[A-Za-z0-9._~+/-]{16,}`],
  ['a private id', String.raw`\bthr${'_'}[A-Za-z0-9]|\b(?:proj|prj|mch|usr|acct|auto|sess?|sbx)_[A-Za-z0-9]|\bcr_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}|\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b`],
  ['a machine path', String.raw`(?<![\w.~%/-])/(?:home|Users|root|tmp|var/folders|private/var)/|(?<![A-Za-z0-9])[A-Za-z]:\\`],
];
const PYTHON_SPACE = String.raw`\t\n\v\f\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000`;
const PYTHON_WORD = [
  '30-39 41-5a 5f 61-7a aa b2-b3 b5 b9-ba bc-be c0-d6 d8-f6 f8-2c1 2c6-2d1 2e0-2e4 2ec 2ee 370-374 376-377 37a-37d 37f 386 388-38a 38c 38e-3a1 ',
  '3a3-3f5 3f7-481 48a-52f 531-556 559 560-588 5d0-5ea 5ef-5f2 620-64a 660-669 66e-66f 671-6d3 6d5 6e5-6e6 6ee-6fc 6ff 710 712-72f 74d-7a5 7b1 ',
  '7c0-7ea 7f4-7f5 7fa 800-815 81a 824 828 840-858 860-86a 870-887 889-88e 8a0-8c9 904-939 93d 950 958-961 966-96f 971-980 985-98c 98f-990 ',
  '993-9a8 9aa-9b0 9b2 9b6-9b9 9bd 9ce 9dc-9dd 9df-9e1 9e6-9f1 9f4-9f9 9fc a05-a0a a0f-a10 a13-a28 a2a-a30 a32-a33 a35-a36 a38-a39 a59-a5c a5e ',
  'a66-a6f a72-a74 a85-a8d a8f-a91 a93-aa8 aaa-ab0 ab2-ab3 ab5-ab9 abd ad0 ae0-ae1 ae6-aef af9 b05-b0c b0f-b10 b13-b28 b2a-b30 b32-b33 b35-b39 ',
  'b3d b5c-b5d b5f-b61 b66-b6f b71-b77 b83 b85-b8a b8e-b90 b92-b95 b99-b9a b9c b9e-b9f ba3-ba4 ba8-baa bae-bb9 bd0 be6-bf2 c05-c0c c0e-c10 ',
  'c12-c28 c2a-c39 c3d c58-c5a c5d c60-c61 c66-c6f c78-c7e c80 c85-c8c c8e-c90 c92-ca8 caa-cb3 cb5-cb9 cbd cdd-cde ce0-ce1 ce6-cef cf1-cf2 ',
  'd04-d0c d0e-d10 d12-d3a d3d d4e d54-d56 d58-d61 d66-d78 d7a-d7f d85-d96 d9a-db1 db3-dbb dbd dc0-dc6 de6-def e01-e30 e32-e33 e40-e46 e50-e59 ',
  'e81-e82 e84 e86-e8a e8c-ea3 ea5 ea7-eb0 eb2-eb3 ebd ec0-ec4 ec6 ed0-ed9 edc-edf f00 f20-f33 f40-f47 f49-f6c f88-f8c 1000-102a 103f-1049 ',
  '1050-1055 105a-105d 1061 1065-1066 106e-1070 1075-1081 108e 1090-1099 10a0-10c5 10c7 10cd 10d0-10fa 10fc-1248 124a-124d 1250-1256 1258 ',
  '125a-125d 1260-1288 128a-128d 1290-12b0 12b2-12b5 12b8-12be 12c0 12c2-12c5 12c8-12d6 12d8-1310 1312-1315 1318-135a 1369-137c 1380-138f ',
  '13a0-13f5 13f8-13fd 1401-166c 166f-167f 1681-169a 16a0-16ea 16ee-16f8 1700-1711 171f-1731 1740-1751 1760-176c 176e-1770 1780-17b3 17d7 17dc ',
  '17e0-17e9 17f0-17f9 1810-1819 1820-1878 1880-1884 1887-18a8 18aa 18b0-18f5 1900-191e 1946-196d 1970-1974 1980-19ab 19b0-19c9 19d0-19da ',
  '1a00-1a16 1a20-1a54 1a80-1a89 1a90-1a99 1aa7 1b05-1b33 1b45-1b4c 1b50-1b59 1b83-1ba0 1bae-1be5 1c00-1c23 1c40-1c49 1c4d-1c7d 1c80-1c88 ',
  '1c90-1cba 1cbd-1cbf 1ce9-1cec 1cee-1cf3 1cf5-1cf6 1cfa 1d00-1dbf 1e00-1f15 1f18-1f1d 1f20-1f45 1f48-1f4d 1f50-1f57 1f59 1f5b 1f5d 1f5f-1f7d ',
  '1f80-1fb4 1fb6-1fbc 1fbe 1fc2-1fc4 1fc6-1fcc 1fd0-1fd3 1fd6-1fdb 1fe0-1fec 1ff2-1ff4 1ff6-1ffc 2070-2071 2074-2079 207f-2089 2090-209c 2102 ',
  '2107 210a-2113 2115 2119-211d 2124 2126 2128 212a-212d 212f-2139 213c-213f 2145-2149 214e 2150-2189 2460-249b 24ea-24ff 2776-2793 2c00-2ce4 ',
  '2ceb-2cee 2cf2-2cf3 2cfd 2d00-2d25 2d27 2d2d 2d30-2d67 2d6f 2d80-2d96 2da0-2da6 2da8-2dae 2db0-2db6 2db8-2dbe 2dc0-2dc6 2dc8-2dce 2dd0-2dd6 ',
  '2dd8-2dde 2e2f 3005-3007 3021-3029 3031-3035 3038-303c 3041-3096 309d-309f 30a1-30fa 30fc-30ff 3105-312f 3131-318e 3192-3195 31a0-31bf ',
  '31f0-31ff 3220-3229 3248-324f 3251-325f 3280-3289 32b1-32bf 3400-4dbf 4e00-a48c a4d0-a4fd a500-a60c a610-a62b a640-a66e a67f-a69d a6a0-a6ef ',
  'a717-a71f a722-a788 a78b-a7ca a7d0-a7d1 a7d3 a7d5-a7d9 a7f2-a801 a803-a805 a807-a80a a80c-a822 a830-a835 a840-a873 a882-a8b3 a8d0-a8d9 ',
  'a8f2-a8f7 a8fb a8fd-a8fe a900-a925 a930-a946 a960-a97c a984-a9b2 a9cf-a9d9 a9e0-a9e4 a9e6-a9fe aa00-aa28 aa40-aa42 aa44-aa4b aa50-aa59 ',
  'aa60-aa76 aa7a aa7e-aaaf aab1 aab5-aab6 aab9-aabd aac0 aac2 aadb-aadd aae0-aaea aaf2-aaf4 ab01-ab06 ab09-ab0e ab11-ab16 ab20-ab26 ab28-ab2e ',
  'ab30-ab5a ab5c-ab69 ab70-abe2 abf0-abf9 ac00-d7a3 d7b0-d7c6 d7cb-d7fb f900-fa6d fa70-fad9 fb00-fb06 fb13-fb17 fb1d fb1f-fb28 fb2a-fb36 ',
  'fb38-fb3c fb3e fb40-fb41 fb43-fb44 fb46-fbb1 fbd3-fd3d fd50-fd8f fd92-fdc7 fdf0-fdfb fe70-fe74 fe76-fefc ff10-ff19 ff21-ff3a ff41-ff5a ',
  'ff66-ffbe ffc2-ffc7 ffca-ffcf ffd2-ffd7 ffda-ffdc 10000-1000b 1000d-10026 10028-1003a 1003c-1003d 1003f-1004d 10050-1005d 10080-100fa ',
  '10107-10133 10140-10178 1018a-1018b 10280-1029c 102a0-102d0 102e1-102fb 10300-10323 1032d-1034a 10350-10375 10380-1039d 103a0-103c3 ',
  '103c8-103cf 103d1-103d5 10400-1049d 104a0-104a9 104b0-104d3 104d8-104fb 10500-10527 10530-10563 10570-1057a 1057c-1058a 1058c-10592 ',
  '10594-10595 10597-105a1 105a3-105b1 105b3-105b9 105bb-105bc 10600-10736 10740-10755 10760-10767 10780-10785 10787-107b0 107b2-107ba ',
  '10800-10805 10808 1080a-10835 10837-10838 1083c 1083f-10855 10858-10876 10879-1089e 108a7-108af 108e0-108f2 108f4-108f5 108fb-1091b ',
  '10920-10939 10980-109b7 109bc-109cf 109d2-10a00 10a10-10a13 10a15-10a17 10a19-10a35 10a40-10a48 10a60-10a7e 10a80-10a9f 10ac0-10ac7 ',
  '10ac9-10ae4 10aeb-10aef 10b00-10b35 10b40-10b55 10b58-10b72 10b78-10b91 10ba9-10baf 10c00-10c48 10c80-10cb2 10cc0-10cf2 10cfa-10d23 ',
  '10d30-10d39 10e60-10e7e 10e80-10ea9 10eb0-10eb1 10f00-10f27 10f30-10f45 10f51-10f54 10f70-10f81 10fb0-10fcb 10fe0-10ff6 11003-11037 ',
  '11052-1106f 11071-11072 11075 11083-110af 110d0-110e8 110f0-110f9 11103-11126 11136-1113f 11144 11147 11150-11172 11176 11183-111b2 ',
  '111c1-111c4 111d0-111da 111dc 111e1-111f4 11200-11211 11213-1122b 11280-11286 11288 1128a-1128d 1128f-1129d 1129f-112a8 112b0-112de ',
  '112f0-112f9 11305-1130c 1130f-11310 11313-11328 1132a-11330 11332-11333 11335-11339 1133d 11350 1135d-11361 11400-11434 11447-1144a ',
  '11450-11459 1145f-11461 11480-114af 114c4-114c5 114c7 114d0-114d9 11580-115ae 115d8-115db 11600-1162f 11644 11650-11659 11680-116aa 116b8 ',
  '116c0-116c9 11700-1171a 11730-1173b 11740-11746 11800-1182b 118a0-118f2 118ff-11906 11909 1190c-11913 11915-11916 11918-1192f 1193f 11941 ',
  '11950-11959 119a0-119a7 119aa-119d0 119e1 119e3 11a00 11a0b-11a32 11a3a 11a50 11a5c-11a89 11a9d 11ab0-11af8 11c00-11c08 11c0a-11c2e 11c40 ',
  '11c50-11c6c 11c72-11c8f 11d00-11d06 11d08-11d09 11d0b-11d30 11d46 11d50-11d59 11d60-11d65 11d67-11d68 11d6a-11d89 11d98 11da0-11da9 ',
  '11ee0-11ef2 11fb0 11fc0-11fd4 12000-12399 12400-1246e 12480-12543 12f90-12ff0 13000-1342e 14400-14646 16800-16a38 16a40-16a5e 16a60-16a69 ',
  '16a70-16abe 16ac0-16ac9 16ad0-16aed 16b00-16b2f 16b40-16b43 16b50-16b59 16b5b-16b61 16b63-16b77 16b7d-16b8f 16e40-16e96 16f00-16f4a 16f50 ',
  '16f93-16f9f 16fe0-16fe1 16fe3 17000-187f7 18800-18cd5 18d00-18d08 1aff0-1aff3 1aff5-1affb 1affd-1affe 1b000-1b122 1b150-1b152 1b164-1b167 ',
  '1b170-1b2fb 1bc00-1bc6a 1bc70-1bc7c 1bc80-1bc88 1bc90-1bc99 1d2e0-1d2f3 1d360-1d378 1d400-1d454 1d456-1d49c 1d49e-1d49f 1d4a2 1d4a5-1d4a6 ',
  '1d4a9-1d4ac 1d4ae-1d4b9 1d4bb 1d4bd-1d4c3 1d4c5-1d505 1d507-1d50a 1d50d-1d514 1d516-1d51c 1d51e-1d539 1d53b-1d53e 1d540-1d544 1d546 ',
  '1d54a-1d550 1d552-1d6a5 1d6a8-1d6c0 1d6c2-1d6da 1d6dc-1d6fa 1d6fc-1d714 1d716-1d734 1d736-1d74e 1d750-1d76e 1d770-1d788 1d78a-1d7a8 ',
  '1d7aa-1d7c2 1d7c4-1d7cb 1d7ce-1d7ff 1df00-1df1e 1e100-1e12c 1e137-1e13d 1e140-1e149 1e14e 1e290-1e2ad 1e2c0-1e2eb 1e2f0-1e2f9 1e7e0-1e7e6 ',
  '1e7e8-1e7eb 1e7ed-1e7ee 1e7f0-1e7fe 1e800-1e8c4 1e8c7-1e8cf 1e900-1e943 1e94b 1e950-1e959 1ec71-1ecab 1ecad-1ecaf 1ecb1-1ecb4 1ed01-1ed2d ',
  '1ed2f-1ed3d 1ee00-1ee03 1ee05-1ee1f 1ee21-1ee22 1ee24 1ee27 1ee29-1ee32 1ee34-1ee37 1ee39 1ee3b 1ee42 1ee47 1ee49 1ee4b 1ee4d-1ee4f ',
  '1ee51-1ee52 1ee54 1ee57 1ee59 1ee5b 1ee5d 1ee5f 1ee61-1ee62 1ee64 1ee67-1ee6a 1ee6c-1ee72 1ee74-1ee77 1ee79-1ee7c 1ee7e 1ee80-1ee89 ',
  '1ee8b-1ee9b 1eea1-1eea3 1eea5-1eea9 1eeab-1eebb 1f100-1f10c 1fbf0-1fbf9 20000-2a6df 2a700-2b738 2b740-2b81d 2b820-2cea1 2ceb0-2ebe0 ',
  '2f800-2fa1d 30000-3134a ',
].join('').trim().split(' ').map(range => range.split('-').map(point => `\\u{${point}}`).join('-')).join('');
const WORD = `[${PYTHON_WORD}]`;
const PYTHON_IGNORECASE_ASCII = { '\u0130': 'i', '\u0131': 'i', '\u017f': 's', '\u212a': 'k' };
const pythonIgnorecase = text => text.replace(/[A-Z\u0130\u0131\u017f\u212a]/g, c => PYTHON_IGNORECASE_ASCII[c] ?? c.toLowerCase());

function fromPython(source) {
  const ignorecase = source.startsWith('(?i)');
  let out = '';
  let inClass = false;
  for (let i = ignorecase ? 4 : 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      const escaped = source[++i];
      if (escaped === 's') out += inClass ? PYTHON_SPACE : `[${PYTHON_SPACE}]`;
      else if (escaped === 'S' && !inClass) out += `[^${PYTHON_SPACE}]`;
      else if (escaped === 'w' && !(inClass && ignorecase)) out += inClass ? PYTHON_WORD : WORD;
      else if (escaped === 'b' && !inClass) out += `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`;
      else if (/^[^A-Za-z0-9]$/.test(escaped ?? '')) out += `\\${escaped}`;
      else throw new Error(`market privacy scan: no JavaScript port for \\${escaped} in a WizMarket pattern`);
    } else {
      if (c === '[' && !inClass) inClass = true;
      else if (c === ']' && inClass) inClass = false;
      else if (c === '(' && source[i + 1] === '?' && !inClass && !/^\(\?(?::|<!)/.test(source.slice(i))) throw new Error('market privacy scan: no JavaScript port for a group in a WizMarket pattern');
      out += ignorecase && c >= 'A' && c <= 'Z' ? c.toLowerCase() : c;
    }
  }
  return { pattern: new RegExp(out, 'u'), ignorecase };
}

const PRIVATE = PRIVATE_SOURCE.map(([label, source]) => [label, fromPython(source)]);

export function privateKind(text) {
  const folded = pythonIgnorecase(text);
  return PRIVATE.find(([, { pattern, ignorecase }]) => pattern.test(ignorecase ? folded : text))?.[0] ?? null;
}

const fail = (where, why) => { throw new Error(`market/registry.json: ${where}: ${why}`); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys, where) => {
  if (!isObject(value)) fail(where, 'not an object');
  const extra = Object.keys(value).filter(key => !keys.includes(key));
  if (extra.length) fail(where, `unknown field ${extra.join(', ')}`);
};
const oneLine = (value, where) => {
  if (typeof value !== 'string' || !value.length || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) fail(where, 'not one line');
  return value;
};

export function isUrl(value) {
  if (typeof value !== 'string') return false;
  const match = /^https:\/\/([^/?#:]+)(?::([0-9]+))?([/?#][\x21-\x7e]*)?$/.exec(value);
  if (!match) return false;
  const [, host, port] = match;
  const labels = host.split('.');
  if (host.length > 253 || labels.length < 2 || !/^[A-Za-z]/.test(labels.at(-1))) return false;
  if (!labels.every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))) return false;
  return port === undefined || (/^[1-9][0-9]*$/.test(port) && Number(port) <= 65535);
}

const calendarDate = value => typeof value === 'string' && DATE.test(value) && !value.startsWith('0000') && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const url = (value, where) => isUrl(value) ? value : fail(where, 'not an https URL in the contract\'s grammar');

function checkProof(listing, commit, where) {
  const kinds = [];
  if (listing.tags.some(tag => RECEIPT_KINDS.includes(tag))) kinds.push('receipt');
  if (listing.tags.includes('skill')) kinds.push('skill');
  if (listing.status === 'listed') {
    if ('proof' in listing) fail(where, 'a listed listing has a proof');
    return;
  }
  if (!kinds.length) fail(where, 'verified, but no tag has a test (driver, harness or skill)');
  exactKeys(listing.proof, kinds, `${where}.proof`);
  for (const kind of kinds) if (!(kind in listing.proof)) fail(`${where}.proof`, `verified without its ${kind} proof`);
  if (listing.proof.receipt) {
    const receipt = listing.proof.receipt;
    exactKeys(receipt, ['path', 'date', 'url'], `${where}.proof.receipt`);
    if (!calendarDate(receipt.date)) fail(`${where}.proof.receipt`, 'date is not a calendar date, YYYY-MM-DD');
    const path = new RegExp(`^receipts/${listing.id}/${receipt.date}-[0-9a-f]{12}\\.txt$`);
    if (typeof receipt.path !== 'string' || !path.test(receipt.path)) fail(`${where}.proof.receipt`, 'path is not receipts/<id>/<date>-<commit>.txt');
    if (receipt.url !== `${WIZMARKET}/blob/${commit}/${receipt.path}`) fail(`${where}.proof.receipt`, 'url is not the receipt at the index\'s commit');
  }
  if (listing.proof.skill) {
    const skill = listing.proof.skill;
    exactKeys(skill, ['source', 'check', 'url'], `${where}.proof.skill`);
    const [repo, at, ...rest] = typeof skill.source === 'string' ? skill.source.split('@') : [];
    if (rest.length || !REPO.test(repo ?? '') || !HEX40.test(at ?? '')) fail(`${where}.proof.skill`, 'source is not <owner>/<repo>@<40-hex commit>');
    oneLine(skill.check, `${where}.proof.skill.check`);
    if (skill.url !== `https://github.com/${repo}/tree/${at}`) fail(`${where}.proof.skill`, 'url is not the source at its commit');
  }
}

function checkListing(listing, commit, where) {
  exactKeys(listing, ['id', ...Object.keys(FIELDS)], where);
  for (const [field, required] of Object.entries(FIELDS)) if (required && !(field in listing)) fail(where, `missing ${field}`);
  if (typeof listing.id !== 'string' || !ID.test(listing.id)) fail(where, 'id is not 2 to 40 lowercase letters, digits or hyphens');
  where = `listing ${listing.id}`;
  oneLine(listing.name, `${where}.name`);
  if ([...oneLine(listing.summary, `${where}.summary`)].length > 140) fail(`${where}.summary`, 'over 140 characters');
  oneLine(listing.plugs_into, `${where}.plugs_into`);
  if (typeof listing.publisher !== 'string' || !LOGIN.test(listing.publisher)) fail(`${where}.publisher`, 'not a GitHub login');
  if ('login' in listing) oneLine(listing.login, `${where}.login`);
  const tags = listing.tags;
  if (!Array.isArray(tags) || tags.length < 1 || tags.length > 8) fail(`${where}.tags`, 'not 1 to 8 tags');
  if (!tags.every(tag => typeof tag === 'string' && TAG.test(tag)) || new Set(tags).size !== tags.length) fail(`${where}.tags`, 'a tag is not lowercase letters, digits and hyphens, or appears twice');
  url(listing.url, `${where}.url`);
  if ('links' in listing) {
    if (!Array.isArray(listing.links) || !listing.links.length) fail(`${where}.links`, 'not a list of at least one link');
    listing.links.forEach((link, i) => {
      exactKeys(link, ['label', 'url'], `${where}.links[${i}]`);
      oneLine(link.label, `${where}.links[${i}].label`);
      url(link.url, `${where}.links[${i}].url`);
    });
  }
  if (!['available', 'being-built'].includes(listing.stage)) fail(`${where}.stage`, 'not available or being-built');
  if (listing.stage === 'being-built' && !listing.links) fail(where, 'being-built without its work link');
  if (!['listed', 'verified'].includes(listing.status)) fail(`${where}.status`, 'not listed or verified');
  checkProof(listing, commit, where);
}

function* strings(value, where) {
  if (typeof value === 'string') yield [where, value];
  else if (Array.isArray(value)) for (const [i, item] of value.entries()) yield* strings(item, `${where}[${i}]`);
  else if (isObject(value)) for (const [key, item] of Object.entries(value)) { yield [`${where} key`, key]; yield* strings(item, `${where}.${key}`); }
}

function repeatedKey(text) {
  const objects = [];
  let previous;
  for (const [token] of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\],:]|[^\s{}[\],:"]+/g)) {
    if (token === '{') objects.push(new Set());
    else if (token === '[') objects.push(null);
    else if (token === '}' || token === ']') objects.pop();
    else if (token[0] === '"' && objects.at(-1) && (previous === '{' || previous === ',')) {
      const key = JSON.parse(token);
      if (objects.at(-1).has(key)) return key;
      objects.at(-1).add(key);
    }
    previous = token;
  }
  return null;
}

export function validate(index) {
  for (const [where, text] of strings(index, 'the index')) {
    if (!text.isWellFormed()) fail(where, 'holds an unpaired surrogate, which is not UTF-8 text');
    const found = privateKind(text);
    if (found) fail(where, `holds what looks like ${found}; listings are public`);
  }
  exactKeys(index, ['commit', 'contract', 'listings'], 'the index');
  if (index.contract !== 'listing.v1') fail('the index', 'contract is not listing.v1');
  if (typeof index.commit !== 'string' || !HEX40.test(index.commit)) fail('the index', 'commit is not 40 lowercase hex');
  if (!Array.isArray(index.listings)) fail('the index', 'listings is not a list');
  index.listings.forEach((listing, i) => {
    checkListing(listing, index.commit, `listing ${i + 1}`);
    if (i && !(index.listings[i - 1].id < listing.id)) fail(`listing ${listing.id}`, 'listings are not sorted by id, each once');
  });
  return index;
}

export function decode(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail('the index', 'not UTF-8 text'); }
}

export function parse(text) {
  let index;
  try { index = JSON.parse(text); } catch { fail('the index', 'not JSON'); }
  const key = repeatedKey(text);
  if (key !== null) fail('the index', `has the key ${SCHEMA_KEYS.has(key) ? key : '(not shown)'} twice in one object`);
  return validate(index);
}

export async function readRegistry(file = REGISTRY) {
  return parse(decode(await readFile(file)));
}

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const link = (href, text) => `<a href="${esc(href)}"${href.startsWith('#') ? '' : ' rel="noreferrer"'}>${esc(text)}</a>`;
export const tagsOf = index => [...new Set(index.listings.flatMap(listing => listing.tags))].sort();

function status(listing) {
  if (listing.status !== 'verified') {
    return '<p class="market-status" data-status="listed"><span class="market-badge">Listed</span> A link, not proven.</p>';
  }
  const proofs = [];
  const { receipt, skill } = listing.proof;
  if (receipt) proofs.push(link(receipt.url, `Kit receipt: 5 of 5 checks on its real host, ${receipt.date}`));
  if (skill) proofs.push(link(skill.url, `Its check passed at ${skill.source.split('@')[0]}@${skill.source.split('@')[1].slice(0, 12)}`));
  return `<p class="market-status" data-status="verified"><span class="market-badge">Verified</span> ${proofs.join('; ')}</p>`;
}

function stage(listing) {
  if (listing.stage !== 'being-built') return '<p class="market-stage" data-stage="available">Available</p>';
  const work = listing.links[0];
  return `<p class="market-stage" data-stage="being-built">Being built: ${link(work.url, work.label)}</p>`;
}

function card(listing) {
  const tags = listing.tags.map(tag => `<li>${link(`#tag-${tag}`, tag)}</li>`).join('');
  const extra = (listing.links ?? []).slice(listing.stage === 'being-built' ? 1 : 0);
  return `<article class="market-card" id="listing-${listing.id}" data-listing="${listing.id}" aria-labelledby="name-${listing.id}">`
    + `<h3 id="name-${listing.id}">${esc(listing.name)}</h3>`
    + `<p class="market-summary">${esc(listing.summary)}</p>`
    + status(listing) + stage(listing)
    + `<dl><dt>Plugs into</dt><dd>${esc(listing.plugs_into)}</dd>`
    + (listing.login ? `<dt>Login</dt><dd>${esc(listing.login)}</dd>` : '')
    + `<dt>Publisher</dt><dd>${esc(listing.publisher)}</dd></dl>`
    + `<ul class="market-tags" aria-label="Tags">${tags}</ul>`
    + `<p class="market-links">${[link(listing.url, 'Get it'), ...extra.map(l => link(l.url, l.label))].join(' · ')}</p>`
    + '</article>';
}

export function render(index) {
  if (!index.listings.length) {
    return '<section class="market-all" aria-labelledby="all-listings"><h2 id="all-listings">Every listing</h2>'
      + `<p class="market-count">0 listings, from WizMarket at commit <code>${index.commit.slice(0, 12)}</code>.</p>`
      + '<p class="market-empty">No listings yet. Anyone can be the first: <a href="#publish">publish your own</a>.</p></section>';
  }
  const tags = tagsOf(index);
  const count = tag => index.listings.filter(listing => listing.tags.includes(tag)).length;
  const verified = index.listings.filter(listing => listing.status === 'verified').length;
  const browse = `<nav class="market-browse" aria-label="Browse by tag"><h2>Browse by tag</h2><ul>${tags.map(tag => `<li>${link(`#tag-${tag}`, `${tag} (${count(tag)})`)}</li>`).join('')}</ul></nav>`;
  const all = `<section class="market-all" aria-labelledby="all-listings"><h2 id="all-listings">Every listing</h2>`
    + `<p class="market-count">${index.listings.length} listing${index.listings.length === 1 ? '' : 's'}, ${verified} verified, from WizMarket at commit <code>${index.commit.slice(0, 12)}</code>.</p>`
    + `<div class="market-cards">${index.listings.map(card).join('')}</div></section>`;
  const byTag = `<section class="market-by-tag" aria-labelledby="by-tag"><h2 id="by-tag">By tag</h2>${tags.map(tag => `<section class="market-tag" id="tag-${tag}" aria-labelledby="heading-tag-${tag}"><h3 id="heading-tag-${tag}">${esc(tag)}</h3><ul>`
    + index.listings.filter(listing => listing.tags.includes(tag)).map(listing => `<li>${link(`#listing-${listing.id}`, listing.name)} <span>${listing.status === 'verified' ? 'Verified' : 'Listed'}</span></li>`).join('')
    + '</ul></section>').join('')}</section>`;
  return browse + all + byTag;
}

export function withMarket(page, section) {
  if (page.includes(START) || page.split('<template data-slot="market"></template>').length !== 2) throw new Error('market page: expected one market slot and no generated section');
  return page.replace('<template data-slot="market"></template>', () => `${START}${section}${END}`);
}

export const summary = index => `${index.listings.length} listing${index.listings.length === 1 ? '' : 's'} at WizMarket ${index.commit.slice(0, 12)}`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, page] = process.argv.slice(2);
  const section = render(await readRegistry(file ? pathToFileURL(file) : REGISTRY));
  process.stdout.write(page ? withMarket(await readFile(page, 'utf8'), section) : section);
}

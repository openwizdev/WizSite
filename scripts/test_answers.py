from datetime import date
import json
from pathlib import Path
import re
import tempfile
import unittest
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent.parent
ANSWERS = ROOT / 'answers'
SCHEMA = ROOT / 'contracts/answer-page.v1.schema.json'


class AnswerPages(unittest.TestCase):
    def test_fixtures(self):
        fixtures = ANSWERS / 'fixtures'
        for case in read_json(fixtures / 'cases.json'):
            with self.subTest(rule=case['rule']):
                page = read_json(fixtures / f"{case['passing']}.json")
                filename = page['slug'] + '.json'
                check_page(page, filename)
                for path, replacement in case['changes'].items():
                    *parts, key = path.split('.')
                    target = page
                    for part in parts:
                        target = target[int(part)] if isinstance(target, list) else target[part]
                    if replacement is None:
                        del target[key]
                    else:
                        target[key] = replacement
                if 'error' in case:
                    with self.assertRaisesRegex(ValueError, case['error']):
                        check_page(page, case.get('filename', filename))
                else:
                    check_page(page, filename)

    def test_answer_files(self):
        check_answers(ANSWERS)

    def test_each_top_level_page_is_checked(self):
        with tempfile.TemporaryDirectory() as temp:
            answers = Path(temp)
            fixtures = answers / 'fixtures'
            fixtures.mkdir()
            (fixtures / 'ignored.json').write_text('{', encoding='utf-8')
            page = read_json(ANSWERS / 'fixtures/example-answer.json')
            (answers / 'example-answer.json').write_text(json.dumps(page), encoding='utf-8')
            check_answers(answers)
            (answers / 'second-page.json').write_text('{}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, r'second-page\.json\.slug: required'):
                check_answers(answers)

    def test_registry_metadata_is_unique(self):
        for field in ('title', 'description'):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temp:
                answers = Path(temp)
                page = read_json(ANSWERS / 'fixtures/example-answer.json')
                (answers / 'example-answer.json').write_text(json.dumps(page), encoding='utf-8')
                page['slug'] = 'second-page'
                other_field = 'title' if field == 'description' else 'description'
                page[other_field] += ' too'
                (answers / 'second-page.json').write_text(json.dumps(page), encoding='utf-8')
                with self.assertRaisesRegex(ValueError, f'duplicate {field}'):
                    check_answers(answers)


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def check_format(value, format_name, field):
    if format_name == 'date':
        try:
            if date.fromisoformat(value).isoformat() == value:
                return
        except ValueError:
            pass
        raise ValueError(f'{field}: expected a valid YYYY-MM-DD date')

    if format_name == 'uri':
        try:
            url = urlsplit(value)
            if url.hostname and url.scheme in ('http', 'https') and not re.search(r'[\s\\]', value):
                return
        except ValueError:
            pass
        raise ValueError(f'{field}: expected an absolute HTTP(S) URL')

    raise ValueError(f'{field}: unsupported format {format_name}')


def check_schema_keywords(value, schema, field):
    if schema is False:
        raise ValueError(f'{field}: only allowed on compare pages')

    types = {'array': list, 'object': dict, 'string': str}
    expected = schema.get('type')
    if expected and not isinstance(value, types[expected]):
        raise ValueError(f'{field}: expected {expected}')
    if 'const' in schema and value != schema['const']:
        raise ValueError(f'{field}: expected {schema["const"]}')
    if 'enum' in schema and value not in schema['enum']:
        raise ValueError(f'{field}: expected one of {", ".join(schema["enum"])}')

    if isinstance(value, dict):
        properties = schema.get('properties', {})
        for key in schema.get('required', []):
            if key not in value:
                raise ValueError(f'{field}.{key}: required')
        for key, item in value.items():
            if key in properties:
                check_schema_keywords(item, properties[key], f'{field}.{key}')
            elif schema.get('additionalProperties') is False:
                raise ValueError(f'{field}.{key}: unknown field')

    if isinstance(value, list):
        minimum = schema.get('minItems', 0)
        if len(value) < minimum:
            raise ValueError(f'{field}: expected at least {minimum} item(s)')
        if 'items' in schema:
            for index, item in enumerate(value):
                check_schema_keywords(item, schema['items'], f'{field}[{index}]')

    if isinstance(value, str):
        if 'maxLength' in schema and len(value) > schema['maxLength']:
            raise ValueError(f'{field}: must be at most {schema["maxLength"]} characters')
        if 'format' in schema:
            check_format(value, schema['format'], field)
        if 'pattern' in schema and not re.search(schema['pattern'], value):
            raise ValueError(f'{field}: must match {schema["pattern"]}')

    for condition in schema.get('allOf', []):
        try:
            check_schema_keywords(value, condition['if'], field)
        except ValueError:
            branch = 'else'
        else:
            branch = 'then'
        if branch in condition:
            check_schema_keywords(value, condition[branch], field)


ABBREVIATION = re.compile(r'\b(?:e\.g|i\.e|vs|Mr|Mrs|Ms|Dr|Prof)\.(?=\s)', re.I)
SENTENCE_END = re.compile(r"""[.!?]+["”’')\]]*(?:\s+|$)""")
SOLICITATION = re.compile(
    r'\b(?:give|leave|drop|add)\b[^.!?\n]{0,40}\b(?:a|your)\s+(?:github\s+)?(?:star|vote)\b'
    r'|(?:^|[.!?\n\[]|\bplease\b|\bremember to\b)\s*(?:vote\s+for|upvote)\s+'
    r'|\bstar\s+(?:us|openwiz|(?:the|this|our)\s+(?:github\s+)?(?:repo(?:sitory)?|project))\b',
    re.I,
)


def check_opening(answer, field):
    text = ABBREVIATION.sub(lambda match: match[0][:-1], answer.strip())
    sentences = SENTENCE_END.split(text)
    if sentences[-1] or len(sentences) not in (3, 4) or any(
        not re.search(r'\w', sentence) for sentence in sentences[:-1]
    ):
        raise ValueError(f'{field}: expected two or three complete sentences')


def check_copy(value, field):
    if isinstance(value, dict):
        for key, item in value.items():
            if key not in ('slug', 'kind', 'url', 'homepage', 'checked'):
                check_copy(item, f'{field}.{key}')
    elif isinstance(value, list):
        for index, item in enumerate(value):
            check_copy(item, f'{field}[{index}]')
    elif SOLICITATION.search(value):
        raise ValueError(f'{field}: must not ask for stars or votes')


def check_page(page, filename):
    check_schema_keywords(page, read_json(SCHEMA), filename)
    expected_filename = f'{page["slug"]}.json'
    if filename != expected_filename:
        raise ValueError(f'filename {filename}: expected {expected_filename}')
    check_opening(page['answer'], f'{filename}.answer')
    check_copy(page, filename)


def check_answers(directory):
    seen = {'title': {}, 'description': {}}
    for path in sorted(directory.glob('*.json')):
        try:
            page = read_json(path)
        except (ValueError, OSError) as error:
            raise ValueError(f'{path.name}: {error}') from error
        check_page(page, path.name)
        for field, entries in seen.items():
            value = page[field]
            if value in entries:
                raise ValueError(f'{path.name}: duplicate {field} also in {entries[value]}')
            entries[value] = path.name


if __name__ == '__main__':
    unittest.main()

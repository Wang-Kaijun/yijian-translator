import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { collectThirdPartyLicenses } from '../scripts/third-party-licenses.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const mitLicense = await readFile(new URL('../node_modules/unified/license', import.meta.url), 'utf8');

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'yijian-licenses-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('yijian-licenses-'));
    await rm(resolved, { recursive: true, force: true });
  });
  return directory;
}

async function addPackage(root, location, metadata, documents = { LICENSE: mitLicense }) {
  const directory = path.join(root, location);
  await mkdir(directory, { recursive: true });
  await mkdir(path.join(directory, 'lib'), { recursive: true });
  await writeFile(path.join(directory, 'package.json'), JSON.stringify(metadata));
  for (const name of ['index.js', 'format.js', 'lib/index.js', 'lib/helper.js']) {
    await writeFile(path.join(directory, name), 'export default 1;\n');
  }
  for (const [name, text] of Object.entries(documents)) await writeFile(path.join(directory, name), text);
}

function metafile(inputs) {
  return { outputs: { 'public/app.js': { inputs: Object.fromEntries(
    Object.entries(inputs).map(([name, bytesInOutput]) => [name, { bytesInOutput }]),
  ) } } };
}

test('covers retained direct, transitive, scoped and nested versions; omits removed code', async t => {
  const root = await fixture(t);
  await addPackage(root, 'node_modules/direct', { name: 'direct', version: '1.0.0', license: 'MIT' });
  await addPackage(root, 'node_modules/@scope/transitive', { name: '@scope/transitive', version: '2.0.0', license: 'MIT' });
  await addPackage(root, 'node_modules/direct/node_modules/@scope/transitive', { name: '@scope/transitive', version: '1.0.0', license: 'MIT' });
  const result = await collectThirdPartyLicenses({ projectRoot: root, metafile: metafile({
    'src/app.mjs': 20,
    'node_modules/direct/index.js': 10,
    'node_modules/direct/lib/helper.js': 5,
    'node_modules/@scope/transitive/index.js': 7,
    'node_modules/direct/node_modules/@scope/transitive/lib/index.js': 8,
    'node_modules/removed/index.js': 0,
  }) });
  assert.deepEqual(result.packages.map(pkg => `${pkg.name}@${pkg.version}`), [
    '@scope/transitive@1.0.0', '@scope/transitive@2.0.0', 'direct@1.0.0',
  ]);
  assert.ok(!result.text.includes('removed'));
});

test('retains full license files, supplemental notices, extracted comments and project notices', async t => {
  const root = await fixture(t);
  const extra = 'Copyright (c) 2004 Original component author\nOriginal component conditions, verbatim.\n';
  const notice = 'Third-party attribution from the original NOTICE file.\n';
  await addPackage(root, 'node_modules/example', { name: 'example', version: '1.0.0', license: 'MIT' }, {
    'LICENSE.md': mitLicense + extra, 'NOTICE.txt': notice,
  });
  const header = '// Copyright (c) Source-only original author\n// Additional original terms.\n';
  await writeFile(path.join(root, 'node_modules/example/index.js'), `${header}\nexport default 1;\n`);
  const result = await collectThirdPartyLicenses({ projectRoot: root,
    metafile: metafile({ 'node_modules/example/index.js': 1 }),
    legalComments: '/*! Original bundled source copyright */\n', projectNotices: 'Adapted upstream prompt notice.\n',
  });
  for (const original of [mitLicense + extra, notice, header, '/*! Original bundled source copyright */\n', 'Adapted upstream prompt notice.\n']) {
    assert.ok(result.text.includes(original));
  }
});

test('fails for absent, empty or incomplete licenses instead of emitting empty declarations', async t => {
  for (const documents of [{}, { LICENSE: '' }, { LICENSE: 'MIT' }]) {
    const root = await fixture(t);
    await addPackage(root, 'node_modules/example', { name: 'example', version: '1.0.0', license: 'MIT' }, documents);
    await assert.rejects(collectThirdPartyLicenses({ projectRoot: root,
      metafile: metafile({ 'node_modules/example/index.js': 1 }),
    }), /(?:Missing or incomplete|Empty legal notice).*example@1\.0\.0/);
  }
});

test('requires review for unsupported or missing license declarations', async t => {
  for (const license of ['GPL-3.0-only', undefined]) {
    const root = await fixture(t);
    await addPackage(root, 'node_modules/example', { name: 'example', version: '1.0.0', license });
    await assert.rejects(collectThirdPartyLicenses({ projectRoot: root,
      metafile: metafile({ 'node_modules/example/index.js': 1 }),
    }), /unsupported license for example@1\.0\.0/);
  }
});

test('upstream supplements are pinned to exact versions, including old npm license metadata', async t => {
  const root = await fixture(t);
  await addPackage(root, 'node_modules/format', { name: 'format', version: '0.2.2', licenses: [{ type: 'MIT' }] }, {});
  await addPackage(root, 'node_modules/remark-math', { name: 'remark-math', version: '6.0.0', license: 'MIT' }, {});
  const result = await collectThirdPartyLicenses({ projectRoot: root,
    metafile: metafile({ 'node_modules/format/format.js': 1, 'node_modules/remark-math/index.js': 1 }),
  });
  assert.match(result.text, /2010 - 2013 Sami Samhuri/);
  assert.match(result.text, /2010 - 2014 Sami Samhuri/);
  assert.match(result.text, /2017 Junyoung Choi/);
  assert.match(result.text, /d5d0660b150810a535bbb07eac6cc96a4510aa24/);
  await addPackage(root, 'node_modules/format', { name: 'format', version: '0.2.3', licenses: [{ type: 'MIT' }] }, {});
  await assert.rejects(collectThirdPartyLicenses({ projectRoot: root,
    metafile: metafile({ 'node_modules/format/format.js': 1 }),
  }), /Missing or incomplete MIT license text for format@0\.2\.3/);
  await addPackage(root, 'node_modules/dompurify', {
    name: 'dompurify', version: '99.0.0', license: '(MPL-2.0 OR Apache-2.0)',
  }, { LICENSE: await readFile(path.join(projectRoot, 'node_modules/dompurify/LICENSE'), 'utf8') });
  await assert.rejects(collectThirdPartyLicenses({ projectRoot: root,
    metafile: metafile({ 'node_modules/dompurify/index.js': 1 }),
  }), /Review embedded component licenses for dompurify@99\.0\.0/);
});

test('the actual browser bundle includes all direct libraries and important transitive notices', async () => {
  const result = await build({
    absWorkingDir: projectRoot, entryPoints: ['src/app.mjs'], bundle: true, minify: true,
    write: false, outfile: 'dist/app.js', target: ['es2022'], legalComments: 'external', metafile: true,
    define: { __STATIC_APP__: 'true' },
  });
  const legalComments = result.outputFiles.find(file => file.path.endsWith('.LEGAL.txt')).text;
  const projectNotices = await readFile(path.join(projectRoot, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
  const licenses = await collectThirdPartyLicenses({ metafile: result.metafile, projectRoot, legalComments, projectNotices });
  const names = new Set(licenses.packages.map(pkg => pkg.name));
  for (const name of ['unified', 'remark-parse', 'remark-gfm', 'remark-frontmatter', 'remark-math', 'marked', 'dompurify', 'format', 'micromark', 'vfile']) {
    assert.ok(names.has(name), `${name} must be covered`);
  }
  assert.ok(!names.has('esbuild'), 'build tool is not shipped in the browser');
  assert.equal(licenses.packages.find(pkg => pkg.name === 'dompurify').license, 'Apache-2.0');
  assert.ok(licenses.text.includes(await readFile(path.join(projectRoot, 'node_modules/dompurify/LICENSE'), 'utf8')));
  assert.ok(licenses.text.includes(await readFile(path.join(projectRoot, 'node_modules/marked/LICENSE'), 'utf8')));
  assert.match(licenses.text, /John Gruber/);
  assert.match(licenses.text, /Cure53 and other contributors/);
  assert.match(licenses.text, /Sebastian McKenzie and other contributors/);
  assert.match(licenses.text, /Facebook, Inc\./);
  assert.match(licenses.text, /2013 James Halliday/);
  assert.match(licenses.text, /Copyright Joyent, Inc\. and other Node contributors/);
  assert.ok(licenses.text.includes(legalComments));
  assert.ok(licenses.text.includes(projectNotices));
});

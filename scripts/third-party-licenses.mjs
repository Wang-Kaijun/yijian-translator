import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const overrideDirectory = new URL('./license-overrides/', import.meta.url);
const divider = '\n\n--------------------\n\n';

function retainedPackageRoots(metafile, projectRoot) {
  if (!metafile?.outputs) throw new Error('License collection requires an esbuild metafile.');
  const roots = new Map();
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, contribution] of Object.entries(output.inputs || {})) {
      if (!(contribution.bytesInOutput > 0)) continue;
      const parts = path.resolve(projectRoot, input).split(path.sep);
      const index = parts.lastIndexOf('node_modules');
      if (index < 0) continue;
      const scoped = parts[index + 1]?.startsWith('@');
      const length = index + (scoped ? 3 : 2);
      if (parts.length <= length) throw new Error(`Cannot identify bundled package: ${input}`);
      const root = parts.slice(0, length).join(path.sep);
      if (!roots.has(root)) roots.set(root, new Set());
      roots.get(root).add(path.resolve(projectRoot, input));
    }
  }
  return [...roots].sort(([a], [b]) => a.localeCompare(b));
}

function leadingLegalComments(source) {
  // Some upstream files have ordinary comments instead of esbuild's @license/!
  // markers (for example vfile's path-browserify and Node.js notices).
  const header = source.match(/^(?:\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$)))+/)?.[0] || '';
  return /copyright|\blicen[cs]e\b/i.test(header) ? header : '';
}

function declaredLicense(metadata) {
  if (typeof metadata.license === 'string') return metadata.license;
  // Old npm packages, including format@0.2.2, use this historical field.
  if (metadata.licenses?.length === 1) return metadata.licenses[0].type;
  return undefined;
}

function selectedLicense(metadata, declared) {
  if (declared === 'MIT') return 'MIT';
  if (metadata.name === 'dompurify' && declared === '(MPL-2.0 OR Apache-2.0)') return 'Apache-2.0';
  throw new Error(`Review the unsupported license for ${metadata.name}@${metadata.version}: ${declared || '(missing)'}`);
}

function validateLicenseText(identity, license, documents) {
  const text = documents.map(document => document.text).join('\n');
  const complete = license === 'MIT'
    ? /copyright/i.test(text) && /permission is hereby granted/i.test(text)
      && /copyright notice and this permission notice/i.test(text) && /SOFTWARE IS PROVIDED/i.test(text)
    : /Apache License\s+Version 2\.0/.test(text) && /END OF TERMS AND CONDITIONS/.test(text);
  if (!complete) throw new Error(`Missing or incomplete ${license} license text for ${identity}`);
}

/** Collect complete notices for npm code actually retained in the browser bundle. */
export async function collectThirdPartyLicenses({
  metafile, projectRoot = process.cwd(), legalComments = '', projectNotices = '',
}) {
  const overrides = JSON.parse(await readFile(new URL('manifest.json', overrideDirectory), 'utf8'));
  const packages = [];
  for (const [root, inputs] of retainedPackageRoots(metafile, projectRoot)) {
    const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    if (!metadata.name || !metadata.version) throw new Error(`Missing package identity in ${root}`);
    const identity = `${metadata.name}@${metadata.version}`;
    const declared = declaredLicense(metadata);
    const license = selectedLicense(metadata, declared);
    const entries = await readdir(root, { withFileTypes: true });
    const documents = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !/^(licen[cs]e|copying|notice)(?:$|[.-])/i.test(entry.name)) continue;
      // DOMPurify offers alternatives; this distribution selects Apache-2.0.
      if (license === 'Apache-2.0' && /^license-mpl$/i.test(entry.name)) continue;
      const text = await readFile(path.join(root, entry.name), 'utf8');
      if (!text.trim()) throw new Error(`Empty legal notice for ${identity}: ${entry.name}`);
      documents.push({ name: entry.name, text });
    }
    const override = overrides[identity];
    if (metadata.name === 'dompurify' && !override) {
      throw new Error(`Review embedded component licenses for ${identity}; no version-matched supplement is available.`);
    }
    if (override) {
      if (override.license !== license) throw new Error(`License override does not match ${identity}`);
      const text = await readFile(new URL(override.file, overrideDirectory), 'utf8');
      documents.push({ name: `${override.file} (verified upstream supplement)`, text });
      if (override.supplementalLicense) validateLicenseText(`${identity} embedded component`, override.supplementalLicense, [{ text }]);
    }
    validateLicenseText(identity, license, documents);
    for (const input of [...inputs].sort()) {
      const text = leadingLegalComments(await readFile(input, 'utf8'));
      if (text) documents.push({ name: `${path.relative(root, input).split(path.sep).join('/')} (original source header)`, text });
    }
    const repository = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url;
    packages.push({ name: metadata.name, version: metadata.version, declaredLicense: declared, license,
      repository, location: path.relative(projectRoot, root).split(path.sep).join('/'), documents, override });
  }
  packages.sort((a, b) => `${a.name}@${a.version}:${a.location}`.localeCompare(`${b.name}@${b.version}:${b.location}`));
  const sections = [
    `Third-party notices for 译间\n\nThis file covers the ${packages.length} npm packages whose code is retained in this browser build.\nFull upstream license texts and notices follow. DOMPurify is used under Apache-2.0.\nOther adapted material and extracted source notices are included below.`,
    ...packages.map(pkg => [
      `${pkg.name} ${pkg.version}\nLicense used: ${pkg.license}\nPackage license declaration: ${pkg.declaredLicense}\nPackage path: ${pkg.location}`,
      pkg.repository ? `Upstream: ${pkg.repository}` : '',
      pkg.override ? `Supplement provenance: ${pkg.override.sources.join('\n')}\n${pkg.override.note}` : '',
      ...pkg.documents.map(document => `--- ${document.name} ---\n${document.text}`),
    ].filter(Boolean).join('\n\n')),
  ];
  if (legalComments.trim()) sections.push(`Source legal comments preserved by esbuild\n\n${legalComments}`);
  if (projectNotices.trim()) sections.push(`Additional third-party notices\n\n${projectNotices}`);
  return { packages, text: `${sections.join(divider)}\n` };
}

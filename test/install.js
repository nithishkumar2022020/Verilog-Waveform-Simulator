const assert = require('assert').strict;
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { runVSCodeCommand, downloadAndUnzipVSCode } = require('@vscode/test-electron');
const manifest = require('../package.json');

async function verifyInstallation() {
  const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH || await downloadAndUnzipVSCode('stable');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'wv-'));
  const args = ['--user-data-dir', path.join(profile, 'data'), '--extensions-dir', path.join(profile, 'extensions')];
  try {
    await runVSCodeCommand([...args, '--install-extension', path.resolve(process.argv[2])], { vscodeExecutablePath });
    const { stdout } = await runVSCodeCommand([...args, '--list-extensions', '--show-versions'], { vscodeExecutablePath });
    assert.ok(stdout.includes(`${manifest.publisher}.${manifest.name}@${manifest.version}`));
  } finally {
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}

verifyInstallation().catch(error => { console.error(error); process.exitCode = 1; });

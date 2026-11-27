const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { runTests } = require('vscode-test');

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'verilog-extension-test-'));
  try {
    await runTests({
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
      extensionDevelopmentPath: path.resolve(__dirname, '..'),
      extensionTestsPath: path.resolve(__dirname, 'suite/index'),
      launchArgs: [
        '--user-data-dir', path.join(profile, 'user-data'),
        '--extensions-dir', path.join(profile, 'extensions'),
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes'
      ]
    });
  } finally {
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch(error => {
  console.error('Failed to run tests', error);
  process.exitCode = 1;
});

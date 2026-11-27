const assert = require('assert').strict;
const vscode = require('vscode');
const path = require('path');
const manifest = require('../package.json');

suite('VS Code extension', function () {
  this.timeout(30000);

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
    assert.ok(extension, 'The VS Code host did not load the extension.');
    await extension.activate();
  });

  test('registers both waveform commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('verilog-simulator.generateWaveform'));
    assert.ok(commands.includes('verilog-simulator.regenerateVcd'));
  });

  test('opens the waveform from either command', async () => {
    const file = path.resolve(__dirname, '../samples/jk_flipflop/jk_ff.v');
    const document = await vscode.workspace.openTextDocument(file);
    for (const command of ['generateWaveform', 'regenerateVcd']) {
      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand('verilog-simulator.' + command);
      let tab;
      const deadline = Date.now() + 5000;
      while (!tab && Date.now() < deadline) {
        tab = vscode.window.tabGroups.all.flatMap(group => group.tabs)
          .find(item => item.label === 'Waveform: jk_ff_tb.v');
        if (!tab) await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(tab, `No waveform opened after ${command}.`);
      await vscode.window.tabGroups.close(tab);
    }
  });
});

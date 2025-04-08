const assert = require('assert');
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

suite('Extension Test Suite', function() {
  this.timeout(10000); // Extension activation can take time
  
  test('Extension should be present', () => {
    assert.ok(vscode.extensions.getExtension('verilog-analyzer'));
  });

  test('Activation', async () => {
    const extension = vscode.extensions.getExtension('verilog-analyzer');
    await extension.activate();
    assert.ok(true);
  });

  test('Command should be registered', async () => {
    const commands = await vscode.commands.getCommands();
    assert.ok(commands.includes('verilog-analyzer.generateWaveform'));
  });

  // This test is skipped as it requires Icarus Verilog to be installed
  // and involves file operations and simulation
  test.skip('Generate waveform for sample counter', async () => {
    // Load sample counter testbench
    const samplePath = path.join(__dirname, '..', 'samples', 'counter_tb.v');
    assert.ok(fs.existsSync(samplePath), 'Sample testbench file not found');
    
    const document = await vscode.workspace.openTextDocument(samplePath);
    await vscode.window.showTextDocument(document);

    // Execute the command
    await vscode.commands.executeCommand('verilog-analyzer.generateWaveform');
    
    // Wait for simulation to complete
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check if VCD file was generated
    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const vcdPath = path.join(workspaceFolder.uri.fsPath, '.verilog-analyzer', 'counter_tb.vcd');
    assert.ok(fs.existsSync(vcdPath), 'VCD file not generated');
  });
}); 
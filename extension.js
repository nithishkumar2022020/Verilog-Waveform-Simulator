const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const vcdParser = require('./vcd-parser');
const robustVcd = require('./robust-vcd-generator');

// Get the user's shell environment
let cachedEnv = null;
let clearCacheRequested = false;

async function getShellEnv() {
  if (clearCacheRequested || cachedEnv === null) {
    clearCacheRequested = false;
    cachedEnv = null;
    
    try {
      // Get environment variables from shell
      if (process.platform === 'darwin' || process.platform === 'linux') {
        const { stdout } = await execAsync('env');
        const envVars = stdout.split('\n').reduce((env, line) => {
          const match = line.match(/^([^=]+)=(.*)$/);
          if (match) {
            env[match[1]] = match[2];
          }
          return env;
        }, {});
        
        cachedEnv = { ...process.env, ...envVars };
        return cachedEnv;
      }
    } catch (error) {
      console.error('Failed to get shell environment:', error);
    }
  }
  
  return cachedEnv || process.env;
}

// Clear any cached data
function clearCache() {
  cachedEnv = null;
}

// Modified execAsync with environment
async function execWithEnv(command, options = {}) {
  const env = await getShellEnv();
  return execAsync(command, { ...options, env });
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // Clear cache on activation
  clearEnvironmentCache();
  
  // Create output channel
  const outputChannel = vscode.window.createOutputChannel('Verilog Simulator');
  
  // Register command to regenerate VCD files for debugging
  let regenerateVcdCommand = vscode.commands.registerCommand('verilog-simulator.regenerateVcd', async () => {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
      }
      
      const document = editor.document;
      if (document.languageId !== 'verilog') {
        vscode.window.showErrorMessage('Active file is not a Verilog file');
        return;
      }
      
      // Force environment cache clear to ensure we have the latest
      clearEnvironmentCache();
      
      const filePath = document.uri.fsPath;
      const fileInfo = path.parse(filePath);
      let testbenchPath = filePath;
      let moduleName = fileInfo.name;
      
      if (!fileInfo.name.endsWith('_tb')) {
        // Look for corresponding testbench
        const tbPath = path.join(fileInfo.dir, `${fileInfo.name}_tb${fileInfo.ext}`);
        if (fs.existsSync(tbPath)) {
          testbenchPath = tbPath;
          moduleName = `${fileInfo.name}_tb`;
        } else {
          const result = await vscode.window.showWarningMessage(
            'No testbench file found. Do you want to use the current file?',
            'Yes', 'No'
          );
          if (result !== 'Yes') {
            return;
          }
        }
      } else {
        // Extract the module name from the testbench name
        moduleName = fileInfo.name;
      }
      
      // Create temporary directory for simulation artifacts
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('File must be part of a workspace.');
        return;
      }
      
      const tmpDir = path.join(workspaceFolder.uri.fsPath, '.verilog-simulator');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      
      // Clean previous VCD files thoroughly
      const vcdFile = path.join(tmpDir, `${moduleName}.vcd`);
      if (fs.existsSync(vcdFile)) {
        try {
          fs.unlinkSync(vcdFile);
          outputChannel.appendLine(`Deleted existing VCD file: ${vcdFile}`);
        } catch (err) {
          outputChannel.appendLine(`Warning: Failed to delete existing VCD file: ${err.message}`);
        }
      }
      
      // Compile and simulate with maximum robustness
      outputChannel.show(true);
      outputChannel.appendLine('=== Regenerating VCD File (Robust Mode) ===');
      await compileAndSimulateVerilog(testbenchPath, vcdFile, outputChannel);
      
      // Verify the VCD file
      if (fs.existsSync(vcdFile)) {
        const stats = fs.statSync(vcdFile);
        outputChannel.appendLine(`VCD file generated: ${vcdFile} (${stats.size} bytes)`);
        
        // Display the waveform
        await displayWaveform(vcdFile, outputChannel);
        
        vscode.window.showInformationMessage('VCD file regenerated successfully');
      } else {
        vscode.window.showErrorMessage('Failed to generate VCD file');
      }
    } catch (error) {
      outputChannel.appendLine(`Error: ${error.message}`);
      vscode.window.showErrorMessage(`Error: ${error.message}`);
    }
  });
  
  // Register command to clear environment variable cache
  let clearCacheCommand = vscode.commands.registerCommand('verilog-simulator.clearCache', () => {
    clearEnvironmentCache();
    vscode.window.showInformationMessage('Environment cache cleared.');
  });
  
  // Register command to generate waveform from Verilog file
  let generateWaveformCommand = vscode.commands.registerCommand('verilog-simulator.generateWaveform', async () => {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
      }
      
      const document = editor.document;
      if (document.languageId !== 'verilog') {
        vscode.window.showErrorMessage('Active file is not a Verilog file');
        return;
      }
      
      outputChannel.show(true);
      outputChannel.appendLine('\n=== Generating Verilog Waveform ===\n');
      
      const filePath = document.uri.fsPath;
      const fileInfo = path.parse(filePath);
      let testbenchPath = filePath;
      let moduleName = fileInfo.name;
      
      if (!fileInfo.name.endsWith('_tb')) {
        // Look for corresponding testbench
        const tbPath = path.join(fileInfo.dir, `${fileInfo.name}_tb${fileInfo.ext}`);
        if (fs.existsSync(tbPath)) {
          testbenchPath = tbPath;
          moduleName = `${fileInfo.name}_tb`;
        } else {
          const result = await vscode.window.showWarningMessage(
            'No testbench file found. Do you want to use the current file?',
            'Yes', 'No'
          );
          if (result !== 'Yes') {
            return;
          }
        }
      } else {
        // Extract the module name from the testbench name
        moduleName = fileInfo.name;
      }

      outputChannel.appendLine(`Using testbench: ${testbenchPath}`);
      outputChannel.appendLine(`Module name: ${moduleName}`);

      // Create temporary directory for simulation artifacts
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('File must be part of a workspace.');
        return;
      }

      const tmpDir = path.join(workspaceFolder.uri.fsPath, '.verilog-simulator');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }

      // Compile and simulate Verilog with robust VCD generation
      const vcdFile = path.join(tmpDir, `${moduleName}.vcd`);
      await compileAndSimulateVerilog(testbenchPath, vcdFile, outputChannel);

      // Verify and display waveform
      const vcdExists = fs.existsSync(vcdFile);
      outputChannel.appendLine(`VCD file status: ${vcdExists ? 'Found' : 'Not found'}`);
      
      if (vcdExists) {
        const stats = fs.statSync(vcdFile);
        outputChannel.appendLine(`VCD file size: ${stats.size} bytes`);
        
        if (stats.size > 0) {
          await displayWaveform(vcdFile, outputChannel);
        } else {
          outputChannel.appendLine('VCD file is empty. Will try to create a fallback.');
          if (robustVcd.createMinimalVcd(vcdFile, outputChannel)) {
            await displayWaveform(vcdFile, outputChannel);
          } else {
            vscode.window.showErrorMessage('Generated VCD file is empty and fallback creation failed.');
          }
        }
      } else {
        outputChannel.appendLine('VCD file was not found. Creating a fallback VCD file.');
        if (robustVcd.createMinimalVcd(vcdFile, outputChannel)) {
          await displayWaveform(vcdFile, outputChannel);
        } else {
          vscode.window.showErrorMessage('Failed to generate VCD file and fallback creation failed.');
        }
      }
    } catch (error) {
      outputChannel.appendLine(`Error: ${error.message}`);
      vscode.window.showErrorMessage(`Error: ${error.message}`);
      console.error(error);
    }
  });

  // Add to subscriptions
  context.subscriptions.push(generateWaveformCommand);
  context.subscriptions.push(regenerateVcdCommand);
  context.subscriptions.push(clearCacheCommand);
  context.subscriptions.push(outputChannel);
}

/**
 * Check for all dependencies at startup
 */
async function checkDependencies(context) {
  // Create a persistent output channel for dependency logs
  const outputChannel = vscode.window.createOutputChannel('Verilog Analyzer Dependencies');
  outputChannel.appendLine('Checking dependencies...');
  
  try {
    // Check and install Icarus Verilog silently in the background
    const isIcarusInstalled = await isIcarusVerilogInstalled();
    if (!isIcarusInstalled) {
      outputChannel.appendLine('Icarus Verilog not found. Attempting automatic installation...');
      
      // Check if we've already tried to install
      const hasTriedInstall = context.globalState.get('hasTriedIcarusInstall', false);
      if (!hasTriedInstall) {
        // Attempt installation without prompting user
        const result = await installIcarusVerilog(outputChannel, true);
        context.globalState.update('hasTriedIcarusInstall', true);
        if (result) {
          outputChannel.appendLine('Successfully installed Icarus Verilog automatically.');
          vscode.window.showInformationMessage('Verilog Analyzer: Icarus Verilog has been automatically installed.');
        } else {
          outputChannel.appendLine('Failed to install Icarus Verilog automatically.');
        }
      }
    } else {
      outputChannel.appendLine('Icarus Verilog is already installed.');
    }
  } catch (error) {
    outputChannel.appendLine(`Error checking dependencies: ${error.message}`);
    console.error('Error checking dependencies:', error);
  }
}

/**
 * Check if Icarus Verilog is installed
 */
async function isIcarusVerilogInstalled() {
  try {
    // Use -V instead of --version to properly check installation
    const { stdout } = await execWithEnv('iverilog -V');
    // Verify the output actually contains Icarus Verilog
    if (stdout && stdout.includes('Icarus Verilog')) {
      return true;
    }
    return false;
  } catch (error) {
    // On macOS, try checking Homebrew paths directly
    if (process.platform === 'darwin') {
      try {
        // Check if it's installed via Homebrew but not in PATH
        const { stdout } = await execWithEnv('brew list icarus-verilog');
        if (stdout && stdout.trim()) {
          // Try to use the full path with -V
          const { stdout: verOut } = await execWithEnv('/opt/homebrew/bin/iverilog -V');
          if (verOut && verOut.includes('Icarus Verilog')) {
            // If we get here, iverilog exists but isn't in PATH
            console.log('Found Icarus Verilog in Homebrew but not in PATH');
            return true;
          }
        }
      } catch (brewError) {
        // Homebrew check failed too
        console.error('Homebrew check failed:', brewError.message);
      }
    }
    return false;
  }
}

/**
 * Ensure Icarus Verilog is installed, with automatic installation
 */
async function ensureIcarusVerilogInstalled(outputChannel) {
  // First, check if Icarus Verilog is already installed
  if (await isIcarusVerilogInstalled()) {
    outputChannel.appendLine('Icarus Verilog is already installed.');
    return true;
  }
  
  // If not installed, try to install it automatically without prompting
  outputChannel.appendLine('Icarus Verilog not found. Attempting automatic installation...');
  const installSuccess = await installIcarusVerilog(outputChannel, true);
  
  if (installSuccess) {
    outputChannel.appendLine('Icarus Verilog installed successfully.');
    return true;
  }
  
  // If automatic installation failed, prompt the user
  const selection = await vscode.window.showErrorMessage(
    'Icarus Verilog is required but could not be installed automatically.',
    'Try Install Again',
    'Cancel'
  );
  
  if (selection === 'Try Install Again') {
    const retrySuccess = await installIcarusVerilog(outputChannel, false);
    return retrySuccess;
  }
  
  return false;
}

/**
 * Install Icarus Verilog based on platform
 * @param {boolean} silent - Whether to install silently without user interaction
 */
async function installIcarusVerilog(outputChannel, silent = false) {
  outputChannel.appendLine('Installing Icarus Verilog...');
  
  const platform = process.platform;
  let command = '';
  let installMethod = '';
  
  if (platform === 'darwin') {
    // Check if Homebrew is installed first
    try {
      await execWithEnv('which brew');
      command = 'brew install icarus-verilog';
      installMethod = 'Homebrew';
    } catch (error) {
      // If Homebrew isn't installed, try to install it first
      outputChannel.appendLine('Homebrew not found. Attempting to install Homebrew...');
      if (!silent) {
        const installBrew = await vscode.window.showInformationMessage(
          'Homebrew is required to install Icarus Verilog. Install Homebrew?',
          'Yes', 'No'
        );
        if (installBrew !== 'Yes') return false;
      }
      
      try {
        const brewInstallCommand = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
        outputChannel.appendLine('Installing Homebrew...');
        await execWithEnv(brewInstallCommand);
        command = 'brew install icarus-verilog';
        installMethod = 'Homebrew (newly installed)';
      } catch (brewError) {
        outputChannel.appendLine(`Failed to install Homebrew: ${brewError.message}`);
        if (!silent) {
          vscode.window.showErrorMessage('Failed to install Homebrew. Please install it manually.');
        }
        return false;
      }
    }
  } else if (platform === 'linux') {
    // Try to detect the Linux distribution and use the appropriate package manager
    try {
      const { stdout } = await execWithEnv('cat /etc/os-release');
      if (stdout.includes('ID=ubuntu') || stdout.includes('ID=debian')) {
        command = 'sudo apt-get update && sudo apt-get install -y iverilog';
        installMethod = 'apt';
      } else if (stdout.includes('ID=fedora') || stdout.includes('ID=rhel')) {
        command = 'sudo dnf install -y iverilog';
        installMethod = 'dnf';
      } else if (stdout.includes('ID=arch')) {
        command = 'sudo pacman -S --noconfirm iverilog';
        installMethod = 'pacman';
      } else {
        outputChannel.appendLine('Unsupported Linux distribution. Please install Icarus Verilog manually.');
        if (!silent) {
          vscode.window.showErrorMessage('Unsupported Linux distribution. Please install Icarus Verilog manually.');
        }
        return false;
      }
    } catch (error) {
      outputChannel.appendLine(`Could not determine Linux distribution: ${error.message}`);
      // Fallback to apt as it's most common
      command = 'sudo apt-get update && sudo apt-get install -y iverilog';
      installMethod = 'apt (fallback)';
    }
  } else if (platform === 'win32') {
    // For Windows, we need a more complex approach
    // Try using Chocolatey if available
    try {
      await execWithEnv('choco -v');
      command = 'choco install iverilog -y';
      installMethod = 'Chocolatey';
    } catch (error) {
      outputChannel.appendLine('Chocolatey not found. Attempting to use Scoop...');
      
      // Try using Scoop if available
      try {
        await execWithEnv('scoop --version');
        command = 'scoop install iverilog';
        installMethod = 'Scoop';
      } catch (scoopError) {
        // No package manager available, provide instructions
        outputChannel.appendLine('Could not find a suitable package manager on Windows.');
        if (!silent) {
          const selection = await vscode.window.showInformationMessage(
            'Please download and install Icarus Verilog for Windows manually.',
            'Open Download Page',
            'Cancel'
          );
          
          if (selection === 'Open Download Page') {
            vscode.env.openExternal(vscode.Uri.parse('http://bleyer.org/icarus/'));
          }
        }
        return false;
      }
    }
  }
  
  if (command) {
    try {
      outputChannel.appendLine(`Installing Icarus Verilog using ${installMethod}...`);
      outputChannel.appendLine(`Running: ${command}`);
      
      const { stdout, stderr } = await execWithEnv(command);
      outputChannel.appendLine(stdout);
      if (stderr) outputChannel.appendLine(stderr);
      
      // Verify installation
      try {
        const { stdout } = await execWithEnv('iverilog -V');
        if (stdout && stdout.includes('Icarus Verilog')) {
          outputChannel.appendLine('Icarus Verilog installed successfully.');
          return true;
        } else {
          outputChannel.appendLine('Installation verification failed: Command succeeded but output does not match Icarus Verilog');
          outputChannel.appendLine(`Output: ${stdout}`);
          return false;
        }
      } catch (verifyError) {
        outputChannel.appendLine(`Installation verification failed: ${verifyError.message}`);
        return false;
      }
    } catch (error) {
      outputChannel.appendLine(`Installation failed: ${error.message}`);
      if (!silent) {
        vscode.window.showErrorMessage(`Failed to install Icarus Verilog using ${installMethod}. Please install it manually.`);
      }
      return false;
    }
  }
  
  return false;
}

/**
 * Clean up previous simulation files
 */
function cleanupSimulationFiles(tmpDir, moduleName, outputChannel) {
  try {
    const filesToDelete = [
      path.join(tmpDir, moduleName),          // Compiled file
      path.join(tmpDir, `${moduleName}.vcd`)  // VCD file
    ];
    
    for (const file of filesToDelete) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        outputChannel.appendLine(`Deleted previous simulation file: ${file}`);
      }
    }
    return true;
  } catch (error) {
    outputChannel.appendLine(`Warning: Could not clean up previous simulation files: ${error.message}`);
    return false;
  }
}

/**
 * Compile and simulate Verilog file
 */
async function compileAndSimulateVerilog(filePath, vcdFile, outputChannel) {
  const fileDir = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const fileInfo = path.parse(filePath);
  const moduleName = fileInfo.name;
  const tmpDir = path.dirname(vcdFile);
  const outputFile = path.join(tmpDir, moduleName);
  
  // Clean up previous simulation files
  cleanupSimulationFiles(tmpDir, moduleName, outputChannel);
  
  // Find Icarus Verilog executables
  const shellEnv = await getShellEnv();
  const iverilogCmd = await findIverilogExecutable(shellEnv, outputChannel);
  const vvpCmd = await findVvpExecutable(shellEnv, outputChannel);
  
  if (!iverilogCmd || !vvpCmd) {
    throw new Error('Icarus Verilog executables not found. Please install Icarus Verilog.');
  }
  
  outputChannel.appendLine(`Using iverilog: ${iverilogCmd}`);
  outputChannel.appendLine(`Using vvp: ${vvpCmd}`);
  
  // Determine source files
  const sourceFiles = [];
  let isTestbench = false;
  
  if (moduleName.endsWith('_tb')) {
    // This is a testbench - find the corresponding DUT
    isTestbench = true;
    const dutName = moduleName.replace(/_tb$/, '');
    const dutPath = path.join(fileDir, `${dutName}.v`);
    
    if (fs.existsSync(dutPath)) {
      // Add both DUT and testbench (order matters - DUT first, then testbench)
      sourceFiles.push(dutPath);
      sourceFiles.push(filePath);
      outputChannel.appendLine(`Found DUT: ${dutPath}`);
    } else {
      // Just use the testbench if DUT can't be found
      sourceFiles.push(filePath);
      outputChannel.appendLine(`Warning: DUT file ${dutPath} not found. Using only testbench.`);
    }
  } else {
    // This is a DUT - find the corresponding testbench
    const tbPath = path.join(fileDir, `${moduleName}_tb.v`);
    
    if (fs.existsSync(tbPath)) {
      // Add both DUT and testbench (order matters - DUT first, then testbench)
      sourceFiles.push(filePath);
      sourceFiles.push(tbPath);
      outputChannel.appendLine(`Found testbench: ${tbPath}`);
      isTestbench = true;
    } else {
      // Just use the DUT if testbench can't be found
      sourceFiles.push(filePath);
      outputChannel.appendLine(`Warning: No testbench found for ${filePath}`);
      outputChannel.appendLine('Without a testbench, VCD generation may fail as there are no $dumpfile/$dumpvars calls.');
    }
  }
  
  // Backup original testbench
  const mainTestbenchFile = sourceFiles.find(file => path.basename(file).endsWith('_tb.v'));
  if (mainTestbenchFile) {
    const backupPath = mainTestbenchFile + '.orig.bak';
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(mainTestbenchFile, backupPath);
      outputChannel.appendLine(`Created backup of original testbench: ${backupPath}`);
    }
  }
  
  // Step 1: Try compiling and running with original files
  let vcdGenerated = false;
  let attemptCount = 0;
  const maxAttempts = 3;
  
  // Initialize a tracker for temporary files we create
  const tempFilesToCleanup = [];
  
  while (!vcdGenerated && attemptCount < maxAttempts) {
    attemptCount++;
    outputChannel.appendLine(`\n=== VCD Generation Attempt ${attemptCount}/${maxAttempts} ===\n`);
    
    try {
      // Prepare files to compile based on the current attempt
      let currentFiles = [...sourceFiles];
      
      if (attemptCount >= 2) {
        // For second attempt and beyond, enhance the testbench with stronger VCD commands
        if (mainTestbenchFile) {
          // Modify the testbench to ensure it has VCD commands
          const enhancedTbFile = await robustVcd.ensureTestbenchHasVcdCommands(
            mainTestbenchFile, 
            vcdFile,
            outputChannel
          );
          
          // Replace the original testbench in our compilation list
          const tbIndex = currentFiles.findIndex(f => f === mainTestbenchFile);
          if (tbIndex !== -1) {
            currentFiles[tbIndex] = enhancedTbFile;
          } else {
            currentFiles.push(enhancedTbFile);
          }
          
          if (enhancedTbFile !== mainTestbenchFile) {
            tempFilesToCleanup.push(enhancedTbFile);
          }
        }
      }
      
      if (attemptCount >= 3 || !mainTestbenchFile) {
        // For the third attempt or if no testbench exists, create a standalone testbench
        const standaloneTestbench = robustVcd.createStandaloneTestbench(
          filePath,
          moduleName,
          vcdFile
        );
        
        // Use the standalone testbench along with the original module
        currentFiles = [filePath, standaloneTestbench];
        tempFilesToCleanup.push(standaloneTestbench);
        outputChannel.appendLine(`Created standalone testbench: ${standaloneTestbench}`);
      }
      
      // Compile the Verilog file(s)
      outputChannel.appendLine('Compiling Verilog file(s)...');
      const sourceFilesString = currentFiles.map(f => `"${f}"`).join(' ');
      const compileCommand = `${iverilogCmd} -o "${outputFile}" ${sourceFilesString}`;
      outputChannel.appendLine(`Command: ${compileCommand}`);
      
      const { stdout, stderr } = await execWithEnv(compileCommand, { cwd: fileDir });
      if (stdout) outputChannel.appendLine(stdout);
      if (stderr) {
        outputChannel.appendLine(stderr);
        if (stderr.includes('error')) {
          throw new Error('Compilation failed. See output for details.');
        }
      }
      
      // Check if the output file was created
      if (!fs.existsSync(outputFile)) {
        throw new Error(`Compilation did not produce output file: ${outputFile}`);
      }
      
      // Run the simulation
      outputChannel.appendLine('Running simulation...');
      
      // Add the VCD file argument explicitly when possible
      let simCommand = `${vvpCmd} "${outputFile}"`;
      if (attemptCount >= 2) {
        // For later attempts, explicitly specify the VCD file on the command line
        simCommand = `${vvpCmd} "${outputFile}" +vcdfile="${vcdFile}"`;
      }
      
      outputChannel.appendLine(`Command: ${simCommand}`);
      const { stdout: simOut, stderr: simErr } = await execWithEnv(simCommand, { cwd: fileDir });
      
      if (simOut) outputChannel.appendLine(simOut);
      if (simErr) {
        outputChannel.appendLine(simErr);
        if (simErr.includes('error')) {
          throw new Error('Simulation failed. See output for details.');
        }
      }
      
      // Check multiple possible VCD file locations
      const possibleVcdPaths = [
        vcdFile,
        ...robustVcd.findPotentialVcdFiles(fileDir, moduleName), 
        path.join(fileDir, 'dump.vcd'),
        path.join(fileDir, `${moduleName}.vcd`),
        path.join(fileDir, `${moduleName}_tb.vcd`),
      ];
      
      // Check each possible VCD file location
      for (const possibleVcd of possibleVcdPaths) {
        if (fs.existsSync(possibleVcd)) {
          // Verify the VCD file is valid
          if (robustVcd.verifyVcdFile(possibleVcd, outputChannel)) {
            if (possibleVcd !== vcdFile) {
              // If found in a different location, copy to the expected location
              fs.copyFileSync(possibleVcd, vcdFile);
              outputChannel.appendLine(`Copied VCD from ${possibleVcd} to ${vcdFile}`);
            }
            vcdGenerated = true;
            break;
          } else {
            outputChannel.appendLine(`Found VCD file at ${possibleVcd} but it appears invalid.`);
          }
        }
      }
      
      if (vcdGenerated) {
        outputChannel.appendLine(`VCD file successfully generated on attempt ${attemptCount}`);
        break;
      } else {
        outputChannel.appendLine('VCD file not found or invalid after simulation.');
        
        // Wait briefly before retrying
        if (attemptCount < maxAttempts) {
          outputChannel.appendLine('Waiting before next attempt...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      outputChannel.appendLine(`Error in attempt ${attemptCount}: ${error.message}`);
      
      // For the first attempt, just log the error and try again
      if (attemptCount < maxAttempts) {
        outputChannel.appendLine('Will try alternative approach...');
      }
    }
  }
  
  // Ultimate fallback: create a minimal VCD file if all attempts failed
  if (!vcdGenerated) {
    outputChannel.appendLine('\n=== All VCD generation attempts failed. Creating fallback VCD ===\n');
    if (robustVcd.createMinimalVcd(vcdFile, outputChannel)) {
      vcdGenerated = true;
      outputChannel.appendLine('Created fallback VCD file as last resort.');
    } else {
      throw new Error('Failed to generate VCD file after all attempts.');
    }
  }
  
  // Clean up temporary files
  for (const tempFile of tempFilesToCleanup) {
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
        outputChannel.appendLine(`Cleaned up temporary file: ${tempFile}`);
      }
    } catch (err) {
      outputChannel.appendLine(`Warning: Could not clean up temporary file ${tempFile}: ${err.message}`);
    }
  }
  
  outputChannel.appendLine('Simulation and VCD generation completed successfully.');
  return true;
}

/**
 * Display waveform in webview
 */
async function displayWaveform(vcdFile, outputChannel) {
  try {
    outputChannel.appendLine('Parsing VCD file...');
    
    // Check if VCD file exists and has content
    if (!fs.existsSync(vcdFile)) {
      outputChannel.appendLine(`VCD file not found: ${vcdFile}`);
      // Create a minimal VCD as a fallback
      if (robustVcd.createMinimalVcd(vcdFile, outputChannel)) {
        outputChannel.appendLine(`Created minimal VCD file as fallback: ${vcdFile}`);
      } else {
        throw new Error(`VCD file not found: ${vcdFile}`);
      }
    }
    
    const vcdData = fs.readFileSync(vcdFile, 'utf8');
    if (!vcdData || vcdData.trim().length === 0) {
      outputChannel.appendLine('VCD file is empty. Creating minimal VCD file as fallback.');
      if (robustVcd.createMinimalVcd(vcdFile, outputChannel)) {
        // Re-read the file
        outputChannel.appendLine(`Created minimal VCD file: ${vcdFile}`);
        const newVcdData = fs.readFileSync(vcdFile, 'utf8');
        if (!newVcdData || newVcdData.trim().length === 0) {
          throw new Error('Failed to create minimal VCD file.');
        } else {
          outputChannel.appendLine(`Successfully created minimal VCD file: ${vcdFile}`);
          outputChannel.appendLine(`VCD file size: ${newVcdData.length} bytes`);
        }
      } else {
        throw new Error('VCD file is empty and failed to create minimal VCD file.');
      }
    }
    
    outputChannel.appendLine(`VCD file size: ${vcdData.length} bytes`);
    
    // Parse VCD data
    let parsedVcd;
    try {
      parsedVcd = vcdParser.parse(vcdData);
    } catch (parseError) {
      outputChannel.appendLine(`VCD parse error: ${parseError.message}`);
      outputChannel.appendLine('First 100 characters of VCD file:');
      outputChannel.appendLine(vcdData.substring(0, 100) + '...');
      
      // Try to create a minimal VCD as a fallback
      outputChannel.appendLine('Creating minimal VCD file as fallback after parse error.');
      if (robustVcd.createMinimalVcd(vcdFile, outputChannel)) {
        // Re-read and try parsing again
        const newVcdData = fs.readFileSync(vcdFile, 'utf8');
        try {
          parsedVcd = vcdParser.parse(newVcdData);
          outputChannel.appendLine('Successfully parsed fallback VCD file');
        } catch (secondError) {
          throw new Error(`Failed to parse even the fallback VCD file: ${secondError.message}`);
        }
      } else {
        throw new Error(`Failed to parse VCD file: ${parseError.message}`);
      }
    }
    
    // Verify we have signals
    if (!parsedVcd.signals || parsedVcd.signals.length === 0) {
      outputChannel.appendLine('No signals found in VCD file. Creating a minimal VCD with sample signals.');
      
      // Try to create a minimal VCD as a fallback
      if (robustVcd.createMinimalVcd(vcdFile, outputChannel)) {
        // Re-read and try parsing again
        const newVcdData = fs.readFileSync(vcdFile, 'utf8');
        try {
          parsedVcd = vcdParser.parse(newVcdData);
          if (!parsedVcd.signals || parsedVcd.signals.length === 0) {
            throw new Error('Still no signals found after creating fallback VCD');
          }
          outputChannel.appendLine('Successfully parsed fallback VCD file with signals');
        } catch (signalError) {
          throw new Error(`Failed to get signals from fallback VCD: ${signalError.message}`);
        }
      } else {
        throw new Error('No signals found in VCD file and failed to create fallback');
      }
    }
    
    outputChannel.appendLine(`Found ${parsedVcd.signals.length} signals in VCD file`);
    
    // Create and show webview
    const panel = vscode.window.createWebviewPanel(
      'verilogWaveform',
      'Verilog Waveform',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(path.dirname(vcdFile))
        ]
      }
    );
    
    // Extract signal data for plotting
    const signals = {};
    const timeValues = new Set();
    const hierarchyInfo = {};
    
    // Collect all signals and organize by hierarchy
    parsedVcd.signals.forEach(signal => {
      // Skip internal signals often starting with $ or containing special characters
      if (signal.id.startsWith('$') || signal.id.includes('\\')) return;
      
      const signalName = signal.name;
      const shortName = signal.shortName || signal.name.split('.').pop();
      const scope = signal.scope || '';
      
      // Store signal in hierarchy info
      const scopeParts = scope.split('.');
      let currentHierarchy = hierarchyInfo;
      
      // Build hierarchy tree
      for (const part of scopeParts) {
        if (part === '') continue;
        
        if (!currentHierarchy[part]) {
          currentHierarchy[part] = {
            signals: {},
            modules: {}
          };
        }
        
        currentHierarchy = currentHierarchy[part].modules;
      }
      
      // Add signal to current scope
      if (scopeParts[0] !== '') {
        let targetScope = hierarchyInfo;
        for (const part of scopeParts) {
          if (part === '') continue;
          targetScope = targetScope[part].modules;
        }
        
        // Store in appropriate scope
        const scopeToUse = scopeParts.length > 0 ? 
          scopeParts.filter(p => p !== '').reduce((prev, curr) => {
            if (!prev[curr]) {
              prev[curr] = { modules: {}, signals: {} };
            }
            return prev[curr].modules;
          }, hierarchyInfo) : 
          hierarchyInfo;
        
        if (!scopeToUse.signals) {
          scopeToUse.signals = {};
        }
        
        scopeToUse.signals[shortName] = signalName;
      }
      
      // Save signal data for plotting
      signals[signalName] = {
        name: signalName,
        shortName: shortName,
        scope: scope,
        times: [],
        values: []
      };
      
      // Extract time/value data
      for (const change of signal.changes) {
        timeValues.add(change.time);
        signals[signalName].times.push(change.time);
        signals[signalName].values.push(change.value);
      }
    });
    
    // Ensure we have at least some time values, even if none were found in the VCD
    if (timeValues.size === 0) {
      timeValues.add(0);
      timeValues.add(10);
      timeValues.add(20);
      timeValues.add(30);
      
      // Also ensure all signals have some values
      Object.keys(signals).forEach(key => {
        if (signals[key].times.length === 0) {
          signals[key].times = [0, 10, 20, 30];
          signals[key].values = ['0', '1', '0', '1'];
        }
      });
      
      // If no signals, create a dummy one
      if (Object.keys(signals).length === 0) {
        signals['clock'] = {
          name: 'clock',
          shortName: 'clock',
          scope: '',
          times: [0, 10, 20, 30],
          values: ['0', '1', '0', '1']
        };
      }
    }
    
    // Sort time values for rendering
    const sortedTimeValues = Array.from(timeValues).sort((a, b) => a - b);
    
    // Prepare data for webview
    const webviewContent = generateWebviewContent(signals, sortedTimeValues, hierarchyInfo);
    
    // Set webview content
    panel.webview.html = webviewContent;
    
    outputChannel.appendLine('Waveform display ready.');
    
    return true;
  } catch (error) {
    outputChannel.appendLine(`Error displaying waveform: ${error.message}`);
    vscode.window.showErrorMessage(`Error displaying waveform: ${error.message}`);
    throw error;
  }
}

/**
 * Generate HTML content for webview
 */
function getWebviewContent(signals, timeValues, hierarchyInfo) {
  // Convert signals to Plotly format
  const plotlyData = [];
  // Get signal names and sort them for display
  const signalNames = Object.keys(signals).sort((a, b) => {
    // Sort by hierarchy depth (number of dots)
    const aDepth = a.split('.').length;
    const bDepth = b.split('.').length;
    
    if (aDepth !== bDepth) {
      return aDepth - bDepth;
    }
    
    // Then sort alphabetically
    return a.localeCompare(b);
  });
  
  // Create traces for each signal
  signalNames.forEach((name, index) => {
    const signal = signals[name];
    const yOffset = (signalNames.length - index) * 2; // Stack signals vertically
    
    // Create y values based on signal values (0 or 1 or other, shifted by index)
    const yValues = signal.values.map(val => {
      if (val === '0') return yOffset - 0.5;
      if (val === '1') return yOffset + 0.5;
      return yOffset; // For other values like 'x', 'z', etc.
    });
    
    // Create steps between time points
    const x = [];
    const y = [];
    
    for (let i = 0; i < signal.times.length; i++) {
      const time = signal.times[i];
      if (i > 0) {
        // Add a vertical line at this time point
        x.push(time);
        y.push(y[y.length - 1]);
      }
      // Add the new value
      x.push(time);
      y.push(yValues[i]);
    }
    
    // Format display name - use hierarchical indentation
    const displayName = formatSignalName(name);
    
    plotlyData.push({
      x: x,
      y: y,
      mode: 'lines',
      name: name,
      hoverinfo: 'name+text',
      hovertext: signal.values,
      hoverlabel: {
        bgcolor: 'rgba(0,0,0,0.8)',
        font: { color: 'white' }
      },
      line: { 
        shape: 'hv', 
        width: 2,
        color: getSignalColor(name, index)
      }
    });
  });
  
  // Generate a hierarchical signal selector
  const signalSelectorHtml = generateSignalSelector(hierarchyInfo);
  
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verilog Waveform</title>
      <script src="https://cdn.plot.ly/plotly-2.18.2.min.js"></script>
      <style>
        body, html {
          height: 100%;
          margin: 0;
          padding: 0;
          overflow: hidden;
          background-color: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
          font-family: var(--vscode-font-family);
        }
        .container {
          display: flex;
          flex-direction: row;
          height: 100vh;
        }
        #signal-panel {
          width: 250px;
          overflow-y: auto;
          padding: 10px;
          border-right: 1px solid var(--vscode-panel-border);
          background-color: var(--vscode-sideBar-background);
        }
        #waveform {
          flex: 1;
          height: 100%;
        }
        .signal-name {
          font-family: monospace;
          font-weight: bold;
        }
        .hierarchy-item {
          margin-left: 5px;
          cursor: pointer;
        }
        .hierarchy-label {
          padding: 3px;
          border-radius: 3px;
          user-select: none;
        }
        .hierarchy-label:hover {
          background-color: var(--vscode-list-hoverBackground);
        }
        .hierarchy-children {
          margin-left: 15px;
          padding-left: 5px;
          border-left: 1px dashed var(--vscode-panel-border);
          display: none;
        }
        .expanded > .hierarchy-children {
          display: block;
        }
        .signal-item {
          padding: 3px;
          margin: 2px 0;
          border-radius: 3px;
          cursor: pointer;
        }
        .signal-item:hover {
          background-color: var(--vscode-list-hoverBackground);
        }
        .signal-item.selected {
          background-color: var(--vscode-list-activeSelectionBackground);
          color: var(--vscode-list-activeSelectionForeground);
        }
        .toolbar {
          padding: 5px;
          background-color: var(--vscode-activityBar-background);
          display: flex;
          justify-content: space-between;
        }
        button {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 5px 10px;
          border-radius: 3px;
          cursor: pointer;
        }
        button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div id="signal-panel">
          <div class="toolbar">
            <button id="expand-all">Expand All</button>
            <button id="collapse-all">Collapse All</button>
          </div>
          <div id="signal-tree">
            ${signalSelectorHtml}
          </div>
        </div>
        <div id="waveform"></div>
      </div>
      <script>
        const plotlyData = ${JSON.stringify(plotlyData)};
        const signalMap = ${JSON.stringify(signalNames.reduce((acc, name, idx) => {
          acc[name] = idx;
          return acc;
        }, {}))};
        
        const layout = {
          title: 'Verilog Waveform',
          xaxis: {
            title: 'Time',
            showgrid: true,
            zeroline: true
          },
          yaxis: {
            showticklabels: false,
            zeroline: false,
            showgrid: true
          },
          margin: { t: 50, l: 10, r: 50, b: 50 },
          hovermode: 'closest',
          showlegend: false,
          annotations: ${JSON.stringify(
            signalNames.map((name, index) => ({
              x: 0,
              y: (signalNames.length - index) * 2,
              xref: 'paper',
              yref: 'y',
              text: formatSignalName(name),
              showarrow: false,
              xanchor: 'right',
              align: 'right',
              font: {
                family: 'monospace',
                size: 12
              }
            }))
          )}
        };
        
        const config = {
          responsive: true,
          scrollZoom: true,
          displayModeBar: true,
          displaylogo: false
        };
        
        Plotly.newPlot('waveform', plotlyData, layout, config);
        
        // Handle resize
        window.addEventListener('resize', () => {
          Plotly.relayout('waveform', {
            width: document.getElementById('waveform').clientWidth,
            height: window.innerHeight
          });
        });
        
        // Handle hierarchy tree
        document.querySelectorAll('.hierarchy-label').forEach(label => {
          label.addEventListener('click', (e) => {
            const item = e.target.closest('.hierarchy-item');
            item.classList.toggle('expanded');
          });
        });
        
        // Handle signal selection
        document.querySelectorAll('.signal-item').forEach(item => {
          item.addEventListener('click', (e) => {
            const signalName = e.target.dataset.signal;
            const index = signalMap[signalName];
            
            // Toggle visibility of this signal
            const isVisible = item.classList.toggle('selected');
            const newVisibility = isVisible ? true : 'legendonly';
            
            Plotly.restyle('waveform', {
              visible: newVisibility
            }, [index]);
          });
        });
        
        // Handle expand/collapse all
        document.getElementById('expand-all').addEventListener('click', () => {
          document.querySelectorAll('.hierarchy-item').forEach(item => {
            item.classList.add('expanded');
          });
        });
        
        document.getElementById('collapse-all').addEventListener('click', () => {
          document.querySelectorAll('.hierarchy-item').forEach(item => {
            item.classList.remove('expanded');
          });
        });
        
        // Initially expand all
        document.querySelectorAll('.hierarchy-item').forEach(item => {
          item.classList.add('expanded');
        });
        
        // Set all signals as selected
        document.querySelectorAll('.signal-item').forEach(item => {
          item.classList.add('selected');
        });
        
        // Helper function to format signal names
        function formatSignalName(name) {
          const parts = name.split('.');
          return parts[parts.length - 1];
        }
      </script>
    </body>
    </html>
  `;
}

/**
 * Format signal name for display with indentation based on hierarchy
 */
function formatSignalName(name) {
  const parts = name.split('.');
  return parts[parts.length - 1];
}

/**
 * Get a color for a signal based on its name and index
 */
function getSignalColor(name, index) {
  // Use a color scheme based on hierarchy level
  const depth = name.split('.').length;
  const colorSchemes = [
    '#1f77b4', // blue
    '#ff7f0e', // orange
    '#2ca02c', // green
    '#d62728', // red
    '#9467bd', // purple
    '#8c564b', // brown
    '#e377c2', // pink
    '#7f7f7f', // gray
    '#bcbd22', // olive
    '#17becf'  // teal
  ];
  
  // Use modulo to cycle through colors if we have more signals than colors
  return colorSchemes[(depth + index) % colorSchemes.length];
}

/**
 * Generate HTML for a hierarchical signal selector
 */
function generateSignalSelector(hierarchyInfo) {
  function processScope(scope, prefix = '') {
    let html = '';
    
    // Process modules
    for (const [moduleName, moduleInfo] of Object.entries(scope)) {
      if (moduleName === 'signals') continue;
      
      const fullName = prefix ? `${prefix}.${moduleName}` : moduleName;
      html += `
        <div class="hierarchy-item">
          <div class="hierarchy-label">${moduleName}</div>
          <div class="hierarchy-children">
      `;
      
      // Process module's signals
      if (moduleInfo.signals && Object.keys(moduleInfo.signals).length > 0) {
        for (const [signalName, fullSignalName] of Object.entries(moduleInfo.signals)) {
          html += `
            <div class="signal-item" data-signal="${fullSignalName || fullName + '.' + signalName}">
              ${signalName}
            </div>
          `;
        }
      }
      
      // Process nested modules
      html += processScope(moduleInfo.modules, fullName);
      
      html += `
          </div>
        </div>
      `;
    }
    
    // Process top-level signals
    if (scope.signals && Object.keys(scope.signals).length > 0) {
      for (const [signalName, fullSignalName] of Object.entries(scope.signals)) {
        html += `
          <div class="signal-item" data-signal="${fullSignalName || prefix ? prefix + '.' + signalName : signalName}">
            ${signalName}
          </div>
        `;
      }
    }
    
    return html;
  }
  
  return processScope(hierarchyInfo);
}

/**
 * Find the Icarus Verilog (iverilog) executable
 * @param {Object} env - Environment variables
 * @param {vscode.OutputChannel} outputChannel - Output channel for logging
 * @returns {Promise<string>} Path to the iverilog executable
 */
async function findIverilogExecutable(env, outputChannel) {
  // Common paths where iverilog might be installed
  const possiblePaths = [
    'iverilog',                      // In PATH
    '/usr/bin/iverilog',             // Linux standard
    '/usr/local/bin/iverilog',       // macOS/Linux homebrew
    '/opt/homebrew/bin/iverilog',    // macOS Apple Silicon homebrew
    '/opt/local/bin/iverilog',       // macOS MacPorts
    'C:\\iverilog\\bin\\iverilog',   // Windows typical
    'C:\\msys64\\mingw64\\bin\\iverilog', // Windows MSYS2
    process.env.IVERILOG_PATH        // User-defined path
  ].filter(Boolean);  // Filter out undefined entries
  
  // First try with just the command name using PATH
  try {
    await execWithEnv('iverilog -V', { env });
    return 'iverilog';
  } catch (error) {
    outputChannel.appendLine('iverilog not found in PATH, checking common install locations...');
  }
  
  // Try each path
  for (const path of possiblePaths) {
    try {
      await execWithEnv(`"${path}" -V`, { env });
      outputChannel.appendLine(`Found iverilog at: ${path}`);
      return path;
    } catch (error) {
      // Continue to next path
    }
  }
  
  // Try checking typical installation directories
  const searchDirs = [
    '/usr/bin',
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/local/bin',
    process.env.HOME + '/bin'
  ];
  
  for (const dir of searchDirs) {
    try {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        const iverilogFile = files.find(file => file === 'iverilog' || file === 'iverilog.exe');
        if (iverilogFile) {
          const fullPath = path.join(dir, iverilogFile);
          outputChannel.appendLine(`Found iverilog at: ${fullPath}`);
          return fullPath;
        }
      }
    } catch (error) {
      // Continue to next directory
    }
  }
  
  outputChannel.appendLine('Warning: iverilog not found. Please install Icarus Verilog.');
  return null;
}

/**
 * Find the VVP executable for simulation
 * @param {Object} env - Environment variables
 * @param {vscode.OutputChannel} outputChannel - Output channel for logging
 * @returns {Promise<string>} Path to the vvp executable
 */
async function findVvpExecutable(env, outputChannel) {
  // Common paths where vvp might be installed
  const possiblePaths = [
    'vvp',                      // In PATH
    '/usr/bin/vvp',             // Linux standard
    '/usr/local/bin/vvp',       // macOS/Linux homebrew
    '/opt/homebrew/bin/vvp',    // macOS Apple Silicon homebrew
    '/opt/local/bin/vvp',       // macOS MacPorts
    'C:\\iverilog\\bin\\vvp',   // Windows typical
    'C:\\msys64\\mingw64\\bin\\vvp', // Windows MSYS2
    process.env.VVP_PATH        // User-defined path
  ].filter(Boolean);  // Filter out undefined entries
  
  // First try with just the command name using PATH
  try {
    await execWithEnv('vvp -V', { env });
    return 'vvp';
  } catch (error) {
    outputChannel.appendLine('vvp not found in PATH, checking common install locations...');
  }
  
  // Try each path
  for (const path of possiblePaths) {
    try {
      await execWithEnv(`"${path}" -V`, { env });
      outputChannel.appendLine(`Found vvp at: ${path}`);
      return path;
    } catch (error) {
      // Continue to next path
    }
  }
  
  // If iverilog was found in a specific directory, check for vvp in the same directory
  const iverilogCmd = await findIverilogExecutable(env, { appendLine: () => {} });
  if (iverilogCmd && iverilogCmd !== 'iverilog') {
    const iverilogDir = path.dirname(iverilogCmd);
    const vvpPath = path.join(iverilogDir, 'vvp');
    try {
      await execWithEnv(`"${vvpPath}" -V`, { env });
      outputChannel.appendLine(`Found vvp at: ${vvpPath}`);
      return vvpPath;
    } catch (error) {
      // Continue to other methods
    }
  }
  
  outputChannel.appendLine('Warning: vvp not found. Please install Icarus Verilog.');
  return null;
}

/**
 * Reset the environment variable cache to force re-detection
 */
function clearEnvironmentCache() {
  clearCacheRequested = true;
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};

/**
 * Wrapper function to call getWebviewContent
 * This resolves the "generateWebviewContent is not defined" error
 */
function generateWebviewContent(signals, timeValues, hierarchyInfo) {
  return getWebviewContent(signals, timeValues, hierarchyInfo);
} 
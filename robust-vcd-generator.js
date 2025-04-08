/**
 * Robust VCD Generation Helper
 * Provides utilities to ensure VCD files are always generated
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

/**
 * Verifies that a VCD file exists and is valid
 * @param {string} vcdFile - Path to the VCD file
 * @param {vscode.OutputChannel} outputChannel - Output channel for logging
 * @returns {boolean} True if the VCD file is valid
 */
function verifyVcdFile(vcdFile, outputChannel) {
  try {
    if (!fs.existsSync(vcdFile)) {
      outputChannel.appendLine(`Error: VCD file not found: ${vcdFile}`);
      return false;
    }
    
    const stats = fs.statSync(vcdFile);
    if (stats.size < 100) { // Minimum size for a valid VCD file
      outputChannel.appendLine(`Error: VCD file too small (${stats.size} bytes)`);
      return false;
    }
    
    // Check file header contains VCD signature
    const buffer = Buffer.alloc(100);
    const fd = fs.openSync(vcdFile, 'r');
    fs.readSync(fd, buffer, 0, 100, 0);
    fs.closeSync(fd);
    
    const header = buffer.toString('utf8');
    if (!header.includes('$date') || !header.includes('$timescale')) {
      outputChannel.appendLine(`Error: VCD file header invalid`);
      return false;
    }
    
    outputChannel.appendLine(`VCD file verified: ${vcdFile} (${stats.size} bytes)`);
    return true;
  } catch (err) {
    outputChannel.appendLine(`Error verifying VCD file: ${err.message}`);
    return false;
  }
}

/**
 * Modifies testbench file to ensure it contains VCD generation commands
 * @param {string} tbFile - Path to the testbench file
 * @param {string} vcdPath - Path where VCD should be generated
 * @param {vscode.OutputChannel} outputChannel - Output channel for logging
 * @returns {string} Path to the modified testbench file (may be the same as input)
 */
async function ensureTestbenchHasVcdCommands(tbFile, vcdPath, outputChannel) {
  try {
    const vcdFileName = path.basename(vcdPath);
    let content = fs.readFileSync(tbFile, 'utf8');
    
    // Check if VCD commands already exist
    if (content.includes('$dumpfile') && content.includes('$dumpvars')) {
      outputChannel.appendLine(`Testbench already has VCD commands`);
      return tbFile;
    }
    
    // Extract module name from testbench
    const moduleMatch = content.match(/module\s+([a-zA-Z0-9_]+)/);
    if (!moduleMatch) {
      outputChannel.appendLine(`Could not find module name in testbench`);
      return tbFile;
    }
    
    const moduleName = moduleMatch[1];
    
    // Create VCD commands to insert
    const vcdCommands = `
    // VCD file generation with forced flush
    initial begin
        $dumpfile("${vcdFileName}");
        $dumpvars(0, ${moduleName});  // Level 0 captures all signals
        
        // Force periodic flush
        fork
            begin
                repeat (10) begin
                    #1000;
                    $dumpflush;
                end
            end
        join_none
    end
    
    // Final flush before end
    final begin
        $dumpflush;
        $display("VCD data flushed at end of simulation");
    end\n`;
    
    // Find a good place to insert the commands
    const insertMatch = content.match(/initial\s+begin/);
    let modifiedContent;
    
    if (insertMatch) {
      // Insert before the first initial block
      const insertPos = insertMatch.index;
      modifiedContent = content.slice(0, insertPos) + vcdCommands + content.slice(insertPos);
    } else {
      // If no initial block found, insert after module declaration
      const moduleEndMatch = content.match(/module\s+[a-zA-Z0-9_]+[^;]*;/);
      if (moduleEndMatch) {
        const insertPos = moduleEndMatch.index + moduleEndMatch[0].length;
        modifiedContent = content.slice(0, insertPos) + vcdCommands + content.slice(insertPos);
      } else {
        outputChannel.appendLine(`Could not find a suitable place to insert VCD commands`);
        return tbFile;
      }
    }
    
    // Create a backup
    const backupFile = tbFile + '.bak';
    fs.writeFileSync(backupFile, content);
    outputChannel.appendLine(`Created backup of original testbench: ${backupFile}`);
    
    // Write the modified file to a temporary location
    const tempFile = tbFile + '.vcd_temp.v';
    fs.writeFileSync(tempFile, modifiedContent);
    outputChannel.appendLine(`Added VCD commands to temporary testbench: ${tempFile}`);
    
    return tempFile;
  } catch (err) {
    outputChannel.appendLine(`Error modifying testbench: ${err.message}`);
    return tbFile;
  }
}

/**
 * Creates a minimal VCD file as a fallback when all else fails
 * @param {string} vcdFile - Path to create the VCD file
 * @param {vscode.OutputChannel} outputChannel - Output channel for logging
 * @returns {boolean} True if the operation was successful
 */
function createMinimalVcd(vcdFile, outputChannel) {
  outputChannel.appendLine(`RESCUE: Creating minimal VCD file as last resort`);
  
  try {
    // Create a simple VCD file with just a clock signal
    const minimalVcd = `$date
   ${new Date().toString()}
$end
$version
   Rescue VCD Generator
$end
$timescale
   1ns
$end
$scope module rescue $end
$var wire 1 ! clock $end
$var wire 1 " reset $end
$upscope $end
$enddefinitions $end
$dumpvars
0!
1"
$end
#0
#10
1!
#20
0!
0"
#30
1!
#40
0!
#50
1!
#60
0!
#70
1!
#80
0!
#90
1!
#100
0!
`;
    
    fs.writeFileSync(vcdFile, minimalVcd);
    outputChannel.appendLine(`RESCUE: Created minimal VCD file: ${vcdFile}`);
    
    return true;
  } catch (err) {
    outputChannel.appendLine(`RESCUE: Failed to create minimal VCD: ${err.message}`);
    return false;
  }
}

/**
 * Finds all VCD files in the directory that might match
 * @param {string} directory - Directory to search
 * @param {string} moduleName - Base module name
 * @returns {string[]} List of potential VCD files
 */
function findPotentialVcdFiles(directory, moduleName) {
  try {
    const allFiles = fs.readdirSync(directory);
    return allFiles
      .filter(file => file.endsWith('.vcd'))
      .map(file => path.join(directory, file));
  } catch (err) {
    return [];
  }
}

/**
 * Creates a standalone testbench with forced VCD dump
 * @param {string} verilogFile - Original Verilog file
 * @param {string} moduleName - Module name
 * @param {string} vcdFilePath - Path for the VCD file
 * @returns {string} Path to the generated testbench file
 */
function createStandaloneTestbench(verilogFile, moduleName, vcdFilePath) {
  const vcdFileName = path.basename(vcdFilePath);
  const fileDir = path.dirname(verilogFile);
  const tempTbPath = path.join(fileDir, `${moduleName}_vcd_tb.v`);
  
  const tbContent = `\`timescale 1ns / 1ps

module ${moduleName}_vcd_tb;
    // Common signals
    reg clk;
    reg reset;
    
    // Instantiate the Unit Under Test (UUT)
    ${moduleName} uut (
        .clk(clk),
        .reset(reset)
        // Add more ports as needed
    );
    
    // Clock generation
    initial begin
        clk = 0;
        forever #5 clk = ~clk; // 10ns period
    end
    
    // VCD file generation - multiple methods for redundancy
    initial begin
        // Method 1: Standard VCD dump
        $dumpfile("${vcdFileName}");
        $dumpvars(0, ${moduleName}_vcd_tb);
        
        // Method 2: Explicit dump of UUT
        $dumpvars(0, uut);
        
        // Method 3: Periodic flush
        fork
            begin
                repeat (20) begin
                    #500;
                    $dumpflush;
                end
            end
        join_none
    end
    
    // Final flush
    final begin
        $dumpflush;
    end
    
    // Test sequence
    initial begin
        // Initialize Inputs
        reset = 1;
        
        // Wait a bit
        #20;
        
        // Release reset
        reset = 0;
        
        // Run for a while - longer simulation for more transitions
        #1000;
        
        // End simulation
        $display("Robust VCD generation testbench completed");
        $finish;
    end
endmodule`;

  fs.writeFileSync(tempTbPath, tbContent);
  return tempTbPath;
}

module.exports = {
  verifyVcdFile,
  ensureTestbenchHasVcdCommands,
  createMinimalVcd,
  findPotentialVcdFiles,
  createStandaloneTestbench
}; 
const fs = require('fs').promises;
const { constants } = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { parse } = require('./vcd-parser');

async function findSimulatorTools(env = process.env) {
  const windows = process.platform === 'win32';
  const commonDirectories = windows
    ? ['C:\\iverilog\\bin', 'C:\\msys64\\mingw64\\bin']
    : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/opt/local/bin'];
  const searchDirectories = (env.PATH || '').split(path.delimiter)
    .filter(Boolean)
    .map(directory => windows ? directory.replace(/^"|"$/g, '') : directory)
    .concat(commonDirectories);
  const suffix = windows ? '.exe' : '';

  async function findTool(name, override, directories = searchDirectories) {
    const candidates = override
      ? [path.resolve(override)]
      : directories.map(directory => path.resolve(directory, name + suffix));
    for (const candidate of candidates) {
      try {
        await fs.access(candidate, constants.X_OK);
        if ((await fs.stat(candidate)).isFile()) {
          return candidate;
        }
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR' && error.code !== 'EACCES') {
          throw error;
        }
      }
    }
    throw new Error(`Could not find ${name}${override ? ` at "${override}"` : ''}. Install Icarus Verilog and check your PATH.`);
  }

  const compiler = await findTool('iverilog', env.IVERILOG_PATH);
  const runtime = await findTool('vvp', env.VVP_PATH, [path.dirname(compiler), ...searchDirectories]);
  return { compiler, runtime };
}

function runTool(executable, args, { cwd, timeoutMs, cancellation, output, phase }) {
  return new Promise((resolve, reject) => {
    if (cancellation?.isCancellationRequested) {
      reject(new Error('Simulation cancelled.'));
      return;
    }

    const windows = process.platform === 'win32';
    const child = spawn(executable, args, {
      cwd, detached: !windows, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    function terminateGroup(signal) {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') child.kill(signal);
      }
    }
    let stopReason;
    let forceKillTimer;
    function stop(reason) {
      if (stopReason) return;
      stopReason = reason;
      if (!child.pid) return;
      if (windows) {
        const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
        const kill = spawn(taskkill, ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        kill.once('error', () => child.kill());
        kill.once('close', code => { if (code) child.kill(); });
      } else {
        terminateGroup('SIGTERM');
        forceKillTimer = setTimeout(() => terminateGroup('SIGKILL'), 1000);
      }
    }

    const timer = setTimeout(() => stop(`${phase} timed out after ${timeoutMs / 1000} seconds.`), timeoutMs);
    const subscription = cancellation?.onCancellationRequested(() => stop('Simulation cancelled.'));
    if (cancellation?.isCancellationRequested) stop('Simulation cancelled.');

    let launchError;
    child.once('error', error => { launchError = error; });
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', chunk => output.append(chunk));
    }
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      subscription?.dispose();
      if (stopReason) {
        reject(new Error(stopReason));
      } else if (launchError) {
        reject(new Error(`${phase} could not start: ${launchError.message}`));
      } else if (code !== 0) {
        reject(new Error(`${phase} failed (${signal || `exit code ${code}`}). See the Verilog Simulator output.`));
      } else {
        resolve();
      }
    });
  });
}

async function findWaveforms(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findWaveforms(candidate));
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.vcd') {
      files.push(candidate);
    }
  }
  return files;
}

async function simulate({ sources, sourceDirectory, tools, output, cancellation, timeoutMs, project = {}, root = sourceDirectory }) {
  const runDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'verilog-waveform-'));
  const program = path.join(runDirectory, 'simulation.vvp');
  try {
    const args = ['-o', program];
    const runPath = relative => {
      const target = path.resolve(runDirectory, relative);
      if (!target.startsWith(runDirectory + path.sep)) throw new Error('Use a relative path inside the simulation directory: ' + relative);
      return target;
    };
    const expected = project.dumpFile ? runPath(project.dumpFile) : undefined;
    if (expected) await fs.mkdir(path.dirname(expected), { recursive: true });
    for (const file of project.inputFiles || []) {
      const destination = runPath(file);
      if (destination === expected || path.extname(file).toLowerCase() === '.vcd' || destination === program) {
        throw new Error('Runtime input conflicts with simulation output: ' + file);
      }
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(path.resolve(root, file), destination, constants.COPYFILE_EXCL);
    }
    const language = project.language || (sources.some(file => path.extname(file).toLowerCase() === '.sv') ? '2012' : '2005');
    if (!['2005', '2012'].includes(language)) throw new Error('Choose language 2005 or 2012.');
    args.push('-g' + language);
    if (project.top) args.push('-s', project.top);
    for (const dir of project.includeDirectories || []) args.push('-I', path.resolve(root, dir));
    for (const define of project.defines || []) args.push('-D', define);
    args.push(...sources);
    output.appendLine('Compiling Verilog sources:');
    sources.forEach(source => output.appendLine(`  ${source}`));
    await runTool(tools.compiler, args, {
      cwd: sourceDirectory, timeoutMs, cancellation, output, phase: 'Compilation'
    });

    output.appendLine('Running simulation...');
    await runTool(tools.runtime, ['-N', program], {
      cwd: runDirectory, timeoutMs, cancellation, output, phase: 'Simulation'
    });

    if (cancellation?.isCancellationRequested) throw new Error('Simulation cancelled.');
    const outputs = await findWaveforms(runDirectory);
    const waveforms = expected ? outputs.filter(file => file === expected) : outputs;
    if (waveforms.length === 0) {
      throw new Error('Simulation produced no VCD. Add $dumpfile with a relative .vcd filename and $dumpvars to the testbench.');
    }
    if (waveforms.length > 1) {
      throw new Error('Simulation produced multiple VCD files. Configure the testbench to write one waveform per run.');
    }

    const waveform = waveforms[0];
    let trace;
    try {
      trace = parse(await fs.readFile(waveform, 'utf8'));
    } catch (error) {
      throw new Error(`Could not read waveform "${path.basename(waveform)}": ${error.message}`);
    }
    if (!trace.signals.some(signal => signal.changes.length > 0)) {
      throw new Error('The VCD contains no recorded signal values. Check $dumpvars and the testbench stimulus.');
    }
    if (cancellation?.isCancellationRequested) throw new Error('Simulation cancelled.');
    output.appendLine(`Read ${trace.signals.length} signal declarations from ${path.basename(waveform)}.`);
    return trace;
  } finally {
    try {
      await fs.rm(runDirectory, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
      output.appendLine(`Could not remove temporary simulation files: ${error.message}`);
    }
  }
}

module.exports = { findSimulatorTools, simulate };

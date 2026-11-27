const assert = require('assert').strict;
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { findSimulatorTools, simulate } = require('../simulation');
const { parse } = require('../vcd-parser');

const output = { appendLine() {}, append() {} };

suite('VCD validation', () => {
  test('preserves aliases, printable identifiers, timescale, bus ranges, and final time', () => {
    const trace = parse([
      '$timescale 10 ps $end',
      '$scope module tb $end $var wire 1 $ clk $end',
      '$scope module dut $end $var wire 1 $ clk $end',
      '$var wire 4 ! data [3:0] $end $upscope $end $upscope $end',
      '$enddefinitions $end #0 $dumpvars 0$ b1XZ0 ! $end #2 1$ #4'
    ].join('\n'));
    assert.equal(trace.timescale, '10ps');
    assert.equal(trace.endTime, 4);
    const [clock, alias, data] = trace.signals;
    assert.equal(alias.name, 'tb.dut.clk');
    assert.equal(alias.changes, clock.changes);
    assert.deepEqual(clock.changes, [{ time: 0, value: '0' }, { time: 2, value: '1' }]);
    assert.equal(data.shortName, 'data [3:0]');
    assert.equal(data.changes[0].value, '1xz0');
  });

  test('rejects header-only traces, unknown signal identifiers, and unfinished dumps', () => {
    assert.throws(() => parse('$date sample $end $timescale 1ns $end'), /missing complete signal definitions/);
    const header = '$var wire 1 ! signal $end $enddefinitions $end';
    assert.throws(() => parse(header + ' #0 0?'), /Invalid VCD value change/);
    assert.throws(() => parse(header + ' #0 $dumpvars 0!'), /Unterminated VCD dump block/);
    assert.throws(() => parse(header + ' #4 0! #2 1!'), /Invalid or unsupported VCD timestamp/);
  });
});

suite('Icarus simulation', function () {
  this.timeout(10000);
  let tools;
  let fixture;

  suiteSetup(async () => {
    tools = await findSimulatorTools();
  });
  setup(async () => {
    fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'waveform fixtures '));
  });
  teardown(async () => {
    if (fixture) await fs.rm(fixture, { recursive: true, force: true });
  });

  async function run(testbench, options = {}) {
    const source = path.join(fixture, 'test bench_tb.v');
    await fs.writeFile(source, testbench);
    return simulate({
      sources: [source], sourceDirectory: fixture, tools, output, timeoutMs: 5000, ...options
    });
  }

  const testbenchWithClock = filename => [
    'module tb;',
    'reg clk = 0;',
    `initial begin $dumpfile("${filename}"); $dumpvars(0,tb); #5 clk=1; #5 $finish; end`,
    'endmodule'
  ].join('\n');

  test('runs the bundled JK flip-flop and preserves DUT clock and output aliases', async () => {
    const sample = path.resolve(__dirname, '../samples/jk_flipflop');
    const trace = await simulate({
      sources: ['jk_ff.v', 'jk_ff_tb.v'].map(name => path.join(sample, name)),
      sourceDirectory: sample, tools, output, timeoutMs: 5000
    });
    const signal = name => trace.signals.find(item => item.name === 'jk_ff_tb.' + name);
    assert.equal(trace.timescale, '1ps');
    assert.deepEqual(signal('clk').changes.slice(0, 3), [
      { time: 0, value: '0' }, { time: 5000, value: '1' }, { time: 10000, value: '0' }
    ]);
    assert.deepEqual(signal('reset').changes.slice(0, 2), [
      { time: 0, value: '1' }, { time: 15000, value: '0' }
    ]);
    assert.equal(signal('uut.clk').changes, signal('clk').changes);
    assert.equal(signal('uut.q').changes, signal('q').changes);
    assert.equal(signal('q').changes[0].value, '0');
  });

  test('reports a compiler failure even when an old VCD exists', async () => {
    const stale = path.join(fixture, 'dump.vcd');
    await fs.writeFile(stale, 'original');
    await assert.rejects(run('module tb; invalid syntax endmodule'), /Compilation failed/);
    assert.equal(await fs.readFile(stale, 'utf8'), 'original');
  });

  test('reports missing output even with a valid stale VCD beside the source', async () => {
    const stale = path.join(fixture, 'dump.vcd');
    const original = '$var wire 1 ! stale $end $enddefinitions $end #0 0!';
    await fs.writeFile(stale, original);
    await assert.rejects(run('module tb; initial #1 $finish; endmodule'), /Simulation produced no VCD/);
    assert.equal(await fs.readFile(stale, 'utf8'), original);
    assert.deepEqual((await fs.readdir(fixture)).sort(), ['dump.vcd', 'test bench_tb.v']);
  });

  test('reports simulator failure even if that run wrote a VCD', async () => {
    const stopped = testbenchWithClock('dump.vcd').replace('$finish', '$stop');
    await assert.rejects(run(stopped), /Simulation failed/);
  });

  test('rejects malformed output from the current run', async () => {
    const invalidDump = [
      'module tb; integer f;',
      'initial begin f = $fopen("dump.vcd", "w");',
      '$fdisplay(f, "$timescale 1ns $end"); $fclose(f); #1 $finish; end',
      'endmodule'
    ].join('\n');
    await assert.rejects(run(invalidDump), /missing complete signal definitions/);
  });

  test('does not fabricate changes for a trace that has no recorded values', async () => {
    const emptyDump = [
      'module tb; integer f;',
      'initial begin f = $fopen("dump.vcd", "w");',
      '$fdisplay(f, "$var wire 1 ! clk $end $enddefinitions $end #0");',
      '$fclose(f); #1 $finish; end endmodule'
    ].join('\n');
    await assert.rejects(run(emptyDump), /no recorded signal values/);
  });

  test('isolates parallel runs with the same dump filename', async () => {
    const first = path.join(fixture, 'first.v');
    const second = path.join(fixture, 'second.v');
    const original = testbenchWithClock('dump.vcd');
    await fs.writeFile(first, original);
    await fs.writeFile(second, original.replace(/clk/g, 'other'));
    const args = { sourceDirectory: fixture, tools, output, timeoutMs: 5000 };
    const results = await Promise.all([
      simulate({ ...args, sources: [first] }),
      simulate({ ...args, sources: [second] })
    ]);
    assert.deepEqual(results.map(trace => trace.signals[0].name), ['tb.clk', 'tb.other']);
    assert.equal(await fs.readFile(first, 'utf8'), original);
    assert.deepEqual((await fs.readdir(fixture)).sort(), ['first.v', 'second.v']);
  });

  test('uses the configured top, language, includes, defines, input and dump paths', async () => {
    await fs.mkdir(path.join(fixture, 'headers'));
    await fs.writeFile(path.join(fixture, 'headers', 'lab.vh'), 'localparam WIDTH = `BITS;');
    await fs.writeFile(path.join(fixture, 'initial.hex'), 'a5');
    const trace = await run([
      'module unwanted; initial $fatal; endmodule',
      'module bench;',
      '`include "lab.vh"',
      'logic [WIDTH-1:0] mem [0:0]; wire [WIDTH-1:0] value = mem[0];',
      'initial begin $readmemh("initial.hex",mem); $dumpfile("waves/lab.vcd");',
      '$dumpvars(0,bench); #1 $finish; end endmodule'
    ].join('\n'), { project: { top: 'bench', language: '2012', defines: ['BITS=8'],
      includeDirectories: ['headers'], inputFiles: ['initial.hex'], dumpFile: 'waves/lab.vcd' } });
    assert.equal(trace.signals.find(signal => signal.name.startsWith('bench.value')).changes[0].value, '10100101');
  });

  test('times out a testbench that keeps running', async () => {
    await assert.rejects(
      run('module tb; reg x = 0; always #1 x = ~x; endmodule', { timeoutMs: 1000 }),
      /Simulation timed out/
    );
  });

  test('can cancel a running testbench', async () => {
    let listener;
    let cancelled = false;
    const cancellation = {
      get isCancellationRequested() { return cancelled; },
      onCancellationRequested(callback) {
        listener = callback;
        return { dispose() { listener = undefined; } };
      }
    };
    const cancellingOutput = {
      append() {},
      appendLine(line) {
        if (line === 'Running simulation...') {
          setTimeout(() => {
            cancelled = true;
            listener?.();
          }, 50);
        }
      }
    };
    await assert.rejects(
      run('module tb; reg x = 0; always #1 x = ~x; endmodule', { cancellation, output: cancellingOutput }),
      /Simulation cancelled/
    );
  });
});

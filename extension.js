const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const { findSimulatorTools, simulate } = require('./simulation');

async function getSources(filePath, chooseCurrentFile) {
  const { dir, ext, name } = path.parse(filePath);
  const extensions = [...new Set([ext, '.v', '.sv'])];
  const sibling = basename => extensions
    .map(extension => path.join(dir, basename + extension))
    .find(candidate => fs.existsSync(candidate));

  if (name.endsWith('_tb')) {
    const design = sibling(name.slice(0, -3));
    return design ? [design, filePath] : [filePath];
  }
  const testbench = sibling(name + '_tb');
  if (testbench) return [filePath, testbench];
  return await chooseCurrentFile() ? [filePath] : [];
}

function activate(context) {
  const output = vscode.window.createOutputChannel('Verilog Simulator');
  let cachedTools;
  const plotlyDirectory = vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'plotly.js-dist');
  const plotlyFile = vscode.Uri.joinPath(plotlyDirectory, 'plotly.js');

  async function generateWaveform() {
    const document = vscode.window.activeTextEditor?.document;
    if (!vscode.workspace.isTrusted) {
      vscode.window.showErrorMessage('Trust this workspace before running a simulation.');
      return;
    }
    if (!document || !['.v', '.sv'].includes(path.extname(document.uri.fsPath).toLowerCase()) || document.isUntitled) {
      vscode.window.showErrorMessage('Open a saved Verilog or SystemVerilog source or testbench (.v or .sv).');
      return;
    }

    const filePath = document.uri.fsPath;
    try {
      const project = vscode.workspace.getConfiguration('verilogSimulator', document.uri).get('project', {});
      const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath || path.dirname(filePath);
      const sources = project.sources?.length ? project.sources.map(file => path.resolve(root, file)) : await getSources(filePath, async () =>
        await vscode.window.showWarningMessage(
          'No matching _tb file was found. Simulate the current file?',
          'Simulate Current File'
        ) === 'Simulate Current File'
      );
      if (!sources.length) return;
      const dirty = vscode.workspace.textDocuments.find(item => item.isDirty && sources.includes(item.uri.fsPath));
      if (dirty) throw new Error(`Save "${path.basename(dirty.uri.fsPath)}" before running the simulation.`);

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Running Verilog simulation',
        cancellable: true
      }, async (_progress, cancellation) => {
        cachedTools = cachedTools || await findSimulatorTools();
        const configuredTimeout = vscode.workspace.getConfiguration('verilogSimulator', document.uri)
          .get('timeoutSeconds', 60);
        const timeoutSeconds = Number.isInteger(configuredTimeout) && configuredTimeout >= 1 && configuredTimeout <= 3600
          ? configuredTimeout : 60;
        const trace = await simulate({
          sources,
          sourceDirectory: project.sources?.length ? root : path.dirname(filePath),
          project, root,
          tools: cachedTools,
          output,
          cancellation,
          timeoutMs: timeoutSeconds * 1000
        });
        if (cancellation.isCancellationRequested) return;
        const panel = vscode.window.createWebviewPanel(
          'verilogWaveform',
          `Waveform: ${path.basename(sources[sources.length - 1])}`,
          vscode.ViewColumn.Two,
          { enableScripts: true, localResourceRoots: [plotlyDirectory] }
        );
        panel.webview.html = getWebviewContent(trace, panel.webview.asWebviewUri(plotlyFile), panel.webview.cspSource);
      });
    } catch (error) {
      output.appendLine(error.message);
      if (error.message === 'Simulation cancelled.') return;
      output.show(true);
      vscode.window.showErrorMessage(error.message);
    }
  }

  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('verilog-simulator.generateWaveform', generateWaveform),
    vscode.commands.registerCommand('verilog-simulator.regenerateVcd', generateWaveform),
    vscode.commands.registerCommand('verilog-simulator.clearCache', () => {
      cachedTools = undefined;
      vscode.window.showInformationMessage('Simulator paths will be detected on the next run.');
    })
  );
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function getWebviewContent(trace, plotlyUri, cspSource) {
  const nonce = randomBytes(16).toString('hex');
  const hierarchy = { modules: new Map(), signals: [] };
  const annotations = [];
  const plotlyData = trace.signals.map((signal, index) => {
    const signalName = escapeHtml(signal.name);
    const label = escapeHtml(signal.shortName);
    let scope = hierarchy;
    for (const part of signal.scopes) {
      if (!scope.modules.has(part)) {
        scope.modules.set(part, { modules: new Map(), signals: [] });
      }
      scope = scope.modules.get(part);
    }
    scope.signals.push({ label, index });

    const offset = (trace.signals.length - index) * 2;
    const x = signal.changes.map(change => change.time);
    const values = signal.changes.map(change => change.value);
    if (x.length && x[x.length - 1] < trace.endTime) {
      x.push(trace.endTime);
      values.push(values[values.length - 1]);
    }
    annotations.push({
      x: 0, y: offset, xref: 'paper', yref: 'y', text: label, showarrow: false,
      xanchor: 'right', align: 'right', font: { family: 'monospace', size: 12 }
    });

    return {
      x,
      y: values.map(value => signal.width === 1 && value === '0' ? offset - 0.5
        : signal.width === 1 && value === '1' ? offset + 0.5 : offset),
      mode: 'lines+markers+text',
      text: values.map(value => signal.width > 1 || /[xz]/i.test(value) ? value.toUpperCase() : ''),
      textposition: 'top center',
      marker: { size: 3 },
      name: signalName,
      hoverinfo: 'name+text',
      hovertext: values,
      line: { shape: 'hv', width: 2, color: getSignalColor(signal.name, index) }
    };
  });

  const signalSelectorHtml = generateSignalSelector(hierarchy);
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verilog Waveform</title>
      <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src ${cspSource} 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:;">
      <script nonce="${nonce}" src="${escapeHtml(plotlyUri.toString())}"></script>
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
      <script nonce="${nonce}">
        const plotlyData = ${scriptJson(plotlyData)};
        const layout = {
          title: 'Verilog Waveform',
          xaxis: {
            title: ${JSON.stringify(trace.timescale ? 'Time (' + trace.timescale + ' per tick)' : 'Time (ticks)')},
            showgrid: true,
            zeroline: true
          },
          yaxis: {
            showticklabels: false,
            zeroline: false,
            showgrid: true
          },
          margin: { t: 50, l: 105, r: 50, b: 50 },
          hovermode: 'closest',
          showlegend: false,
          annotations: ${scriptJson(annotations)}
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
          item.addEventListener('click', () => {
            const index = Number(item.dataset.index);
            
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
        
      </script>
    </body>
    </html>
  `;
}

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

function generateSignalSelector(scope) {
  const items = scope.signals.map(({ label, index }) =>
    `<div class="signal-item" data-index="${index}">${label}</div>`);
  for (const [name, child] of scope.modules) {
    items.push(`
      <div class="hierarchy-item">
        <div class="hierarchy-label">${escapeHtml(name)}</div>
        <div class="hierarchy-children">${generateSignalSelector(child)}</div>
      </div>
    `);
  }
  return items.join('');
}

module.exports = { activate };

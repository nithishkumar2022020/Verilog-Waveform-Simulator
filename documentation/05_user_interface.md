# 5. User Interface and Visualization

## 5.1 Overview of the UI Architecture

The Verilog Waveform Analyzer's user interface is built using VS Code's webview system, which allows the extension to create rich, interactive HTML/CSS/JavaScript-based interfaces within the editor. The UI architecture follows a layered approach:

1. **VS Code Integration Layer**: Commands, menus, and extension activation
2. **Extension Core**: Coordination and data processing
3. **Webview Content Generation**: HTML/CSS/JS creation
4. **Interactive Visualization**: Browser-based rendering and user interaction

This architecture enables a seamless experience that feels like a native part of VS Code while providing the rich visualization capabilities needed for waveform display.

## 5.2 VS Code Extension UI Integration

### 5.2.1 Command Registration

The extension registers several commands that appear in VS Code's command palette:

```javascript
let generateWaveformCommand = vscode.commands.registerCommand('verilog-analyzer.generateWaveform', async () => {
  // Implementation details
});

let regenerateVcdCommand = vscode.commands.registerCommand('verilog-analyzer.regenerateVcd', async () => {
  // Implementation details
});

let clearCacheCommand = vscode.commands.registerCommand('verilog-analyzer.clearCache', () => {
  // Implementation details
});

context.subscriptions.push(generateWaveformCommand, regenerateVcdCommand, clearCacheCommand);
```

### 5.2.2 Context Menu Integration

The extension adds entries to the editor context menu for Verilog files:

```json
"menus": {
  "editor/context": [
    {
      "when": "resourceLangId == verilog",
      "command": "verilog-analyzer.generateWaveform",
      "group": "verilog"
    },
    {
      "when": "resourceLangId == verilog",
      "command": "verilog-analyzer.regenerateVcd",
      "group": "verilog"
    }
  ]
}
```

This allows users to right-click on a Verilog file and directly access the waveform generation functionality.

### 5.2.3 Output Channel

The extension creates a dedicated output channel for detailed logging:

```javascript
const outputChannel = vscode.window.createOutputChannel('Verilog Analyzer');
```

This channel provides visibility into the extension's operations, showing compilation commands, simulation output, and diagnostic information.

## 5.3 Webview Panel Creation

The extension creates a webview panel to display the waveform visualization:

```javascript
const panel = vscode.window.createWebviewPanel(
  'verilogWaveform',   // Unique identifier
  'Verilog Waveform',  // Title displayed in tab
  vscode.ViewColumn.Two, // Editor column to show in
  {
    enableScripts: true,
    localResourceRoots: [
      vscode.Uri.file(path.dirname(vcdFile))
    ]
  }
);
```

Key aspects of the webview panel:

1. **Unique Identifier**: Allows the extension to reference the panel
2. **Custom Title**: Clearly indicates the panel's purpose
3. **Column Placement**: By default, opens in the second editor column
4. **Script Enabling**: Required for interactive visualization
5. **Resource Restrictions**: Limits access to specific directories for security

## 5.4 HTML Content Generation

The webview's content is generated dynamically based on the parsed VCD data:

```javascript
function getWebviewContent(signals, timeValues, hierarchyInfo) {
  // Convert signals to Plotly format
  const plotlyData = [];
  // ... data transformation ...
  
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
        /* CSS styles */
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
        // ... JavaScript for interactivity ...
      </script>
    </body>
    </html>
  `;
}
```

This function generates a complete HTML document with:
1. Required HTML structure
2. CSS styling for the interface
3. Embedded JavaScript for interactivity
4. Signal data transformed for visualization
5. Hierarchical signal selector

## 5.5 UI Layout and Components

### 5.5.1 Overall Layout

The UI is organized into a two-pane layout:

```html
<div class="container">
  <div id="signal-panel">
    <!-- Signal selection tree -->
  </div>
  <div id="waveform">
    <!-- Plotly waveform visualization -->
  </div>
</div>
```

This layout provides:
- Left pane for signal selection and organization
- Right pane for the actual waveform display
- Resizable boundary between the panes

### 5.5.2 Signal Selection Panel

The signal selection panel displays a hierarchical tree of signals:

```html
<div id="signal-panel">
  <div class="toolbar">
    <button id="expand-all">Expand All</button>
    <button id="collapse-all">Collapse All</button>
  </div>
  <div id="signal-tree">
    <!-- Hierarchical signal tree -->
  </div>
</div>
```

Key features:
- Hierarchical organization reflecting the design structure
- Expandable/collapsible modules
- Selectable individual signals
- Visual indicators for selected signals

### 5.5.3 Hierarchical Signal Tree Generation

The hierarchical signal tree is generated from the parsed VCD hierarchy:

```javascript
function generateSignalSelector(hierarchy) {
  function renderHierarchyLevel(obj, prefix = '') {
    let html = '';
    
    // Add modules first
    for (const key in obj) {
      if (key !== 'signals' && Object.keys(obj[key]).length > 0) {
        html += `
          <div class="hierarchy-item">
            <div class="hierarchy-label">${key}</div>
            <div class="hierarchy-children">
              ${renderHierarchyLevel(obj[key], prefix ? `${prefix}.${key}` : key)}
            </div>
          </div>
        `;
      }
    }
    
    // Then add signals at this level
    if (obj.signals) {
      for (const signal of obj.signals) {
        const fullName = prefix ? `${prefix}.${signal.name}` : signal.name;
        html += `
          <div class="signal-item" data-signal="${fullName}">
            ${signal.name}
          </div>
        `;
      }
    }
    
    return html;
  }
  
  return renderHierarchyLevel(hierarchy);
}
```

This recursive function creates a nested structure of modules and signals, preserving the design hierarchy.

### 5.5.4 Waveform Display Area

The waveform display area is a simple container for the Plotly visualization:

```html
<div id="waveform"></div>
```

This empty div is populated by Plotly.js with the interactive waveform visualization.

## 5.6 CSS Styling

The CSS styling adapts to VS Code's theming system:

```css
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
```

Key features of this styling:
1. **Theme Integration**: Uses VS Code's CSS variables for colors and fonts
2. **Responsive Layout**: Flexbox-based layout that adapts to window size
3. **Visual Hierarchy**: Clear indication of module structure and signal organization
4. **Interactive Elements**: Proper styling for hover and selection states
5. **Consistent Appearance**: Matches VS Code's native look and feel

## 5.7 Plotly.js Waveform Visualization

### 5.7.1 Plotly Configuration

The Plotly visualization is configured for digital waveform display:

```javascript
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
  annotations: signalNames.map((name, index) => ({
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
};

const config = {
  responsive: true,
  scrollZoom: true,
  displayModeBar: true,
  displaylogo: false
};

Plotly.newPlot('waveform', plotlyData, layout, config);
```

Key aspects of this configuration:
1. **Custom Axes**: X-axis for time, Y-axis for signal values
2. **No Y-Axis Labels**: Uses annotations instead for signal names
3. **Hover Information**: Shows signal values on hover
4. **Zoom and Pan**: Enabled for exploring large waveforms
5. **Responsive Design**: Adapts to container size

### 5.7.2 Digital Signal Trace Creation

Digital signals are represented as step traces:

```javascript
// Create traces for each signal
signalNames.forEach((name, index) => {
  const signal = signals[name];
  const yOffset = (signalNames.length - index) * 2; // Stack signals vertically
  
  // Create y values based on signal values
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
  
  // Add to Plotly data
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
```

This approach creates the characteristic "step" appearance of digital signals, with:
1. **Vertical Spacing**: Each signal is given vertical space to avoid overlap
2. **Value Representation**: High and low states are visually distinct
3. **Vertical Transitions**: Sharp transitions between states
4. **Consistent Coloring**: Each signal has a unique, consistent color

## 5.8 Interactive Features

### 5.8.1 Signal Selection

Users can select which signals to display:

```javascript
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
```

This enables users to focus on signals of interest and reduce visual clutter.

### 5.8.2 Module Expansion/Collapse

The hierarchical signal tree supports expansion and collapse:

```javascript
// Handle hierarchy tree
document.querySelectorAll('.hierarchy-label').forEach(label => {
  label.addEventListener('click', (e) => {
    const item = e.target.closest('.hierarchy-item');
    item.classList.toggle('expanded');
  });
});

// Handle "Expand All" button
document.getElementById('expand-all').addEventListener('click', () => {
  document.querySelectorAll('.hierarchy-item').forEach(item => {
    item.classList.add('expanded');
  });
});

// Handle "Collapse All" button
document.getElementById('collapse-all').addEventListener('click', () => {
  document.querySelectorAll('.hierarchy-item').forEach(item => {
    item.classList.remove('expanded');
  });
});
```

This helps users navigate complex designs with many modules and signals.

### 5.8.3 Zoom and Pan

Plotly.js provides built-in zoom and pan capabilities:

```javascript
const config = {
  responsive: true,
  scrollZoom: true,
  displayModeBar: true,
  displaylogo: false
};
```

These capabilities allow users to:
1. **Zoom In**: Focus on specific time regions
2. **Zoom Out**: See the overall pattern
3. **Pan**: Navigate through time
4. **Reset**: Return to the default view

### 5.8.4 Hover Information

Hover tooltips show signal values at specific times:

```javascript
plotlyData.push({
  // ... other properties ...
  hoverinfo: 'name+text',
  hovertext: signal.values,
  hoverlabel: {
    bgcolor: 'rgba(0,0,0,0.8)',
    font: { color: 'white' }
  }
});
```

This enables precise value inspection without cluttering the main view.

### 5.8.5 Window Resize Handling

The visualization adapts to window size changes:

```javascript
// Handle resize
window.addEventListener('resize', () => {
  Plotly.relayout('waveform', {
    width: document.getElementById('waveform').clientWidth,
    height: window.innerHeight
  });
});
```

This ensures the waveform display remains usable at any window size.

## 5.9 VS Code Theme Integration

The UI adapts to VS Code's theme system for a consistent experience:

```css
body, html {
  background-color: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  font-family: var(--vscode-font-family);
}

button {
  background-color: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.signal-item.selected {
  background-color: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}
```

This ensures that:
1. The waveform viewer matches the user's VS Code theme
2. Light and dark modes are properly supported
3. Visual elements remain consistent with the rest of VS Code
4. Custom themes are respected

## 5.10 Performance Considerations

### 5.10.1 Lazy Rendering

The visualization uses lazy rendering to improve performance:

```javascript
// Only render visible signals
const visibleSignals = signalNames.filter((name, idx) => 
  !document.querySelector(`.signal-item[data-signal="${name}"]`) || 
  document.querySelector(`.signal-item[data-signal="${name}"]`).classList.contains('selected')
);

// Update Plotly with only visible signals
Plotly.update('waveform', 
  visibleSignals.map(name => plotlyData[signalMap[name]]),
  layout
);
```

This approach:
1. Only renders currently visible signals
2. Updates efficiently when selection changes
3. Avoids performance issues with large numbers of signals

### 5.10.2 Throttled Updates

Window resize events are throttled to avoid performance issues:

```javascript
// Throttled resize handler
let resizeTimeout;
window.addEventListener('resize', () => {
  if (resizeTimeout) clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    Plotly.relayout('waveform', {
      width: document.getElementById('waveform').clientWidth,
      height: window.innerHeight
    });
  }, 100);
});
```

This prevents excessive redraws during window resizing.

### 5.10.3 Efficient DOM Updates

The UI minimizes DOM operations for better performance:

```javascript
// Batch DOM updates
function updateSignalVisibility(signalNames, isVisible) {
  // Create a document fragment for efficient updates
  const fragment = document.createDocumentFragment();
  
  signalNames.forEach(name => {
    const element = document.querySelector(`.signal-item[data-signal="${name}"]`);
    if (element) {
      if (isVisible) {
        element.classList.add('selected');
      } else {
        element.classList.remove('selected');
      }
      fragment.appendChild(element.cloneNode(true));
    }
  });
  
  // Batch update
  const container = document.getElementById('signal-tree');
  container.innerHTML = '';
  container.appendChild(fragment);
}
```

This approach improves performance for operations that affect multiple signals.

## 5.11 Accessibility Considerations

The UI includes several accessibility features:

```html
<button id="expand-all" aria-label="Expand all modules">Expand All</button>
<button id="collapse-all" aria-label="Collapse all modules">Collapse All</button>

<div class="signal-item" data-signal="${fullName}" tabindex="0" role="checkbox" aria-checked="${isSelected}">
  ${signal.name}
</div>
```

```css
.signal-item:focus {
  outline: 2px solid var(--vscode-focusBorder);
}

.hierarchy-label:focus {
  outline: 2px solid var(--vscode-focusBorder);
}
```

These features include:
1. **Keyboard Navigation**: All interactive elements are keyboard-accessible
2. **ARIA Attributes**: Proper roles and states for screen readers
3. **Focus Indicators**: Visual indication of keyboard focus
4. **Semantic HTML**: Proper element types for their functions

## 5.12 Examples

### 5.12.1 Basic JK Flip-Flop Visualization

For the JK flip-flop example, the UI shows:

1. **Signal Panel**:
   - Module: `jk_ff_tb`
     - `clk`: Clock signal
     - `reset`: Reset signal
     - `j`: J input
     - `k`: K input
     - `q`: Q output
     - `q_bar`: Complementary output

2. **Waveform Display**:
   - Clock signal showing regular toggling
   - Reset signal transitioning from high to low
   - J and K inputs changing according to test sequence
   - Q output showing the flip-flop behavior
   - Q_bar showing the complementary output

### 5.12.2 Master-Slave JK Flip-Flop Visualization

For the more complex master-slave JK flip-flop, the UI shows:

1. **Signal Panel**:
   - Module: `jk_ms_ff_tb`
     - External signals (`clk`, `reset`, `j`, `k`, `q`, `q_bar`)
   - Module: `jk_ms_ff`
     - Internal signals (`master_q`, `master_qn`, `slave_q`, `slave_qn`)

2. **Waveform Display**:
   - External signals similar to basic JK flip-flop
   - Internal signals showing the master-slave behavior
   - Timing relationships between master and slave stages

This hierarchical organization helps users understand the internal operation of the master-slave flip-flop.

## 5.13 User Interface Best Practices

The UI implementation follows several best practices:

1. **Consistency**: Follows VS Code's design patterns and interaction models
2. **Simplicity**: Focuses on the essential functionality without unnecessary complexity
3. **Feedback**: Provides clear visual feedback for user actions
4. **Performance**: Optimizes rendering and updates for responsive interaction
5. **Adaptability**: Adjusts to different window sizes and VS Code themes
6. **Discoverability**: Uses familiar UI patterns for intuitive operation
7. **Accessibility**: Ensures the UI is usable by all users regardless of abilities

These practices ensure a user-friendly experience that integrates seamlessly with VS Code.
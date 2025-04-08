# Verilog Waveform Simulator

![Verilog Waveform](https://raw.githubusercontent.com/nithishkumar2022020/Verilog-Waveform-Simulator/main/images/screenshot.png)

A VS Code extension that provides robust Verilog simulation and waveform visualization directly within your editor.

## Features

- **One-Click Simulation** - Run Verilog simulations with a single click
- **Interactive Waveform Visualization** - View and analyze signal waveforms
- **Smart Testbench Detection** - Automatically finds and uses testbenches
- **Hierarchical Signal Display** - Easily navigate complex designs
- **Bulletproof VCD Generation** - Multiple fallback mechanisms ensure you always get a waveform

## Requirements

- VS Code 1.60.0 or higher
- Icarus Verilog (for simulation)

## Installation

### Install Icarus Verilog

- **macOS**: `brew install icarus-verilog`
- **Linux**: `sudo apt install iverilog` (Ubuntu/Debian) or `sudo yum install iverilog` (Fedora/RHEL)
- **Windows**: Download and install from [http://bleyer.org/icarus/](http://bleyer.org/icarus/)

### Install the Extension

1. Open VS Code
2. Go to Extensions view (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Verilog Waveform Simulator"
4. Click Install

## Usage

1. Open a Verilog file or testbench (`.v`, `.vh`, or `.sv`)
2. Right-click in the editor and select "Generate Waveform"
3. View the waveform visualization

![Usage Animation](https://raw.githubusercontent.com/nithishkumar2022020/Verilog-Waveform-Simulator/main/images/usage.gif)

## Commands

| Command | Description |
|---------|-------------|
| `Generate Waveform` | Simulate the current file and display waveform |
| `Regenerate VCD File (Robust Mode)` | Force regeneration with maximum resilience |
| `Clear Environment Cache` | Reset cached paths and environment variables |

## Troubleshooting

If the waveform generation fails:

1. Try the "Regenerate VCD File (Robust Mode)" command
2. Check the Verilog Simulator output panel for detailed logs
3. Verify that Icarus Verilog is correctly installed and in your PATH
4. Try clearing the environment cache

## Sample Files

The extension includes sample Verilog files in the `samples` directory:

- JK flip-flop implementations
- Testbenches with and without VCD generation
- Examples of hierarchical designs

## Release Notes

### 0.1.0

- Initial release
- Basic waveform visualization
- Robust VCD generation system
- Hierarchical signal navigation

## License

This extension is licensed under the [MIT License](LICENSE). 
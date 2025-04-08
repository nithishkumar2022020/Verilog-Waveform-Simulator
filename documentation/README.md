# Verilog Waveform Analyzer Documentation

This folder contains comprehensive documentation for the Verilog Waveform Analyzer VS Code extension.

## Getting Started

Start with the [Index](00_index.md) file which provides a complete table of contents and overview of the documentation.

## Documentation Structure

The documentation is organized into several major sections:

1. **Introduction** - Overview and purpose of the extension
2. **Architecture** - Detailed system design and component interactions
3. **Verilog Integration** - How the extension interfaces with Verilog tools
4. **VCD Processing** - How VCD files are generated, parsed, and processed
5. **User Interface** - Visualization components and user interactions
6. **Robustness Features** - Error handling and fallback mechanisms

## Converting Diagrams

The diagrams in the documentation are provided as text files in the `images` directory. To convert them to actual images:

1. For architecture diagrams, you can use tools like [asciiflow.com](https://asciiflow.com/) or [mermaid](https://mermaid.js.org/)
2. For waveform visualizations, screenshots of the actual extension in use are recommended

## Generating PDF Documentation

To generate a PDF version of this documentation:

1. Install a markdown to PDF converter like [Pandoc](https://pandoc.org/)
2. Run the following command from the documentation directory:

```bash
pandoc -s --toc -o verilog-waveform-analyzer-docs.pdf *.md
```

## Contributing to Documentation

When contributing to this documentation:

1. Follow the existing structure and formatting style
2. Ensure technical accuracy of all content
3. Include code examples where appropriate
4. Update diagrams when architecture changes
5. Keep the index synchronized with content changes 
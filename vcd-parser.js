/**
 * Simple VCD (Value Change Dump) parser
 */

const fs = require('fs');

/**
 * Parse VCD file content
 * @param {string} content - VCD file content
 * @returns {Object} Parsed VCD data
 */
function parse(content) {
  const lines = content.split(/\r?\n/);
  
  const result = {
    timescale: '',
    date: '',
    version: '',
    comment: '',
    signals: [],
    valueChanges: {},
    hierarchy: {} // Added to track hierarchical relationships
  };
  
  const scopeStack = [];
  let currentScope = '';
  let inDefinitionSection = true;
  let currentTime = 0;
  const symbolMap = {};
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line === '') continue;
    
    // Parse header information
    if (line.startsWith('$date')) {
      result.date = extractUntil(lines, i, '$end');
      continue;
    }
    
    if (line.startsWith('$version')) {
      result.version = extractUntil(lines, i, '$end');
      continue;
    }
    
    if (line.startsWith('$timescale')) {
      result.timescale = extractUntil(lines, i, '$end');
      continue;
    }
    
    if (line.startsWith('$comment')) {
      result.comment = extractUntil(lines, i, '$end');
      continue;
    }
    
    // Parse scope information
    if (line.startsWith('$scope')) {
      const parts = line.split(' ');
      if (parts.length >= 3) {
        const scope = parts[2];
        scopeStack.push(scope);
        currentScope = scopeStack.join('.');
        
        // Add to hierarchy tracking
        let currentHierarchy = result.hierarchy;
        for (const scopePart of scopeStack) {
          if (!currentHierarchy[scopePart]) {
            currentHierarchy[scopePart] = {};
          }
          currentHierarchy = currentHierarchy[scopePart];
        }
      }
      continue;
    }
    
    if (line.startsWith('$upscope')) {
      scopeStack.pop();
      currentScope = scopeStack.join('.');
      continue;
    }
    
    // Parse variable declarations
    if (line.startsWith('$var')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 5) {
        const type = parts[1];
        const width = parseInt(parts[2]);
        const id = parts[3];
        let name = parts[4];
        
        // Handle signals with array indices
        if (parts.length > 5 && parts[5].startsWith('[') && !parts[5].endsWith(']')) {
          // Combine parts that form array indices
          let j = 5;
          while (j < parts.length && !parts[j].endsWith(']')) {
            name += ' ' + parts[j];
            j++;
          }
          if (j < parts.length) {
            name += ' ' + parts[j];
          }
        }
        
        const fullName = currentScope ? `${currentScope}.${name}` : name;
        
        symbolMap[id] = {
          name: fullName,
          shortName: name,
          scope: currentScope,
          width: width,
          type: type
        };
        
        // Store both fully qualified and relative names
        result.signals.push({
          id: id,
          name: fullName,
          shortName: name,
          scope: currentScope, 
          width: width,
          type: type,
          changes: []
        });
        
        // Add to hierarchy tracking
        let currentHierarchy = result.hierarchy;
        const scopeParts = currentScope ? currentScope.split('.') : [];
        
        for (const scopePart of scopeParts) {
          if (!currentHierarchy[scopePart]) {
            currentHierarchy[scopePart] = {};
          }
          currentHierarchy = currentHierarchy[scopePart];
        }
        
        if (!currentHierarchy.signals) {
          currentHierarchy.signals = [];
        }
        
        currentHierarchy.signals.push({
          id: id,
          name: name,
          fullName: fullName
        });
      }
      continue;
    }
    
    if (line.startsWith('$enddefinitions')) {
      inDefinitionSection = false;
      continue;
    }
    
    if (!inDefinitionSection) {
      // Parse simulation time
      if (line.startsWith('#')) {
        currentTime = parseInt(line.substring(1));
        continue;
      }
      
      // Parse value changes
      if (/^[01xzXZ].*/.test(line)) {
        // Single bit value
        const value = line[0];
        const id = line.substring(1).trim();
        
        if (symbolMap[id]) {
          const signalIndex = result.signals.findIndex(s => s.id === id);
          if (signalIndex !== -1) {
            result.signals[signalIndex].changes.push({
              time: currentTime,
              value: value
            });
          }
        }
      } else if (/^[bB].*/.test(line)) {
        // Vector value
        const parts = line.substring(1).trim().split(/\s+/);
        if (parts.length >= 2) {
          const value = parts[0];
          const id = parts[1];
          
          if (symbolMap[id]) {
            const signalIndex = result.signals.findIndex(s => s.id === id);
            if (signalIndex !== -1) {
              result.signals[signalIndex].changes.push({
                time: currentTime,
                value: value
              });
            }
          }
        }
      }
    }
  }
  
  // Group signals by hierarchy
  result.signals.sort((a, b) => {
    // First sort by scope level (number of dots)
    const aDepth = (a.scope ? a.scope.split('.').length : 0);
    const bDepth = (b.scope ? b.scope.split('.').length : 0);
    
    if (aDepth !== bDepth) {
      return aDepth - bDepth;
    }
    
    // Then sort by scope name
    if (a.scope !== b.scope) {
      return a.scope ? a.scope.localeCompare(b.scope || '') : -1;
    }
    
    // Then sort by signal name
    return a.shortName.localeCompare(b.shortName);
  });
  
  return result;
}

/**
 * Extract text content between current line and an end marker
 * @param {string[]} lines - All lines of the file
 * @param {number} startIndex - Starting line index
 * @param {string} endMarker - End marker to look for
 * @returns {string} Extracted content
 */
function extractUntil(lines, startIndex, endMarker) {
  let content = '';
  let i = startIndex + 1;
  
  while (i < lines.length && !lines[i].trim().startsWith(endMarker)) {
    content += lines[i] + '\n';
    i++;
  }
  
  return content.trim();
}

module.exports = {
  parse,
  
  /**
   * Parse VCD file
   * @param {string} filePath - Path to VCD file
   * @returns {Object} Parsed VCD data
   */
  parseFile: function(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return parse(content);
  }
}; 
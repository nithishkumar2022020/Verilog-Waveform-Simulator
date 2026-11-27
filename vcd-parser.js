const fs = require('fs');

function parse(content) {
  const tokens = content.matchAll(/\S+/g);
  const next = () => tokens.next().value?.[0];
  const result = { timescale: '', date: '', version: '', comment: '', signals: [], endTime: 0 };
  const scopes = [];
  const streams = new Map();
  function readDirective(directive) {
    const args = [];
    for (let token = next(); token !== '$end'; token = next()) {
      if (token === undefined) throw new Error(`Unterminated VCD directive ${directive}.`);
      args.push(token);
    }
    return args;
  }

  let definitionsComplete = false;
  for (let directive = next(); directive !== undefined; directive = next()) {
    const args = readDirective(directive);
    if (directive === '$enddefinitions') {
      if (args.length || scopes.length) throw new Error('Invalid end of VCD definitions.');
      definitionsComplete = true;
      break;
    }
    switch (directive) {
      case '$date':
      case '$version':
      case '$comment':
        result[directive.slice(1)] = args.join(' ');
        break;
      case '$timescale': {
        const scale = args.join('').match(/^(1|10|100)(s|ms|us|ns|ps|fs)$/);
        if (!scale) throw new Error('Invalid VCD timescale.');
        result.timescale = scale[0];
        break;
      }
      case '$scope':
        if (args.length !== 2) throw new Error('Invalid VCD scope declaration.');
        scopes.push(args[1]);
        break;
      case '$upscope':
        if (args.length || scopes.length === 0) throw new Error('Unbalanced VCD scopes.');
        scopes.pop();
        break;
      case '$var': {
        const [type, size, id, reference, ...range] = args;
        const width = Number(size);
        if (!reference || !/^\d+$/.test(size) || !Number.isSafeInteger(width) || width < 1) {
          throw new Error('Invalid VCD signal declaration.');
        }
        const shortName = [reference, ...range].join(' ');
        const scope = scopes.join('.');
        if (!streams.has(id)) streams.set(id, []);
        result.signals.push({
          id, type, width, scope, shortName, scopes: [...scopes],
          name: [...scopes, shortName].join('.'),
          changes: streams.get(id)
        });
        break;
      }
      default:
        throw new Error(`Unsupported VCD declaration ${directive}.`);
    }
  }
  if (!definitionsComplete || result.signals.length === 0) {
    throw new Error('The VCD is missing complete signal definitions.');
  }

  let dumpBlock = false;
  for (let token = next(); token !== undefined; token = next()) {
    if (token === '$comment') {
      readDirective(token);
      continue;
    }
    if (token === '$dumpvars' || token === '$dumpall' || token === '$dumpon' || token === '$dumpoff') {
      if (dumpBlock) throw new Error('Nested VCD dump block.');
      dumpBlock = true;
      continue;
    }
    if (token === '$end' && dumpBlock) {
      dumpBlock = false;
      continue;
    }
    if (token.startsWith('#')) {
      const time = Number(token.slice(1));
      if (dumpBlock || !/^#\d+$/.test(token) || !Number.isSafeInteger(time) || time < result.endTime) {
        throw new Error(`Invalid or unsupported VCD timestamp ${token}.`);
      }
      result.endTime = time;
      continue;
    }

    let id;
    let value;
    if (/^[01xXzZ].+/.test(token)) {
      id = token.slice(1);
      value = token[0].toLowerCase();
    } else if (/^[bB][01xXzZ]+$/.test(token)) {
      id = next();
      value = token.slice(1).toLowerCase();
    } else if (/^[rR][+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(token)) {
      id = next();
      value = token.slice(1);
    }
    const changes = streams.get(id);
    if (!changes) throw new Error(`Invalid VCD value change near tick ${result.endTime}.`);
    changes.push({ time: result.endTime, value });
  }
  if (dumpBlock) throw new Error('Unterminated VCD dump block.');

  return result;
}

function parseFile(filePath) {
  return parse(fs.readFileSync(filePath, 'utf8'));
}

module.exports = { parse, parseFile };

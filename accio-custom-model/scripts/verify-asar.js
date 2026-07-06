const asar = require('D:/AppData/npm/node_modules/@electron/asar/lib/asar');
const fs = require('fs');
const path = require('path');

/**
 * Verify an ASAR file contains expected providers.
 * Usage: node verify-asar.js [path/to/asar] [provider-name]
 * 
 * Examples:
 *   node verify-asar.js                           # verify default modified ASAR
 *   node verify-asar.js "D:/Accio/resources/app.asar" agnes-ai
 */

const archivePath = process.argv[2] || 'D:/Accio/resources/app_modified.asar';
const tempDir = path.join(path.dirname(archivePath), 'app_verify_' + Date.now());
const targetProvider = process.argv[3];

console.log('Verifying ASAR:', archivePath);

// Extract all to temp dir
asar.extractAll(archivePath, tempDir);

// Search for model-catalog files
const catalogFiles = [];
function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.name === 'model-catalog.json') {
      catalogFiles.push(fullPath);
    }
  }
}
walk(tempDir);

console.log('Found', catalogFiles.length, 'model-catalog.json files:');
for (const cf of catalogFiles) {
  const rel = cf.replace(tempDir + path.sep, '');
  const data = JSON.parse(fs.readFileSync(cf, 'utf8'));
  const providers = data.map(p => p.provider);
  console.log(`  ${rel}: [${providers.join(', ')}]`);
  
  if (targetProvider) {
    const hasTarget = data.some(p => p.provider === targetProvider);
    console.log(`    Contains "${targetProvider}": ${hasTarget ? 'YES' : 'NO'}`);
  }
}

// Cleanup temp dir
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('Verification complete.');

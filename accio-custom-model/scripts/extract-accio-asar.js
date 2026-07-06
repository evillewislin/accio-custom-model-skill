# ASAR Extraction Scripts

These Node.js scripts help extract and modify Accio's ASAR bundle.

## Extract Specific File

```javascript
const asar = require('D:/AppData/npm/node_modules/@electron/asar/lib/asar');
const fs = require('fs');
const path = require('path');

const archivePath = 'D:/Accio/resources/app.asar';
const outDir = 'D:/Accio/resources/app_extracted';

// Create output directory if it doesn't exist
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Extract model-catalog.json
const allFiles = asar.listPackage(archivePath);
const catalogFile = allFiles.find(f => f.includes('model-catalog'));
if (catalogFile) {
  const cleanPath = catalogFile.replace(/^\\\\/, '');
  const content = asar.extractFile(archivePath, '/' + cleanPath);
  const catalogPath = path.join(outDir, 'model-catalog.json');
  fs.writeFileSync(catalogPath, content);
  console.log('Extracted model-catalog.json');
} else {
  console.log('model-catalog.json not found in ASAR');
  console.log('Available files:', allFiles.slice(0, 20));
}

// Filter for model-related files
const modelFiles = allFiles.filter(f => f.toLowerCase().includes('model'));
console.log('Model-related files:');
modelFiles.forEach(f => console.log('  ' + f));
```

## Modify and Repack

```javascript
const asar = require('D:/AppData/npm/node_modules/@electron/asar/lib/asar');
const fs = require('fs');
const path = require('path');

const archivePath = 'D:/Accio/resources/app.asar';
const outDir = 'D:/Accio/resources/app_extracted';

// Modify the model-catalog.json
const catalogPath = path.join(outDir, 'model-catalog.json');
let catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

// Add custom provider
catalog.push({
  "provider": "agnes-ai",
  "providerDisplayName": "Agnes AI",
  "modelList": [{
    "modelDisplayName": "Agnes-2.0-Flash",
    "modelName": "agnes-2.0-flash",
    "modelCode": "1Agnes-F4sH2aS8qJ5v",
    "group": "custom",
    "multimodal": true,
    "visible": true,
    "reasoningEfforts": ["low"],
    "defaultReasoningEffort": "low",
    "contextWindow": 1000000,
    "isDefault": false
  }]
});

// Save modified catalog
fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
console.log('Modified model-catalog.json');

// Repack the ASAR — createPackage is ASYNC
asar.createPackage(outDir, archivePath + '.modified', function(err) {
  if (err) {
    console.log('Error repacking:', err);
  } else {
    console.log('Repacked successfully');
  }
});
```

## Verify Modified ASAR

```javascript
const asar = require('D:/AppData/npm/node_modules/@electron/asar/lib/asar');
const archivePath = 'D:/Accio/resources/app.asar.modified';

const files = asar.listPackage(archivePath);
const catalogFile = files.find(f => f.includes('model-catalog'));

if (catalogFile) {
  const cleanPath = catalogFile.replace(/^\\\\/, '');
  const content = asar.extractFile(archivePath, '/' + cleanPath);
  const catalog = JSON.parse(content);
  const hasAgnes = catalog.some(p => p.provider === 'agnes-ai');
  console.log('Modified ASAR contains agnes-ai:', hasAgnes);
}
```

## Notes

- The `asar` library returns paths with leading `\\` — strip them and prepend `/` for extractFile
- Use Node.js script instead of CLI if `asar` command fails on Windows
- Make sure to run scripts with sufficient permissions
- `asar.createPackage()` is ASYNC — use callback, there is no sync version
- Always verify the modified ASAR before replacing the original

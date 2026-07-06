#!/usr/bin/env node
/**
 * Add a custom provider to Accio's model_cache.json
 * 
 * Usage: node add-model-to-cache.js [--provider NAME] [--display DISPLAY_NAME] [--model MODEL_CODE] [--model-name MODEL_NAME]
 * 
 * This script safely appends a custom provider to ~/.accio/model_cache.json.
 * The provider is added with a single model entry.
 * 
 * Example:
 *   node add-model-to-cache.js --provider agnes-ai --display "Agnes AI" --model 1Agnes-F4sH2aS8qJ5v --model-name agnes-2.0-flash
 * 
 * The modelCache.json file is synced from the server on startup, so this
 * addition may be overwritten after an Accio restart. For persistent changes,
 * use the MITM proxy approach instead.
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    const value = args[i + 1];
    if (value && !value.startsWith('--')) {
      options[key] = value;
      i++;
    } else {
      options[key] = true;
    }
  }
}

// Validate required arguments
const required = ['provider', 'display', 'model', 'model-name'];
for (const arg of required) {
  if (!options[arg]) {
    console.error(`Missing required argument: --${arg}`);
    console.error('Usage: node add-model-to-cache.js --provider NAME --display DISPLAY_NAME --model MODEL_CODE --model-name MODEL_NAME');
    process.exit(1);
  }
}

// Determine home directory
const homeDir = process.env.HOME || process.env.USERPROFILE;
const cachePath = path.join(homeDir, '.accio', 'model_cache.json');

// Read existing cache
let cache;
try {
  const content = fs.readFileSync(cachePath, 'utf8');
  cache = JSON.parse(content);
} catch (e) {
  console.error(`Failed to read ${cachePath}: ${e.message}`);
  process.exit(1);
}

// Check if provider already exists
const existingIndex = cache.findIndex(p => p.provider === options.provider);
if (existingIndex >= 0) {
  console.log(`Provider "${options.provider}" already exists at index ${existingIndex}. Updating...`);
  cache[existingIndex].modelList = [{
    modelDisplayName: options.display,
    modelCode: options.model,
    modelName: options['model-name'],
    multimodal: true,
    visible: true,
    reasoningEfforts: ['low'],
    defaultReasoningEffort: 'low',
    contextWindow: 1000000,
    isDefault: false,
    usageLevel: 1,
    usageDesc: 'Standard cost',
    freeUse: true
  }];
} else {
  // Add new provider
  const newProvider = {
    provider: options.provider,
    providerDisplayName: options.display,
    modelList: [{
      modelDisplayName: options.display,
      modelCode: options.model,
      modelName: options['model-name'],
      multimodal: true,
      visible: true,
      reasoningEfforts: ['low'],
      defaultReasoningEffort: 'low',
      contextWindow: 1000000,
      isDefault: false,
      usageLevel: 1,
      usageDesc: 'Standard cost',
      freeUse: true
    }]
  };
  cache.push(newProvider);
  console.log(`Added provider "${options.provider}" to model_cache.json`);
}

// Write back
fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
console.log(`Updated ${cachePath} (${cache.length} providers total)`);
console.log(`Available model codes: ${cache.flatMap(p => p.modelList.map(m => `${p.provider}:${m.modelCode}`)).join(', ')}`);

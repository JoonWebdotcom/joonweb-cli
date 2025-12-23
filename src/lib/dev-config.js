const fs = require('fs-extra');
const path = require('path');

async function loadDevConfig(projectPath) {
  const configPath = path.join(projectPath, 'joonweb.config.js');
  
  try {
    if (await fs.pathExists(configPath)) {
      const config = require(configPath);
      return config.dev || {};
    }
  } catch (error) {
    console.warn('Could not load dev config:', error.message);
  }
  
  return {
    tunnel: true,
    port: 3000,
    open: true
  };
}

module.exports = { loadDevConfig };
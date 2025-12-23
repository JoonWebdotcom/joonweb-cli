const fs = require('fs-extra');
const path = require('path');

async function generateProject(name, template, projectPath) {
  const templatesDir = path.join(__dirname, '../templates', template);
  
  // Copy template files
  if (await fs.pathExists(templatesDir)) {
    await fs.copy(templatesDir, projectPath);
  } else {
    // Create basic structure if template doesn't exist
    await createBasicStructure(name, projectPath);
  }

  // Update package.json with app name
  const packageJsonPath = path.join(projectPath, 'package.json');
  if (await fs.pathExists(packageJsonPath)) {
    const packageJson = await fs.readJson(packageJsonPath);
    packageJson.name = name;
    await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });
  }
}

async function createBasicStructure(name, projectPath) {
  const structure = {
    'package.json': JSON.stringify({
      name: name,
      version: '1.0.0',
      description: 'JoonWeb App',
      main: 'app.js',
      scripts: {
        serve: 'joonweb serve',
        tunnel: 'joonweb tunnel'
      },
      dependencies: {}
    }, null, 2),
    
    'index.html': `<!DOCTYPE html>
<html>
<head>
    <title>${name}</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
    <div id="app">
        <h1>Welcome to ${name}</h1>
        <p>JoonWeb App is running!</p>
    </div>
    <script src="app.js"></script>
</body>
</html>`,

    'app.js': `// JoonWeb App JavaScript
console.log('JoonWeb App loaded!');

// JoonWeb App API integration
if (typeof JoonWeb !== 'undefined') {
    JoonWeb.ready(() => {
        console.log('JoonWeb environment detected');
    });
}`,

    'joonweb.config.js': `module.exports = {
    name: "${name}",
    version: "1.0.0",
    scopes: [],
    endpoints: {
        health: "/health"
    }
};`
  };

  await fs.ensureDir(projectPath);
  
  for (const [filePath, content] of Object.entries(structure)) {
    await fs.writeFile(path.join(projectPath, filePath), content);
  }
}

module.exports = { generateProject };
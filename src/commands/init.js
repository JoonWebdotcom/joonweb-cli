const fs = require('fs-extra');
const path = require('path');
const inquirer = require('inquirer');
const chalk = require('chalk');
const AuthService = require('../services/auth');
const ApiService = require('../services/api');
const os = require('os');

async function AppinitCommand() {
   try {
    const authService = new AuthService();
    const apiService = new ApiService();

    console.log(chalk.cyan('🚀 JoonWeb App Initialization'));
    console.log(chalk.gray('   Create a new app or connect an existing one\n'));

    // Check authentication status
    const authStatus = await authService.getAuthStatus();
    
    if (!authStatus.isLoggedIn) {
      console.log(chalk.yellow('🔐 Authentication required to continue.'));
      console.log(chalk.gray('   You will be guided through device authorization.\n'));
      
      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Continue with authentication?',
          default: true
        }
      ]);

      if (!proceed) {
        console.log(chalk.yellow('❌ Authentication required to create JoonWeb apps.'));
        return;
      }

      // Start device auth flow
      await authService.deviceAuthFlow();
    }
    
    //  apiService.setAuthToken(authService.getAuthToken());

    // Show current user
    const user = await authService.getCurrentUser();
    if (user) {
      console.log(chalk.green(`\n👤 Authenticated as: ${user.name}`));
    }

    // Step 1.1: Check which Organization/Site to use
    let selectedOrg;
    const organizations = await authService.getUserOrganizations();
    if (organizations.length > 1) {
      const { response } = await inquirer.prompt([
        {
          type: 'list',
          name: 'response',
          message: 'Select an organization/site you wish to create app on:',
          choices: organizations.map(org => ({ name: org.name + ` (${org.id})`, value: org }))
        }
      ]);
      selectedOrg = response;
    } else if (organizations.length === 1) {
      selectedOrg = organizations[0];
    } else {
      selectedOrg = null;
    }

    if(!selectedOrg){
      console.log(chalk.yellow('\n⚠️  No organizations/sites found in your account.')); 
      console.log(chalk.gray('   Please create a site or Partner account on JoonWeb platform to manage your apps.\n'));
      return;
    }

    // Save in App Config.

    // if(selectedOrg.type === 'partner'){
    //   // Check for development site
    //     const devSite = await authService.getDevelopmentSite(selectedOrg.id);
    //     if(!devSite){
    //       console.log(chalk.yellow('\n⚠️  No development site found in your Partner account.'));
    //       console.log(chalk.gray('Please create a development site on JoonWeb platform or select from your store to install.\n'));
    //       return;
    //   }
    // }

    // Step 1.2: Choose between new app or existing app
    const { appType } = await inquirer.prompt([
      {
        type: 'list',
        name: 'appType',
        message: 'What would you like to do?',
        choices: [
          { name: 'Create a new JoonWeb app', value: 'new' },
          { name: 'Connect to an existing JoonWeb app', value: 'existing' }
        ]
      }
    ]);

    if (appType === 'new') {
      await createNewApp(apiService, selectedOrg);
    } else {
      await connectExistingApp(authService, selectedOrg);
    }

  } catch (error) {
    console.error(chalk.red('\n❌ Initialization failed:'), error.message);
    process.exit(1);
  }
}

async function createNewApp(apiService, selectedOrg) {
  // Step 2: Choose template/language
  const { template } = await inquirer.prompt([
    {
      type: 'list',
      name: 'template',
      message: 'Which technology would you like to use?',
      choices: [
        { name: 'PHP - Traditional PHP application', value: 'php' },
        { name: 'JavaScript - Vanilla JavaScript with HTML', value: 'javascript' },
        { name: 'React - Modern React application', value: 'react' },
        { name: 'Node.js - Express server application', value: 'node' }
      ]
    }
  ]);

  // Step 3: Get app name
  const { appName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'appName',
      message: 'App name:',
      validate: input => {
        if (!input) return 'App name is required';
        if (input.length < 3) return 'App name must be at least 3 characters';
        return true;
      }
    }
  ]);

  const platformChoices = [
    { name: 'For eCommerce Only', value: 'store' },
    { name: 'For Both eCommerce and Informative', value: 'all' },
  ];


  const { platform } = await inquirer.prompt([
    {
      type: 'list',
      name: 'platform',
      message: 'Select the target platform:',
      choices: platformChoices
    }
  ]);

 
  // Step 4: Get directory name
  const defaultDir = appName.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const { directory } = await inquirer.prompt([
    {
      type: 'input',
      name: 'directory',
      message: 'Where would you like to create the app?',
      default: defaultDir,
      validate: input => input ? true : 'Directory name is required'
    }
  ]);

  console.log(chalk.cyan('\n📦 Creating new JoonWeb app...'));

  // Create app via API
  const appData = {
    name: appName,
    template: template,
    directory: directory,
    partner_id: selectedOrg.id,
    organization_type: selectedOrg.type ?? 'partner',
    platform: platform ?? 'all',
    embedded: true
  };

  const app = await apiService.createApp(appData);
  console.log(app);
  console.log(chalk.green(`✅ App "${app.name}" created on JoonWeb platform (ID: ${app.id})`));

  // Create app directory and files
  await generateAppFiles(directory, appName, template, app);

  console.log(chalk.green(`✅ JoonWeb app "${appName}" created successfully!`));
  console.log(chalk.cyan('\nNext steps:'));
  console.log(`  cd ${directory}`);
  console.log(`  joonweb serve     ${chalk.gray('# Start development server')}`);
  console.log(`  joonweb deploy    ${chalk.gray('# Deploy to JoonWeb')}`);
  
  // Ask to start development
  const { startDev } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'startDev',
      message: 'Start development server now?',
      default: true
    }
  ]);

  if (startDev) {
    process.chdir(directory);
    const serveCommand = require('./serve');
    await serveCommand({ port:3000,tunnel: true, open: true });
  }
}

async function connectExistingApp(apiService, selectedOrg) {
  console.log(chalk.cyan('📋 Fetching your JoonWeb apps...'));

  // Simulate API call to get user's apps
  const apps = await getUsersApps(apiService, selectedOrg);
  if (apps.length === 0) {
    console.log(chalk.yellow('No existing apps found. Creating new app instead.'));
    return await createNewApp(apiService);
  }

  const { selectedApp } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedApp',
      message: 'Which app would you like to connect to?',
      choices: apps.map(app => ({
        name: `${app.name} ${chalk.gray(`(${app.id})`)}`,
        value: app
      }))
    }
  ]);

  const { directory } = await inquirer.prompt([
    {
      type: 'input',
      name: 'directory',
      message: 'Directory name:',
      default: selectedApp.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      validate: input => input ? true : 'Directory name is required'
    }
  ]);

  console.log(chalk.cyan('\n📥 Setting up app files...'));
  await setupExistingApp(directory, selectedApp);

  console.log(chalk.green(`✅ Connected to "${selectedApp.name}" successfully!`));
  console.log(chalk.cyan('\nNext steps:'));
  console.log(`  cd ${directory}`);
  console.log(`  joonweb serve`);
}

async function getUsersApps(authService, selectedOrg) {
  // API Call to fetch user's apps from JoonWeb platform
  return await authService.fetchUserApps(selectedOrg);

}

async function generateAppFiles(directory, appName, template, app) {
  const projectPath = path.join(process.cwd(), directory);
  
  if (await fs.pathExists(projectPath)) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `Directory "${directory}" already exists. Overwrite?`,
        default: false
      }
    ]);

    if (!overwrite) {
      throw new Error('Directory already exists. Please choose a different name.');
    }
    await fs.remove(projectPath);
  }

  await fs.ensureDir(projectPath);

  // Generate files based on template
  const templateGenerators = {
    php: downloadPHPTemplate,
    javascript: generateJavaScriptTemplate,
    node: generateNodeTemplate
  };

  await templateGenerators[template](projectPath, appName, app);
}


async function downloadPHPTemplate(projectPath, appName, app) {
  const repo_url = "https://github.com/JoonWebdotcom/embed-app-php";
  
  console.log(chalk.cyan('🚀 Creating PHP application...'));
  console.log(chalk.gray(`   Template: ${repo_url}`));
  console.log(chalk.gray(`   Location: ${projectPath}\n`));

  try {
    const simpleGit = require('simple-git');
    const cliProgress = require('cli-progress');
    const colors = require('ansi-colors');

    // Create a multi-bar container
    const multibar = new cliProgress.MultiBar({
      format: colors.cyan('{bar}') + ' | {percentage}% | {stage}',
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
      clearOnComplete: false,
      barsize: 30
    }, cliProgress.Presets.shades_grey);

    // Create progress bars for different stages
    const cloneBar = multibar.create(100, 0, { stage: 'Cloning repository...' });
    const copyBar = multibar.create(100, 0, { stage: 'Copying files...' });
    const setupBar = multibar.create(100, 0, { stage: 'Setting up project...' });

    const git = simpleGit();
    
    // Create a temporary directory for cloning
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'joonweb-php-'));
    const tempRepoPath = path.join(tempDir, 'embed-app-php');

    try {
      // Stage 1: Clone repository with progress
      console.log(chalk.cyan('\n📥 Downloading template...\n'));
      
      let cloneProgress = 0;
      const cloneInterval = setInterval(() => {
        if (cloneProgress < 90) {
          cloneProgress += 10;
          cloneBar.update(cloneProgress);
        }
      }, 300);

      // Clone with progress tracking
      await git.clone(repo_url, tempRepoPath, [
        '--depth', '1',
        '--branch', 'main',
        '--progress'
      ]);

      clearInterval(cloneInterval);
      cloneBar.update(100);
      
      // Small delay for visual effect
      await new Promise(resolve => setTimeout(resolve, 500));

      // Stage 2: Copy files with progress
      copyBar.update(30);
      
      const files = await fs.readdir(tempRepoPath);
      if (files.length === 0) {
        throw new Error('Cloned repository is empty');
      }

      copyBar.update(60);
      
      // Copy all files with progress simulation
      await fs.copy(tempRepoPath, projectPath, {
        overwrite: true,
        errorOnExist: false
      });

      copyBar.update(100);
      await new Promise(resolve => setTimeout(resolve, 500));

      // Stage 3: Setup project
      setupBar.update(30);
      
      // Clean up temporary directory
      await fs.remove(tempDir);
      
      setupBar.update(60);
      
      // Update project configuration
      await updateProjectConfig(projectPath, appName);
      
      setupBar.update(100);

      // Stop all progress bars
      multibar.stop();

      // Create JooNWeb App config file
    await fs.writeJson(path.join(projectPath, 'joonweb.app.json'), {
      appId: app.id ?? '',
      name: app.name ?? appName,
      client_id: app.client_id ?? '',
      client_secret: app.client_secret ?? '',
      app_url: app.app_url ?? '',
      redirect_uri: app.redirect_uri ?? '',
      template: 'php',
      embedded: app.embedded ?? true,
      platform: app.platform ?? 'all',
      version: app.version ?? '1.0.0',
    }, { spaces: 2 });

      // Success message with beautiful formatting
      console.log(chalk.green('\n✅ PHP template created successfully!'));
      console.log(chalk.cyan('┌──────────────────────────────────────────────────────────────┐'));
      console.log(chalk.cyan('│                      Project Ready!                          │'));
      console.log(chalk.cyan('├──────────────────────────────────────────────────────────────┤'));
      console.log(`  App Name:  ${chalk.cyan(appName)}`);
      console.log(`  Location:  ${chalk.cyan(projectPath)}`);
      console.log(`  Template:  ${chalk.cyan('PHP Embed App')}`);
      console.log(chalk.cyan('├──────────────────────────────────────────────────────────────┤'));
      console.log(`  Next steps:`);
      console.log(`  ${chalk.cyan('cd ' + path.basename(projectPath))}`);
      console.log(`  ${chalk.cyan('joonweb serve')}     ${chalk.gray('# Start development server')}`);
      console.log(`  ${chalk.cyan('joonweb deploy')}    ${chalk.gray('# Deploy to JoonWeb')}`);
      console.log(chalk.cyan('└──────────────────────────────────────────────────────────────┘'));

    } catch (error) {
      multibar.stop();
      throw error;
    }

  } catch (error) {
    console.error(chalk.red('\n❌ Failed to download PHP template:'), error.message);
    
    // Provide helpful error messages based on common issues
    if (error.message.includes('git') || error.message.includes('clone')) {
      console.log(chalk.yellow('💡 Make sure Git is installed on your system:'));
      console.log(chalk.cyan('   Windows: https://git-scm.com/download/win'));
      console.log(chalk.cyan('   macOS: brew install git'));
      console.log(chalk.cyan('   Linux: sudo apt install git'));
    } else if (error.message.includes('network') || error.message.includes('connect') || error.message.includes('ENOTFOUND')) {
      console.log(chalk.yellow('💡 Check your internet connection and try again'));
      console.log(chalk.yellow('   The template repository might be temporarily unavailable'));
    } else if (error.message.includes('permission') || error.message.includes('EACCES')) {
      console.log(chalk.yellow('💡 Check directory permissions or try a different location'));
    } else if (error.message.includes('exists') || error.message.includes('EEXIST')) {
      console.log(chalk.yellow('💡 Directory already exists. Please choose a different name or delete the existing directory'));
    } else {
      console.log(chalk.yellow('💡 Try running the command again'));
    }
    
    throw error;
  }
}

// Helper function to update project configuration
async function updateProjectConfig(projectPath, appName) {
  try {
    // Update joonweb.app.json config file
    const joonwebConfigPath = path.join(projectPath, 'joonweb.app.json');
    if (await fs.pathExists(joonwebConfigPath)) {
      const config = await fs.readJson(joonwebConfigPath);
      config.name = appName;
      config.created_at = new Date().toISOString();
      await fs.writeJson(joonwebConfigPath, config, { spaces: 2 });
    }
    
    // Update composer.json if it exists
    const composerPath = path.join(projectPath, 'composer.json');
    if (await fs.pathExists(composerPath)) {
      try {
        const composer = await fs.readJson(composerPath);
        composer.name = appName.toLowerCase().replace(/[^a-z0-9]/g, '-');
        composer.description = `JoonWeb App - ${appName}`;
        await fs.writeJson(composerPath, composer, { spaces: 2 });
      } catch (e) {
        // Ignore composer.json errors
      }
    }

    // Update README if it exists
    const readmePath = path.join(projectPath, 'README.md');
    if (await fs.pathExists(readmePath)) {
      try {
        let readme = await fs.readFile(readmePath, 'utf8');
        readme = readme.replace(/JoonWeb App/g, appName);
        await fs.writeFile(readmePath, readme);
      } catch (e) {
        // Ignore README errors
      }
    }

  } catch (error) {
    console.log(chalk.yellow('⚠️  Could not update project configuration:'), error.message);
  }
}

async function generateJavaScriptTemplate(projectPath, appName) {
  const files = {
    'package.json': JSON.stringify({
      name: appName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      version: "1.0.0",
      description: `JoonWeb App - ${appName}`,
      type: "module",
      scripts: {
        serve: "joonweb serve",
        deploy: "joonweb deploy"
      }
    }, null, 2),

    'index.html': `<!DOCTYPE html>
<html>
<head>
    <title>${appName}</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, sans-serif; 
            margin: 0; 
            padding: 40px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            text-align: center;
        }
        .card {
            background: rgba(255,255,255,0.1);
            padding: 40px;
            border-radius: 16px;
            backdrop-filter: blur(10px);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <h1>🚀 ${appName}</h1>
            <p>Your JoonWeb JavaScript app is running!</p>
            <div id="app">
                <p>Edit <code>app.js</code> to start building.</p>
            </div>
        </div>
    </div>
    <script src="app.js"></script>
</body>
</html>`,

    'app.js': `// JoonWeb App - ${appName}
console.log('🚀 ${appName} loaded successfully!');

// JoonWeb SDK Integration
if (typeof JoonWeb !== 'undefined') {
    JoonWeb.ready(() => {
        console.log('Running in JoonWeb environment!');
        document.getElementById('app').innerHTML = '<p>🔄 Connected to JoonWeb</p>';
    });
}

// Your app logic here
document.addEventListener('DOMContentLoaded', function() {
    console.log('App initialized at:', new Date().toISOString());
    
    // Example: Update UI
    const appElement = document.getElementById('app');
    if (appElement) {
        appElement.innerHTML += '<p>✅ JavaScript is working!</p>';
    }
});`
  };

  for (const [filePath, content] of Object.entries(files)) {
    await fs.writeFile(path.join(projectPath, filePath), content);
  }

  await fs.writeJson(path.join(projectPath, 'joonweb.app.json'), {
    appId: `app_${Date.now()}`,
    name: appName,
    template: 'javascript',
    version: '1.0.0'
  }, { spaces: 2 });
}

async function generateNodeTemplate(projectPath, appName) {
  const files = {
    'package.json': JSON.stringify({
      name: appName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      version: "1.0.0",
      description: `JoonWeb App - ${appName}`,
      type: "module",
      scripts: {
        serve: "joonweb serve",
        deploy: "joonweb deploy"
      }
    }, null, 2),

    'index.html': `<!DOCTYPE html>
<html>
<head>
    <title>${appName}</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, sans-serif; 
            margin: 0; 
            padding: 40px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            text-align: center;
        }
        .card {
            background: rgba(255,255,255,0.1);
            padding: 40px;
            border-radius: 16px;
            backdrop-filter: blur(10px);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <h1>🚀 ${appName}</h1>
            <p>Your JoonWeb JavaScript app is running!</p>
            <div id="app">
                <p>Edit <code>app.js</code> to start building.</p>
            </div>
        </div>
    </div>
    <script src="app.js"></script>
</body>
</html>`,

    'app.js': `// JoonWeb App - ${appName}
console.log('🚀 ${appName} loaded successfully!');

// JoonWeb SDK Integration
if (typeof JoonWeb !== 'undefined') {
    JoonWeb.ready(() => {
        console.log('Running in JoonWeb environment!');
        document.getElementById('app').innerHTML = '<p>🔄 Connected to JoonWeb</p>';
    });
}

// Your app logic here
document.addEventListener('DOMContentLoaded', function() {
    console.log('App initialized at:', new Date().toISOString());
    
    // Example: Update UI
    const appElement = document.getElementById('app');
    if (appElement) {
        appElement.innerHTML += '<p>✅ JavaScript is working!</p>';
    }
});`
  };

  for (const [filePath, content] of Object.entries(files)) {
    await fs.writeFile(path.join(projectPath, filePath), content);
  }

  await fs.writeJson(path.join(projectPath, 'joonweb.app.json'), {
    appId: `app_${Date.now()}`,
    name: appName,
    template: 'node',
    version: '1.0.0'
  }, { spaces: 2 });
}

// Similar functions for React and Node templates...

async function setupExistingApp(directory, app) {
  const projectPath = path.join(projectPath, directory);
  await fs.ensureDir(projectPath);

  // Create basic structure for existing app
  await fs.writeJson(path.join(projectPath, 'joonweb.app.json'), {
    appId: app.id,
    name: app.name,
    connected: true,
    connected_at: new Date().toISOString()
  }, { spaces: 2 });

  await fs.writeFile(path.join(projectPath, 'README.md'), 
    `# ${app.name}\n\nJoonWeb App - Connected via CLI\n`);
}

module.exports = AppinitCommand;
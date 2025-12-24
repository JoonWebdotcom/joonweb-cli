const express = require('express');
const path = require('path');
const chalk = require('chalk');
const open = require('open');
const { spawn } = require('child_process');
const CloudflareTunnel = require('../services/cloudflare-tunnel');
const AuthService = require('../services/auth');
const ApiService = require('../services/api');
const fs = require('fs');
const inquirer = require('inquirer');
const projectx = process.cwd();
const envPath = path.join(projectx, '.env');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const chokidar = require('chokidar');
const archiver = require('archiver');

async function serveCommand(options) {
  const authService = new AuthService();
  const apiService = new ApiService();
  console.log(chalk.cyan('🔐 Checking authentication...'));
  await authService.ensureAuthenticated();
  const user = await authService.getCurrentUser();
  console.log(chalk.cyan(`👤 Serving as: ${user.name}\n`));

  const { port, tunnel, open: shouldOpen, subdomain } = options;
  const projectPath = process.cwd();

  // Check if this is a JoonWeb app directory
  const appConfig = await getAppConfig(projectPath);
  if (!appConfig) {
    console.log(chalk.yellow('⚠️  Not a JoonWeb app directory.'));
    console.log(chalk.cyan('💡 Run "joonweb init" to create a new app.'));
    return;
  }

  console.log(chalk.cyan(`🚀 Serving app: ${appConfig.name}`));
  console.log(chalk.cyan(`📁 Template: ${appConfig.template}`));

  // First Check if there is any development site/store available for this or not.
  const devSites = await apiService.getDevelopmentSites();
  let selectedStore;

  if (!devSites.data || devSites.data.length === 0) {
    console.log(chalk.red('❌ No development stores found for your account.'));
    console.log(chalk.cyan('💡 Please create a development Store in your JoonWeb dashboard before serving the app.'));
    return;
  }else{
    console.log(chalk.green(`✅ Found ${devSites.data.length} development store(s) associated with your account.`));
    // List of Stores if more than one.

    const response = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedStore',
        message: 'Select a development store to use:',
        choices: devSites.data.map(store => ({ name: store.name + ` (${store.id})`, value: store }))
      }
    ]);
    selectedStore = response.selectedStore;
  }

  selectedStore = selectedStore || devSites.data[0];
  console.log(chalk.cyan(`Using development store: ${selectedStore.name} (${selectedStore.id})\n`));

  // Detect extensions before serving.
  const extensions = await detectExtensions(projectPath);
  if (extensions.length > 0) {
    console.log(chalk.green(`📦 Found ${extensions.length} extension(s) in app:`));
    extensions.forEach((ext, i) => {
      console.log(`   ${i + 1}. ${ext.name} (${ext.handle}) - ${ext.blocks.length} block(s)`);
    });
  }

  let extensionDevManager = null;

  
  // Check the app template to determine how to serve
  if (appConfig.template === 'php') {
    await servePHPApp(projectPath, port, tunnel, shouldOpen, subdomain, appConfig, user, apiService, selectedStore, extensions);
  } else {
    await serveNodeApp(projectPath, port, tunnel, shouldOpen, subdomain, appConfig, user, apiService, selectedStore);
  }
}

async function detectExtensions(projectPath) {
  const extensionsPath = path.join(projectPath, 'extensions');
  const extensions = [];

  if (!fs.existsSync(extensionsPath)) {
    return extensions;
  }

  try {
    const items = fs.readdirSync(extensionsPath);
    
    for (const item of items) {
      const itemPath = path.join(extensionsPath, item);
      const stat = fs.statSync(itemPath);

      if (!stat.isDirectory()) continue;

      const configPath = path.join(itemPath, 'joonweb.extension.json');
      
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          extensions.push({
            ...config,
            handle: item,
            uuid:config.extension_key,
            path: itemPath,
            configPath: configPath,
            blocks: config.blocks || [],
            assets: config.assets || []
          });
        } catch (error) {
          console.log(chalk.yellow(`⚠️  Skipping extension ${item}: ${error.message}`));
        }
      }
    }
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Error reading extensions directory: ${error.message}`));
  }

  return extensions;
}

function updateEnv(key, value) {
    if (!fs.existsSync(envPath)) {
        console.log(".env file not found!");
        //process.exit(1);
    }

    // Create ENV File:
     if (!fs.existsSync(envPath)) {
      console.log("Creating .env file...");
        fs.writeFileSync(envPath, "");
        
    }

    let lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    let found = false;

    lines = lines.map(line => {
        const trimmed = line.trim();

        // ignore comments and blank lines
        if (trimmed.startsWith("#") || trimmed === "") return line;

        // match KEY=...
        if (trimmed.startsWith(key + "=")) {
            found = true;
            return `${key}=${value}`;
        }

        return line;
    });

    // if key not present → append
    if (!found) lines.push(`${key}=${value}`);

    fs.writeFileSync(envPath, lines.join("\n"));
}


function detectPhpServePath(projectPath) {
  const publicPath = path.join(projectPath, "public");
  const indexInPublic = path.join(publicPath, "index.php");
  const indexInRoot = path.join(projectPath, "index.php");

  // Laravel, CodeIgniter 4, Symfony
  if (fs.existsSync(indexInPublic)) {
    return publicPath;
  }

  // Core PHP or CodeIgniter 3
  if (fs.existsSync(indexInRoot)) {
    return projectPath;
  }

  // Fallback
  return projectPath;
}

async function setupDevelopmentEnvironment(apiService, appConfig, selectedStore, app_url, template='node', extensions=[], watch=true) {
// Now Install the App with API if Not Installed:
  console.log(chalk.cyan('Installing app on selected store.'));
  if(template==='php'){ 
    redirect_url = app_url + "/auth/callback.php"; 
    app_url += "/embedded.php";
  }else{ 
    redirect_url = app_url + "/auth/callback";
    app_url += "/";
  }

  const installResponse = await apiService.InstallApp({
      site_id: selectedStore.id,
      site_url: selectedStore.name,
      app_jwt: appConfig.appId,
      client_id: appConfig.client_id,
      scopes: appConfig.scopes || '',
      app_url: app_url,
      redirect_url: redirect_url,
      config: appConfig.config || {}
  });

  if (!installResponse) {
      throw new Error('App installation failed - no response received');
  }

  updateEnv("APP_NAME", JSON.stringify(appConfig.name));
  updateEnv("JOONWEB_CLIENT_ID", JSON.stringify(appConfig.client_id));
  updateEnv("JOONWEB_CLIENT_SECRET", JSON.stringify(appConfig.client_secret));
  updateEnv("JOONWEB_REDIRECT_URI", JSON.stringify(redirect_url));

// ============ NEW: REGISTER EXTENSIONS IF ANY ============
  if (extensions && extensions.length > 0) {
    console.log(chalk.cyan(`\n📦 Registering ${extensions.length} extension(s) with site...`));
    
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    for (const extension of extensions) {
      try {
        console.log(chalk.cyan(`  Processing: ${extension.name}`));
        
        // Validate blocks
        for (const block of extension.blocks) {
          await validateBlock(block, extension.path);
        }

        // Create zip
        const zipPath = path.join(tempDir, `${extension.handle}_${Date.now()}.zip`);
        await createZipArchive(extension.path, zipPath);

        // Calculate hash
        const extHash = await calculateExtensionHash(extension.path);

        // Register extension
        const xreponse = await apiService.registerExtension({
          site_id: selectedStore.id,
          app_jwt: appConfig.client_id,
          extension_key: extension.uuid,
          extension_config: {
            ...extension,
            development_mode: true,
            app_url: app_url,
            dev_session_id: generateDevSessionToken()
          },
          ext_local_path: extension.path,
          ext_zip_path: zipPath,
          ext_hash: extHash
        });

        console.log(chalk.green(`    ✅ Registered: ${extension.name}`));
        console.log(chalk.gray(`Full Response ` + JSON.stringify(xreponse)));

      } catch (error) {
        console.log(chalk.red(`    ❌ Failed to register ${extension.name}: ${error.message}`));
      }
    }

    // Cleanup
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore
    }

    // ============ NEW: START EXTENSION WATCHER IF ENABLED ============
    if (watch) {
      startExtensionWatcher(extensions, apiService, appConfig, selectedStore, app_url);
    }
  }
  // ============ END NEW ============

  const BASEURL = "https://accounts.joonweb.com/site/";
  let JW_URL;

  if(installResponse){
    console.log(chalk.cyan('Processing Installation via Browser...'));
    JW_URL = BASEURL + `?sitehash=${selectedStore.hash}&request_auth&app_jwt=${appConfig.appId}&client_id=${appConfig.client_id}`;
    open(JW_URL).catch(() => {
        console.log(chalk.yellow(`Please open ${JW_URL} in your browser`));
    });
  }

}

// ============ NEW: SIMPLE EXTENSION WATCHER ============
function startExtensionWatcher(extensions, apiService, appConfig, store, appUrl) {
  console.log(chalk.cyan('\n🔧 Starting extension file watcher...'));
  
  const devSessionId = uuidv4();
  console.log(chalk.gray(`   🆔 Dev Session ID: ${devSessionId}`));
  extensions.forEach(extension => {
    console.log(chalk.gray(`   👁️  Watching: ${extension.name}`));
    
    const watcher = chokidar.watch(extension.path, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true,
      interval: 100
    });

    watcher.on('change', async (filePath) => {
      const relativePath = path.relative(extension.path, filePath);
      
      // Skip config file changes (need full re-registration)
      if (filePath.endsWith('joonweb.extension.json')) {
        console.log(chalk.cyan(`   🔄 Config changed: ${extension.name}`));
        return;
      }

      console.log(chalk.gray(`   📄 Changed: ${relativePath} in ${extension.name}`));

      try {
        // Read the changed file
        const content = fs.readFileSync(filePath, 'utf8');
        const stats = fs.statSync(filePath);

        // Push update to API
        const updateStatus = await apiService.pushExtensionUpdate({
          site_id: store.id,
          app_jwt: appConfig.appId,
          extension_handle: extension.handle,
          client_id: appConfig.client_id,
          request_id: uuidv4(),
          dev_session_id: devSessionId,
          update: {
            type: 'file_update',
            file: relativePath,
            content: content,
            size: stats.size,
            mtime: stats.mtime.getTime(),
            timestamp: Date.now(),
            session_id: devSessionId
          },
          mode: 'development'
        });

        console.log(updateStatus)

        console.log(chalk.green(`   ✅ Updated: ${relativePath}`));
      } catch (error) {
        console.log(chalk.yellow(`   ⚠️  Failed to push update: ${error.message}`));
      }
    });

    watcher.on('error', (error) => {
      console.log(chalk.red(`   ❌ Watcher error for ${extension.name}: ${error.message}`));
    });
  });

  console.log(chalk.green('✅ Extension watcher started'));
  console.log(chalk.gray('   File changes will be pushed automatically'));
}

// ============ NEW: HELPER FUNCTIONS ============
async function calculateExtensionHash(extensionPath) {
  const hash = crypto.createHash('sha256');
  
  function hashDirectory(dirPath) {
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        hashDirectory(fullPath);
      } else {
        const content = fs.readFileSync(fullPath);
        hash.update(content);
        hash.update(item);
      }
    }
  }
  
  hashDirectory(extensionPath);
  return hash.digest('hex');
}

function generateDevSessionToken() {
  return uuidv4().replace(/-/g, '') + Date.now().toString(36);
}

function createZipArchive(sourceDir, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });

    output.on('close', () => {
      const sizeMB = (archive.pointer() / (1024 * 1024)).toFixed(2);
      console.log(chalk.gray(`    📦 Zipped: ${sizeMB} MB`));
      resolve();
    });

    archive.on('error', (err) => {
      reject(new Error(`Failed to create zip: ${err.message}`));
    });

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.log(chalk.yellow(`    ⚠️  Zip warning: ${err.message}`));
      } else {
        reject(err);
      }
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function validateBlock(block, ExtensionDir) {
  return new Promise((resolve, reject) => {
    if (!block.type || !block.name || !block.src || !block.target) {
      reject(new Error('Block configuration is missing required fields (type, name, src, target).'));
    } else {
      if (block.type !== 'app_embed' && block.type !== 'app_block') {
        reject(new Error(`Block type "${block.type}" is invalid. Must be "app_embed" or "app_block".`));
      }
      if (block.type == "app_embed") {
        const validTargets = ['head', 'body', 'footer', 'section'];
        if (!validTargets.includes(block.target)) {
          reject(new Error(`Block target "${block.target}" is invalid for app_embed. Must be one of: ${validTargets.join(', ')}.`));
        }
      }
      if (block.src != "") {
        // Check if file exists
        const blockPath = path.join(ExtensionDir, block.src);
        // Check if file is .jw or not.
        if (!fs.existsSync(blockPath)) {
          reject(new Error(`Block source file "${block.src}" does not exist at path: ${blockPath}`));
        }
        if (path.extname(blockPath) !== ".jw") {
          reject(new Error(`Block source file "${block.src}" must have a .jw extension.`));
        }
      }
      resolve(true);
    }
  });
}


async function registerAllExtensions(apiService, appConfig, store) {
  const extensionsPath = path.join(process.cwd(), 'extensions');
  
  if (!fs.existsSync(extensionsPath)) {
    console.log(chalk.yellow('⚠️  No extensions directory found'));
    return;
  }

  const extensionDirs = fs.readdirSync(extensionsPath)
    .filter(ext => {
      const fullPath = path.join(extensionsPath, ext);
      return fs.lstatSync(fullPath).isDirectory();
    });

  if (extensionDirs.length === 0) {
    console.log(chalk.yellow('⚠️  No extension directories found'));
    return;
  }

  console.log(chalk.cyan(`Found ${extensionDirs.length} extension(s) to register`));

  // Create temp directory if it doesn't exist
  const tempDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Process extensions one by one
  for (const extDirName of extensionDirs) {
    await registerSingleExtension(
      apiService,
      appConfig,
      store,
      extensionsPath,
      extDirName,
      tempDir
    );
  }

  // Clean up temp directory after all extensions are processed
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log(chalk.gray('🧹 Cleaned up temporary files'));
  } catch (cleanupError) {
    console.log(chalk.yellow(`⚠️  Could not clean temp directory: ${cleanupError.message}`));
  }
}

async function registerSingleExtension(apiService, appConfig, store, extensionsPath, extDirName, tempDir) {
  const extensionDir = path.join(extensionsPath, extDirName);
  const configPath = path.join(extensionDir, 'joonweb.extension.json');
  
  if (!fs.existsSync(configPath)) {
    console.log(chalk.yellow(`⚠️  Skipping ${extDirName}: No joonweb.extension.json found`));
    return;
  }

  try {
    // Read and parse extension config
    const configContent = fs.readFileSync(configPath, 'utf8');
    const extConfig = JSON.parse(configContent);
    
    console.log(chalk.cyan(`\n📦 Processing extension: ${extConfig.name || extDirName}`));

    // Validate blocks if any
    const blocks = extConfig.blocks || [];
    for (const block of blocks) {
      await validateBlock(block, extensionDir);
      console.log(chalk.green(`  ✓ Validated block: ${block.name}`));
    }

    // Create zip file
    const zipFileName = `${(extConfig.name || extDirName).replace(/\s+/g, '_').toLowerCase()}_${Date.now()}.zip`;
    const zipPath = path.join(tempDir, zipFileName);
    
    await createZipArchive(extensionDir, zipPath);
    
    // Register extension via API
    console.log(chalk.cyan(`  📤 Registering extension...`));
    
    await apiService.registerExtension({
      site_id: store.id,
      app_jwt: appConfig.appId,
      extension_config: extConfig,
      ext_local_path: extensionDir,
      ext_zip_path: zipPath,
      ext_hash: await calculateExtensionHash(extensionDir)
    });
    
    console.log(chalk.green(`  ✅ Successfully registered: ${extConfig.name}`));

  } catch (error) {
    console.error(chalk.red(`  ❌ Failed to register extension ${extDirName}: ${error.message}`));
    // Don't throw - continue with other extensions
  }
}


async function servePHPApp(projectPath, port, tunnel, shouldOpen, subdomain, appConfig, user, apiService, selectedStore, extensions=[],watch=true) {
  console.log(chalk.cyan('🐘 PHP app detected - starting PHP built-in server...'));
  
  // Check if PHP is available
  const phpAvailable = await checkPHP();
  if (!phpAvailable) {
    console.log(chalk.red('❌ PHP is not available on your system.'));
    console.log(chalk.yellow('💡 Please install PHP to run PHP applications:'));
    console.log(chalk.cyan('   Windows: https://windows.php.net/download/'));
    console.log(chalk.cyan('   macOS: brew install php'));
    console.log(chalk.cyan('   Linux: sudo apt install php'));
    process.exit(1);
  }

  let tunnelService = null;
  let tunnelUrl = null;
  const servePath = detectPhpServePath(projectPath);
  return new Promise((resolve, reject) => {
      // Start PHP built-in server
      const phpServer = spawn("php", [
        "-S",
        `localhost:${port}`,
        "-t",
        servePath
      ], {
        cwd: servePath,
        stdio: "pipe",
        shell: true
      });

    let serverReady = false;

    phpServer.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(chalk.gray(`[php] ${output}`));
      }
    });

    phpServer.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        // Check if this is actually an error or just PHP server info
        if (output.includes('Development Server') && output.includes('started')) {
          // This is actually the server start message on stderr (normal PHP behavior)
          console.log(chalk.green(`[php] ${output}`));
          serverReady = true;
          console.log(chalk.green(`📡 PHP Development Server: http://localhost:${port}`));
          
          // Start tunnel after PHP server is ready
          if (tunnel !== false) {
            // Small delay to ensure PHP server is fully ready
            tunnelService = new CloudflareTunnel();
            setTimeout(() => {
              console.log(chalk.cyan('🔗 Starting Cloudflare tunnel...xxx'));
              tunnelService.createTunnel(port, {  }).then(result => {
                tunnelUrl = result.url;
                
                console.log(chalk.green(`🔗 Public Tunnel URL: ${tunnelUrl}`));
                console.log(chalk.cyan('📱 Use this URL for external testing and webhooks'));
                
                // Test the tunnel connection after a delay
                setTimeout(() => {
                  testTunnelConnection(tunnelUrl).then(async isWorking => {
                    if (isWorking) {
                      // Set the tunnel URL to app config.

                        console.log(chalk.green('🎉 Tunnel is fully operational!'));
                        const app_url = tunnelUrl || `http://localhost:${port}`;
                        // open(urlToOpen).catch(() => {
                        //   console.log(chalk.yellow(`Please open ${urlToOpen} in your browser`));
                        // });

                        const oAuthURL = await setupDevelopmentEnvironment(apiService, appConfig, selectedStore, app_url, 'php', extensions, watch);


                    } else {
                      console.log(chalk.yellow('⚠️  Tunnel created but might take 1-2 minutes to propagate...'));
                      console.log(chalk.cyan('💡 Keep the tunnel running, it will become accessible shortly.'));
                    }
                  });
                }, 3000);
                
                printDevInfo(`http://localhost:${port}`, tunnelUrl, appConfig, user, 'php');
              }).catch(error => {
                console.log(chalk.yellow('⚠️  Tunnel failed, but PHP server is running locally'));
                printDevInfo(`http://localhost:${port}`, null, appConfig, user, 'php');
              });
            }, 6000); // 6 second delay for PHP server to be fully ready
          } else {
            if (shouldOpen !== false) {
              open(`http://localhost:${port}`).catch(() => {
                console.log(chalk.yellow(`Please open http://localhost:${port} in your browser`));
              });
            }
            printDevInfo(`http://localhost:${port}`, null, appConfig, user, 'php');
          }
        } else if (output.includes('Accepted') || output.includes('Closing')) {
          // Normal connection messages, don't log as errors
          console.log(chalk.gray(`[php] ${output}`));
        } else {
          // Actual PHP errors
          console.error(chalk.red(`[php error] ${output}`));
        }
      }
    });

    phpServer.on('error', (error) => {
      console.error(chalk.red('❌ Failed to start PHP server:'), error.message);
      reject(error);
    });

    phpServer.on('close', (code) => {
      if (code !== 0 && !serverReady) {
        console.error(chalk.red(`❌ PHP server exited with code ${code}`));
        reject(new Error(`PHP server exited with code ${code}`));
      }
    });

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log(chalk.cyan('\n🛑 Shutting down PHP server...'));
      
      if (tunnelService) {
        await tunnelService.stopTunnel();
      }
      
      phpServer.kill();
      console.log(chalk.green('✅ PHP server stopped'));
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}


async function serveNodeApp(projectPath, port, tunnel, shouldOpen, subdomain, appConfig, user, apiService,selectedStore, extensions=[],watch=true) {
  const app = express();
  let tunnelService = null;
  let tunnelUrl = null;

  // Serve static files from current directory
  app.use(express.static(projectPath));
  setupAppRouting(app, projectPath, appConfig);

  return new Promise((resolve, reject) => {
    // Start the server
    const server = app.listen(port, 'localhost', async (err) => {
      if (err) {
        console.error(chalk.red('Error starting server:'), err);
        process.exit(1);
      }

      const localUrl = `http://localhost:${port}`;
      console.log(chalk.green(`📡 Development server: ${localUrl}`));

      // Auto-tunnel (like Shopify)
      if (tunnel !== false) {
        const tunnelResult = await startDevelopmentTunnel(port, subdomain);
        if (tunnelResult) {
          tunnelUrl = tunnelResult.url;
          tunnelService = tunnelResult.service;
        }
      }

      if (shouldOpen !== false) {
        const urlToOpen = tunnelUrl || localUrl;
        open(urlToOpen).catch(() => {
          console.log(chalk.yellow(`Please open ${urlToOpen} in your browser`));
        });
      }

      printDevInfo(localUrl, tunnelUrl, appConfig, user, 'node');
    });

    setupGracefulShutdown(server, tunnelService);
  });
}

async function checkPHP() {
  return new Promise((resolve) => {
    const phpCheck = spawn('php', ['--version'], {
      stdio: 'pipe',
      shell: true
    });

    phpCheck.on('error', () => {
      resolve(false);
    });

    phpCheck.on('exit', (code) => {
      resolve(code === 0);
    });

    // Timeout after 3 seconds
    setTimeout(() => {
      phpCheck.kill();
      resolve(false);
    }, 3000);
  });
}

async function getAppConfig(projectPath) {
  try {
    const configPath = path.join(projectPath, 'joonweb.app.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (error) {
    // Ignore errors
  }
  return null;
}

function setupAppRouting(app, projectPath, appConfig) {
  // Health check endpoint (always available)
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      service: 'joonweb-dev-server',
      app: appConfig?.name || 'unknown'
    });
  });

  // JoonWeb app info endpoint
  app.get('/joonweb-api/app-info', (req, res) => {
    res.json({
      name: appConfig?.name || getAppName(projectPath),
      version: appConfig?.version || '1.0.0',
      type: 'joonweb-app',
      mode: 'development',
      template: appConfig?.template || 'custom'
    });
  });

  // Default route - serve the main entry point
  app.get('/', (req, res) => {
    // Try to find and serve the main entry point
    const possibleEntryPoints = [
      'index.html',
      'app.html', 
      'src/index.html',
      'public/index.html',
      'dist/index.html',
      'embedded.php'
    ];

    for (const entryPoint of possibleEntryPoints) {
      const fullPath = path.join(projectPath, entryPoint);
      if (fs.existsSync(fullPath)) {
        return res.sendFile(fullPath);
      }
    }
    
    // If no entry point found, serve a basic welcome page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${appConfig?.name || 'JoonWeb App'}</title>
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, sans-serif; 
            padding: 40px; 
            text-align: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
            margin: 0;
          }
          .container { 
            max-width: 600px; 
            margin: 0 auto; 
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
            <h1>🚀 ${appConfig?.name || 'JoonWeb App'}</h1>
            <p>Your app is running! Add an <code>index.html</code> file to get started.</p>
            <div style="margin-top: 30px; padding: 20px; background: rgba(255,255,255,0.2); border-radius: 8px;">
              <h3>Next Steps:</h3>
              <ul style="text-align: left; display: inline-block;">
                <li>Create <code>index.html</code> in this directory</li>
                <li>Run <code>joonweb init</code> for a starter template</li>
                <li>Check <code>/health</code> for server status</li>
                <li>Visit <code>/joonweb-api/app-info</code> for app details</li>
              </ul>
            </div>
          </div>
        </div>
      </body>
      </html>
    `);
  });
}

function getAppName(projectPath) {
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const pkg = require(packageJsonPath);
      return pkg.name || path.basename(projectPath);
    }
  } catch (e) {
    // Ignore errors
  }
  return path.basename(projectPath);
}

async function startDevelopmentTunnel(port, subdomain) {
  try {
    const tunnelService = new CloudflareTunnel();
    const tunnelResult = await tunnelService.createTunnel(parseInt(port), {
      subdomain: subdomain
    });
    
    console.log(chalk.green(`🔗 Public Tunnel URL: ${tunnelResult.url}`));
    console.log(chalk.cyan('📱 Use this URL for external testing and webhooks'));
    
    // Return both the URL and the service instance to keep it alive
    return {
      url: tunnelResult.url,
      service: tunnelService
    };
  } catch (tunnelError) {
    console.error(chalk.yellow('⚠️  Could not start tunnel:'), tunnelError.message);
    console.log(chalk.cyan('💡 Running without tunnel. Use --no-tunnel to disable.'));
    return null;
  }
}

async function testTunnelConnection(tunnelUrl) {
  return new Promise((resolve) => {
    const https = require('https');
    
    const req = https.get(tunnelUrl, (res) => {
      // Any response (even 404) means the tunnel is working
      resolve(true);
    });
    
    req.on('error', (error) => {
      // Connection error means tunnel might not be ready yet
      resolve(false);
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function printDevInfo(localUrl, tunnelUrl, appConfig, user, serverType, Framework='', servePath='') {
  console.log('\n' + chalk.cyan('🎯 Development Mode Active'));
  console.log(chalk.cyan('┌──────────────────────────────────────────────────────────────┐'));
  console.log(chalk.cyan('│                     Development URLs                         │'));
  console.log(chalk.cyan('├──────────────────────────────────────────────────────────────┤'));
  console.log(`  Local:    ${chalk.green(localUrl)}`);
  if (tunnelUrl) {
    console.log(`  Tunnel:   ${chalk.green(tunnelUrl)}`);
  }
  console.log(chalk.cyan('├──────────────────────────────────────────────────────────────┤'));
  console.log(`  App:      ${chalk.cyan(appConfig?.name || 'Unknown')}`);
  console.log(`  Template: ${chalk.cyan(appConfig?.template || 'custom')}`);
  console.log(`  Server:   ${chalk.cyan(serverType === 'php' ? 'PHP Built-in' : 'Node.js')}`);
  console.log(`  User:     ${chalk.cyan(user?.name || 'Unknown')}`);
  console.log(chalk.cyan('├──────────────────────────────────────────────────────────────┤'));
   if (serverType === 'php') {
      console.log(`  Framework:   ${chalk.cyan('Custom PHP')}`);
   }else{
  console.log(`  Framework:   ${chalk.cyan('JoonWeb CLI Development Server')}`);
   }
  if (serverType === 'node') {
    console.log(`  App Info: ${chalk.cyan(localUrl + '/joonweb-api/app-info')}`);
  }
  console.log(chalk.cyan('└──────────────────────────────────────────────────────────────┘'));
  
  if (tunnelUrl) {
    console.log(chalk.green('\n✅ Your app is publicly accessible!'));
    console.log(chalk.cyan('💡 Use the tunnel URL for:'));
    console.log('   • Testing webhooks');
    console.log('   • Mobile device testing');
    console.log('   • Third-party API integrations');
    console.log('   • Sharing with team members');
    
    if (serverType === 'php') {
      console.log(chalk.yellow('\n💡 Note: PHP tunnels may take 1-2 minutes to become fully accessible.'));
      console.log(chalk.yellow('   If the tunnel URL doesn\'t work immediately, wait a moment and try again.'));
    }
  }
  
  console.log(chalk.yellow('\n⚠️  Press Ctrl+C to stop the server'));
  console.log(chalk.gray('   Logs will appear here as you develop...'));
}

function setupGracefulShutdown(server, tunnelService) {
  const shutdown = async () => {
    console.log(chalk.cyan('\n🛑 Shutting down development server...'));
    
    if (tunnelService) {
      await tunnelService.stopTunnel();
    }
    
    if (server && typeof server.close === 'function') {
      server.close(() => {
        console.log(chalk.green('✅ Server stopped'));
        process.exit(0);
      });

      // Force close after 5 seconds
      setTimeout(() => {
        console.log(chalk.yellow('⚠️  Forcing shutdown...'));
        process.exit(1);
      }, 5000);
    } else {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = serveCommand;
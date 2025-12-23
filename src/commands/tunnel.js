const express = require('express');
const path = require('path');
const chalk = require('chalk');
const open = require('open');
const CloudflareTunnel = require('../services/cloudflare-tunnel');
const SimpleTunnel = require('../services/simple-tunnel');
const fs = require('fs');

async function serveCommand(options) {
  const { port, host, tunnel, open: shouldOpen, subdomain } = options;
  const projectPath = process.cwd();
  const app = express();

  let tunnelService = null;
  let tunnelUrl = null;

  // Serve static files from current directory
  app.use(express.static(projectPath));
  setupAppRouting(app, projectPath);

  try {
    const server = app.listen(port, host, async (err) => {
      if (err) {
        console.error(chalk.red('Error starting server:'), err);
        process.exit(1);
      }

      const localUrl = `http://${host}:${port}`;
      console.log(chalk.green(`🚀 Development server running at ${localUrl}`));
      
      // Auto-create tunnel (enabled by default)
      if (tunnel !== false) {
        tunnelUrl = await startDevelopmentTunnel(port, subdomain);
      }

      // Open browser if requested
      if (shouldOpen) {
        const urlToOpen = tunnelUrl || localUrl;
        open(urlToOpen).catch(() => {
          console.log(chalk.yellow(`Please open ${urlToOpen} in your browser`));
        });
      }

      printDevInstructions(localUrl, tunnelUrl);
    });

    setupGracefulShutdown(server, tunnelService);

  } catch (error) {
    console.error(chalk.red('Error starting development server:'), error);
    process.exit(1);
  }
}

async function startDevelopmentTunnel(port, subdomain) {
  try {
    // First try Cloudflare tunnel
    const cloudflareTunnel = new CloudflareTunnel();
    const result = await cloudflareTunnel.createTunnel(parseInt(port), { subdomain });
    console.log(chalk.blue('📱 Use this URL for external testing and webhooks'));
    return result.url;
  } catch (cloudflareError) {
    console.log(chalk.yellow('⚠️  Cloudflare tunnel failed, trying alternative...'));
    
    try {
      // Fallback to localtunnel
      const simpleTunnel = new SimpleTunnel();
      const result = await simpleTunnel.createTunnel(port, { subdomain });
      console.log(chalk.blue('📱 Using localtunnel for external access'));
      return result.url;
    } catch (simpleError) {
      console.log(chalk.yellow('⚠️  All tunnel methods failed. Running without tunnel.'));
      console.log(chalk.blue('💡 You can still access your app locally.'));
      return null;
    }
  }
}

// ... rest of the serve.js code remains the same ...
function setupAppRouting(app, projectPath) {
  // Health check endpoint (always available)
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      service: 'joonweb-dev-server'
    });
  });

  // JoonWeb app info endpoint
  app.get('/joonweb-api/app-info', (req, res) => {
    res.json({
      name: getAppName(projectPath),
      version: '1.0.0',
      type: 'joonweb-app',
      mode: 'development'
    });
  });

  // Default route - serve the main entry point
  app.get('/', (req, res) => {
    const possibleEntryPoints = [
      'index.html',
      'app.html', 
      'src/index.html',
      'public/index.html',
      'dist/index.html'
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
        <title>JoonWeb App</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 40px; text-align: center; }
          .container { max-width: 600px; margin: 0 auto; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🚀 JoonWeb Development Server</h1>
          <p>Your app is running! Add an <code>index.html</code> file to get started.</p>
          <div style="margin-top: 30px; padding: 20px; background: #f5f5f5; border-radius: 8px;">
            <h3>Next Steps:</h3>
            <ul style="text-align: left; display: inline-block;">
              <li>Create <code>index.html</code> in this directory</li>
              <li>Run <code>joonweb init</code> for a starter template</li>
              <li>Check <code>/health</code> for server status</li>
            </ul>
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

function printDevInstructions(localUrl, tunnelUrl) {
  console.log('\n' + chalk.cyan('🎯 Development Mode Active'));
  console.log(chalk.blue('┌──────────────────────────────────────────────────────────────┐'));
  console.log(chalk.blue('│                     Development URLs                         │'));
  console.log(chalk.blue('├──────────────────────────────────────────────────────────────┤'));
  console.log(`  Local:    ${chalk.green(localUrl)}`);
  if (tunnelUrl) {
    console.log(`  Tunnel:   ${chalk.green(tunnelUrl)}`);
  }
  console.log(chalk.blue('├──────────────────────────────────────────────────────────────┤'));
  console.log(`  App Info: ${chalk.cyan(localUrl + '/joonweb-api/app-info')}`);
  console.log(`  Health:   ${chalk.cyan(localUrl + '/health')}`);
  console.log(chalk.blue('└──────────────────────────────────────────────────────────────┘'));
  
  if (tunnelUrl) {
    console.log(chalk.green('\n✅ Your app is publicly accessible!'));
    console.log(chalk.blue('💡 Use the tunnel URL for:'));
    console.log('   • Testing webhooks');
    console.log('   • Mobile device testing');
    console.log('   • Third-party API integrations');
  }
  
  console.log(chalk.yellow('\n⚠️  Press Ctrl+C to stop the server'));
}

function setupGracefulShutdown(server, tunnelService) {
  const shutdown = async () => {
    console.log(chalk.blue('\n🛑 Shutting down development server...'));
    
    if (tunnelService) {
      await tunnelService.stopTunnel();
      console.log(chalk.green('✅ Tunnel stopped'));
    }
    
    server.close(() => {
      console.log(chalk.green('✅ Server stopped'));
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = serveCommand;
const { exec, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const { promisify } = require('util');

const execAsync = promisify(exec);

class CloudflareTunnel {
  constructor() {
    this.configDir = path.join(os.homedir(), '.joonweb');
    this.tunnelProcess = null;
    this.currentTunnelId = null;
    this.tunnelUrl = null;
  }

  async createTunnel(port, options = {}) {
    const { protocol = 'http' } = options;

    try {
      // Ensure cloudflared is installed
      await this.ensureCloudflared();

      // Use simple tunnel approach
      this.tunnelUrl = await this.runSimpleTunnel(port, options);
      
      return {
        url: this.tunnelUrl,
        localUrl: `${protocol}://localhost:${port}`,
      };

    } catch (error) {
      throw new Error(`Cloudflare Tunnel failed: ${error.message}`);
    }
  }

  async ensureCloudflared() {
    const isInstalled = await this.checkCloudflared();
    if (!isInstalled) {
      await this.installCloudflared();
    }
    return true;
  }

  async checkCloudflared() {
    try {
      await execAsync('cloudflared --version');
      return true;
    } catch {
      // Also check in common installation locations on Windows
      if (os.platform() === 'win32') {
        try {
          // Check in System32
          await execAsync('C:\\Windows\\System32\\cloudflared.exe --version');
          return true;
        } catch {
          // Check if downloaded to temp directory
          const tempPath = path.join(os.tmpdir(), 'cloudflared.exe');
          if (await fs.pathExists(tempPath)) {
            return true;
          }
        }
      }
      return false;
    }
  }

  async installCloudflared() {
    console.log(chalk.yellow('📥 Installing cloudflared...'));
    
    const platform = os.platform();
    
    try {
      if (platform === 'darwin') {
        await this.installCloudflaredMac();
      } else if (platform === 'linux') {
        await this.installCloudflaredLinux();
      } else if (platform === 'win32') {
        await this.installCloudflaredWindows();
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }
      
      // Verify installation
      const isInstalled = await this.checkCloudflared();
      if (!isInstalled) {
        throw new Error('Installation completed but cloudflared not found in PATH');
      }
      
      console.log(chalk.green('✅ cloudflared installed successfully'));
    } catch (error) {
      console.log(chalk.yellow('⚠️  Automatic installation failed.'));
      this.showManualInstallInstructions();
      throw new Error(`Failed to install cloudflared: ${error.message}`);
    }
  }

  async installCloudflaredMac() {
    try {
      await execAsync('brew install cloudflare/cloudflare/cloudflared');
    } catch (error) {
      console.log(chalk.yellow('🍺 Homebrew not available, trying direct download...'));
      await execAsync('curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz -o /tmp/cloudflared.tgz');
      await execAsync('tar -xzf /tmp/cloudflared.tgz -C /tmp');
      await execAsync('sudo mv /tmp/cloudflared /usr/local/bin/');
      await execAsync('chmod +x /usr/local/bin/cloudflared');
    }
  }

  async installCloudflaredLinux() {
    await execAsync('curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared');
    await execAsync('chmod +x /tmp/cloudflared');
    await execAsync('sudo mv /tmp/cloudflared /usr/local/bin/');
  }

  async installCloudflaredWindows() {
    console.log(chalk.blue('🔄 Installing cloudflared on Windows...'));
    
    try {
      // Method 1: Try winget (Windows Package Manager)
      console.log(chalk.blue('💻 Trying winget installation...'));
      await execAsync('winget install Cloudflare.cloudflared -s winget --accept-package-agreements --accept-source-agreements', { timeout: 60000 });
      console.log(chalk.green('✅ Successfully installed via winget'));
      return;
    } catch (wingetError) {
      console.log(chalk.yellow('⚠️  Winget installation failed, trying PowerShell...'));
    }

    try {
      // Method 2: PowerShell download to temp directory
      console.log(chalk.blue('💻 Downloading via PowerShell...'));
      const psCommand = `
        $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
        $tempDir = $env:TEMP
        $output = Join-Path $tempDir "cloudflared.exe"
        
        # Download cloudflared
        Invoke-WebRequest -Uri $url -OutFile $output -UserAgent "JoonWeb-CLI"
        
        # Verify download
        if (Test-Path $output) {
          Write-Host "Download successful: $output"
          # Add to PATH for current session
          $env:Path += ";$tempDir"
          [Environment]::SetEnvironmentVariable("Path", $env:Path + ";$tempDir", "User")
        } else {
          Write-Error "Download failed"
          exit 1
        }
      `;
      
      await execAsync(`powershell -Command "${psCommand.replace(/\n/g, ' ')}"`, { timeout: 60000 });
      console.log(chalk.green('✅ Successfully downloaded cloudflared to temp directory'));
      
    } catch (psError) {
      console.log(chalk.yellow('⚠️  PowerShell download failed.'));
      throw new Error('All automatic installation methods failed');
    }
  }

  showManualInstallInstructions() {
    console.log(chalk.cyan('\n📋 Manual Installation Instructions:'));
    console.log(chalk.blue('┌──────────────────────────────────────────────────────────────┐'));
    console.log(chalk.blue('│                  Manual Cloudflared Setup                    │'));
    console.log(chalk.blue('├──────────────────────────────────────────────────────────────┤'));
    
    if (os.platform() === 'win32') {
      console.log(chalk.white('Option 1 - Winget (Recommended):'));
      console.log(chalk.green('  winget install Cloudflare.cloudflared'));
      console.log('');
      console.log(chalk.white('Option 2 - Download manually:'));
      console.log(chalk.cyan('  1. Download: https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'));
      console.log(chalk.cyan('  2. Rename to: cloudflared.exe'));
      console.log(chalk.cyan('  3. Place in: C:\\\\Windows\\\\System32\\\\'));
      console.log(chalk.cyan('  4. Or any folder in your PATH'));
    } else {
      console.log(chalk.white('Linux/macOS:'));
      console.log(chalk.green('  curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared'));
      console.log(chalk.green('  chmod +x /usr/local/bin/cloudflared'));
    }
    
    console.log(chalk.blue('├──────────────────────────────────────────────────────────────┤'));
    console.log(chalk.white('After installation, run:'));
    console.log(chalk.green('  joonweb serve'));
    console.log(chalk.blue('└──────────────────────────────────────────────────────────────┘\n'));
  }

  async runSimpleTunnel(port, options) {
    return new Promise((resolve, reject) => {
      console.log(chalk.blue('🔗 Starting Cloudflare tunnel...'));

      // Build the cloudflared command
      const args = ['tunnel', '--url', `http://localhost:${port}`];
    
      // Use the correct cloudflared command based on platform
      let cloudflaredCmd = 'cloudflared';
      
      // For Windows, check common locations
      if (os.platform() === 'win32') {
        this.getWindowsCloudflaredPath().then(cmdPath => {
          if (cmdPath) {
            cloudflaredCmd = cmdPath;
            this.startTunnelProcess(cloudflaredCmd, args, resolve, reject);
          } else {
            reject(new Error('cloudflared not found. Please install it manually.'));
          }
        }).catch(error => {
          reject(new Error('Failed to locate cloudflared: ' + error.message));
        });
      } else {
        this.startTunnelProcess(cloudflaredCmd, args, resolve, reject);
      }
    });
  }

  async getWindowsCloudflaredPath() {
    const possiblePaths = [
      'cloudflared',
      'C:\\Windows\\System32\\cloudflared.exe',
      path.join(os.tmpdir(), 'cloudflared.exe')
    ];
    
    for (const cmdPath of possiblePaths) {
      try {
        if (cmdPath.includes('\\')) {
          // It's a full path, check if file exists
          if (await fs.pathExists(cmdPath)) {
            return cmdPath;
          }
        } else {
          // It's a command, try to run it
          await execAsync(`${cmdPath} --version`);
          return cmdPath;
        }
      } catch (e) {
        // Continue to next path
      }
    }
    return null;
  }

  startTunnelProcess(cloudflaredCmd, args, resolve, reject) {
    console.log(chalk.gray(`Starting: ${cloudflaredCmd} ${args.join(' ')}`));

    this.tunnelProcess = spawn(cloudflaredCmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false
    });

    let tunnelUrl = null;
    let outputBuffer = '';
    let tunnelReady = false;
    let tunnelStartedAt = Date.now();

    const extractUrl = (data) => {
      const output = data.toString();
      outputBuffer += output;

      // Look for the actual tunnel URL pattern
      const patterns = [
        /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g,
        /Visit it at.*?(https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com)/g,
        /(https:\/\/[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+\.trycloudflare\.com)/g
      ];

      for (const pattern of patterns) {
        const matches = outputBuffer.match(pattern);
        if (matches) {
          const validUrls = matches.filter(url => 
            !url.includes('www.cloudflare.com') && 
            !url.includes('cloudflare.com') &&
            url.includes('.trycloudflare.com')
          );
          if (validUrls.length > 0) {
            return validUrls[0];
          }
        }
      }

      // Check for the specific formatted output with pipes
      if (outputBuffer.includes('Your quick Tunnel has been created')) {
        const lines = outputBuffer.split('\n');
        for (const line of lines) {
          if (line.includes('https://') && line.includes('.trycloudflare.com')) {
            const urlMatch = line.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
            if (urlMatch && !urlMatch[0].includes('www.cloudflare.com')) {
              return urlMatch[0];
            }
          }
        }
      }

      return null;
    };

    const checkTunnelReady = (data) => {
      const output = data.toString();
      
      // Look for tunnel connection established
      if (output.includes('Registered tunnel connection') || output.includes('Connected to')) {
        return true;
      }
      return false;
    };

    const onData = (data) => {
      const output = data.toString();
      
      // Only log important messages to reduce noise
      const importantMessages = [
        'Thank you for trying Cloudflare Tunnel',
        'Requesting new quick Tunnel',
        'Your quick Tunnel has been created',
        'Registered tunnel connection',
        'Connected to'
      ];
      
      if (importantMessages.some(msg => output.includes(msg))) {
        console.log(chalk.gray(`[cloudflared] ${output.trim()}`));
      }
      
      if (!tunnelUrl) {
        const url = extractUrl(data);
        if (url) {
          tunnelUrl = url;
          console.log(chalk.green(`✅ Tunnel URL detected: ${tunnelUrl}`));
          console.log(chalk.blue('⏳ Waiting for tunnel connection to establish...'));
        }
      }

      // Check if tunnel is fully ready and connected
      if (tunnelUrl && !tunnelReady) {
        if (checkTunnelReady(data)) {
          tunnelReady = true;
          const connectionTime = Date.now() - tunnelStartedAt;
          console.log(chalk.green(`✅ Tunnel connection established! (${connectionTime}ms)`));
          console.log(chalk.blue('📱 Tunnel is now active and keeping the process alive'));
          
          // IMPORTANT: Don't resolve the promise - keep the process running
          // The tunnel will stay active as long as this process is running
          console.log(chalk.green('🔗 Tunnel is now publicly accessible at:'), chalk.cyan(tunnelUrl));
          console.log(chalk.blue('💡 The tunnel will remain active until you stop the server (Ctrl+C)'));
          
          // Store the URL but don't resolve - keep the process alive
          this.tunnelUrl = tunnelUrl;
        }
      }
    };

    this.tunnelProcess.stdout.on('data', onData);
    this.tunnelProcess.stderr.on('data', onData);

    // Resolve after tunnel is ready, but keep the process running
    const checkReady = setInterval(() => {
      if (tunnelReady && tunnelUrl) {
        clearInterval(checkReady);
        resolve(tunnelUrl);
      }
    }, 1000);

    // Timeout after 90 seconds
    const timeout = setTimeout(() => {
      clearInterval(checkReady);
      if (!tunnelUrl) {
        reject(new Error('Timeout: Could not detect tunnel URL after 90 seconds'));
        this.stopTunnel();
      } else if (!tunnelReady) {
        console.log(chalk.yellow('⚠️  Tunnel URL detected but connection taking longer than expected...'));
        console.log(chalk.yellow('💡 The tunnel might still work. URL: ' + tunnelUrl));
        resolve(tunnelUrl);
      }
    }, 90000);

    this.tunnelProcess.on('error', (error) => {
      clearInterval(checkReady);
      clearTimeout(timeout);
      reject(new Error(`Tunnel process error: ${error.message}`));
    });

    this.tunnelProcess.on('close', (code) => {
      clearInterval(checkReady);
      clearTimeout(timeout);
      if (code !== 0 && !tunnelReady) {
        reject(new Error(`Tunnel process exited with code ${code}`));
      }
    });
  }

  async stopTunnel() {
    if (this.tunnelProcess) {
      console.log(chalk.blue('🛑 Stopping Cloudflare tunnel...'));
      this.tunnelProcess.kill();
      this.tunnelProcess = null;
      this.tunnelUrl = null;
      console.log(chalk.green('✅ Tunnel stopped'));
    }
  }

  async cleanupConfigs() {
    try {
      const files = await fs.readdir(this.configDir);
      const configFiles = files.filter(f => f.startsWith('tunnel-') && f.endsWith('.yml'));
      for (const file of configFiles) {
        await fs.remove(path.join(this.configDir, file));
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

module.exports = CloudflareTunnel;
const { exec } = require('child_process');
const { promisify } = require('util');
const chalk = require('chalk');

const execAsync = promisify(exec);

class SimpleTunnel {
  async createTunnel(port, options = {}) {
    const { subdomain } = options;
    
    try {
      // Try using localtunnel as a fallback
      return await this.useLocaltunnel(port, subdomain);
    } catch (error) {
      throw new Error(`Tunnel failed: ${error.message}`);
    }
  }

  async useLocaltunnel(port, subdomain) {
    console.log(chalk.blue('🔗 Starting localtunnel...'));
    
    try {
      // Install localtunnel if not available
      try {
        await execAsync('npx --yes localtunnel --version');
      } catch {
        console.log(chalk.yellow('📦 Installing localtunnel...'));
      }

      const subdomainArg = subdomain ? `--subdomain ${subdomain}` : '';
      const command = `npx --yes localtunnel --port ${port} ${subdomainArg}`;
      
      const { stdout } = await execAsync(command, { timeout: 15000 });
      
      // Extract URL from output
      const urlMatch = stdout.match(/https:\/\/[a-zA-Z0-9-]+\.loca\.lt/);
      if (urlMatch) {
        const url = urlMatch[0];
        console.log(chalk.green(`✅ Public Tunnel URL: ${url}`));
        return { url, localUrl: `http://localhost:${port}` };
      } else {
        throw new Error('Could not extract tunnel URL');
      }
    } catch (error) {
      throw new Error(`Localtunnel failed: ${error.message}`);
    }
  }
}

module.exports = SimpleTunnel;
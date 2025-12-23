const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const open = require('open');
const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class AuthService {
  constructor() {
    this.configDir = path.join(os.homedir(), '.joonweb');
    this.configFile = path.join(this.configDir, 'config.json');
    this.apiBase = 'https://accounts.joonweb.com'; // Your JoonWeb API base URL
  }

  async ensureAuthenticated() {
    const token = await this.getAccessToken();
    if (!token) {
      console.log(chalk.yellow('🔐 Authentication required...'));
      await this.deviceAuthFlow();
      return await this.getAccessToken();
    }
    
    // Verify token is still valid
    const isValid = await this.verifyToken(token);
    if (!isValid) {
      console.log(chalk.yellow('🔄 Token expired, please log in again...'));
      await this.deviceAuthFlow();
      return await this.getAccessToken();
    }
    
    return token;
  }

  async deviceAuthFlow() {
    try {
      console.log(chalk.blue('\n🚀 Starting device authorization...\n'));

      // Step 1: Request device authorization
      const deviceAuth = await this.requestDeviceAuthorization();
      if (!deviceAuth) {
        throw new Error('Failed to start device authorization');
      }
      
      // Step 2: Show user instructions
      this.showDeviceAuthInstructions(deviceAuth);

      // Step 3: Poll for token
      const token = await this.pollForToken(deviceAuth);
      
      // Step 4: Store token
      await this.storeToken(token);
      
      console.log(chalk.green('\n✅ Successfully logged in to JoonWeb!'));
      
      const user = await this.getCurrentUser();
      if (user) {
        console.log(chalk.blue(`👤 Logged in as: ${user.name}`));
        console.log(chalk.blue(`🏪 Store: ${user.shop}`));
      }
      
      return token;

    } catch (error) {
      console.error(chalk.red('\n❌ Authentication failed:'), error.message);
      throw error;
    }
  }

  async requestDeviceAuthorization() {
    try {
      console.log(chalk.cyan('📡 Requesting device authorization...'));
      
      const response = await axios.post(`${this.apiBase}/activate-device`, {
        client_id: 'joonweb-cli',
        scope: 'read_apps write_apps read_themes write_themes'
      }, {
        timeout: 10000, // 10 second timeout
        validateStatus: (status) => status < 500 // Don't throw on 4xx errors
      });

      if (response.status === 200 && response.data.device_code) {
        console.log(chalk.green('✅ Device authorization requested successfully'));
        return response.data;
      } else {
        console.log(chalk.red('❌ Device authorization request failed:'), response.data);
        throw new Error(`Server returned ${response.status}: ${JSON.stringify(response.data)}`);
      }

    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        console.log(chalk.red('❌ Cannot connect to JoonWeb authentication server'));
        console.log(chalk.yellow('💡 Please check:'));
        console.log('   • Your internet connection');
        console.log('   • The API base URL configuration');
        console.log('   • That the authentication server is running');
      } else if (error.response) {
        // Server responded with error status
        console.log(chalk.red(`❌ Server error: ${error.response.status}`));
        if (error.response.data && error.response.data.error) {
          console.log(chalk.red(`   ${error.response.data.error_description || error.response.data.error}`));
        }
      } else if (error.request) {
        // Request was made but no response received
        console.log(chalk.red('❌ No response from authentication server'));
        console.log(chalk.yellow('💡 Please check your network connection'));
      } else {
        console.log(chalk.red('❌ Unexpected error:'), error.message);
      }
      
      throw new Error('Device authorization request failed');
    }
  }

  generateUserCode() {
    // Generate a user-friendly code like "ABC-DEF"
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
      if (i === 2) code += '-';
    }
    return code;
  }

  showDeviceAuthInstructions(deviceAuth) {
    console.log(chalk.cyan('┌' + '─'.repeat(50) + '┐'));
    console.log(chalk.cyan('│') + chalk.white.bold('    JoonWeb Device Authorization    ') + chalk.cyan('│'));
    console.log(chalk.cyan('├' + '─'.repeat(50) + '┘'));
    console.log('');
    console.log(chalk.white('1. Open this URL in your browser:'));
    console.log(chalk.cyan(`   ${deviceAuth.verification_uri_complete || deviceAuth.verification_uri}`));
    console.log('');
    console.log(chalk.white('2. Enter this code:'));
    console.log(chalk.green.bold(`   ${deviceAuth.user_code}`));
    console.log('');
    console.log(chalk.white('3. Wait for authorization...'));
    console.log('');
    console.log(chalk.gray('   The code expires in 15 minutes.'));
    console.log(chalk.gray('   Press Ctrl+C to cancel at any time.'));
    console.log('');

    // Auto-open browser if possible
    this.openBrowser(deviceAuth.verification_uri_complete || deviceAuth.verification_uri);
  }

  async openBrowser(url) {
    try {
      console.log(chalk.blue('🌐 Opening browser...'));
      await open(url);
    } catch (error) {
      console.log(chalk.yellow('⚠️  Could not open browser automatically.'));
      console.log(chalk.blue('   Please open the URL manually.'));
    }
  }

  async pollForToken(deviceAuth) {
    const startTime = Date.now();
    const expiresAt = startTime + (deviceAuth.expires_in * 1000);
    let lastPollTime = startTime;
    
    console.log(chalk.cyan('⏳ Waiting for authorization...'));

    while (Date.now() < expiresAt) {
      try {
        const token = await this.requestToken(deviceAuth.device_code);
        
        if (token && token.access_token) {
          console.log(chalk.green('✅ Authorization confirmed!'));
          return token;
        }

        // Calculate wait time (respect server's interval)
        const elapsed = Date.now() - lastPollTime;
        const waitTime = Math.max(deviceAuth.interval * 1000 - elapsed, 1000);
        
        await this.sleep(waitTime);
        lastPollTime = Date.now();
        
        // Show waiting indicator
        process.stdout.write(chalk.gray('.'));
        
      } catch (error) {
        if (error.response && error.response.data) {
          const errorType = error.response.data.error;
          
          if (errorType === 'authorization_pending') {
            // Still waiting for user authorization - this is normal
            const elapsed = Date.now() - lastPollTime;
            const waitTime = Math.max(deviceAuth.interval * 1000 - elapsed, 1000);
            await this.sleep(waitTime);
            lastPollTime = Date.now();
            process.stdout.write(chalk.gray('.'));
            continue;
          } else if (errorType === 'slow_down') {
            // Server is asking us to slow down
            const newInterval = error.response.data.interval || deviceAuth.interval + 5;
            const waitTime = newInterval * 1000;
            await this.sleep(waitTime);
            lastPollTime = Date.now();
            process.stdout.write(chalk.yellow('.'));
            continue;
          } else if (errorType === 'access_denied') {
            throw new Error('Authorization was denied by user. Please try again.');
          } else if (errorType === 'expired_token') {
            throw new Error('Authorization code expired. Please try again.');
          } else if (errorType === 'invalid_grant') {
            throw new Error('Invalid device code. Please try again.');
          }
        }
        
        // Network or other errors
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          console.log(chalk.red('\n❌ Lost connection to authentication server'));
          throw new Error('Cannot connect to authentication server. Please check your connection.');
        }
        
        throw error;
      }
    }

    throw new Error('Authorization timed out. Please try again.');
  }

  async requestToken(deviceCode) {
    try {
      const response = await axios.post(`${this.apiBase}/activate-device`, {
        client_id: 'joonweb-cli',
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      }, {
        timeout: 10000,
        validateStatus: (status) => status < 500
      });

      if (response.status === 200) {
        return response.data;
      } else if (response.status === 400) {
        // Expected errors for OAuth device flow
        const errorData = response.data;
        const error = new Error(errorData.error_description || errorData.error);
        error.response = { data: errorData };
        throw error;
      } else {
        throw new Error(`Server returned ${response.status}: ${JSON.stringify(response.data)}`);
      }

    } catch (error) {
      if (error.response) {
        // Re-throw OAuth errors so pollForToken can handle them
        throw error;
      } else if (error.request) {
        throw new Error('No response from authentication server');
      } else {
        throw new Error(`Token request failed: ${error.message}`);
      }
    }
  }



  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async logout() {
    try {
      const token = await this.getAccessToken();
      if (token) {
        await axios.post(`${this.apiBase}/oauth/revoke`, {
          token: token,
          token_type_hint: 'access_token'
        }, {
          timeout: 5000
        }).catch(() => {
          // Ignore revocation errors (server might be down)
        });
      }

      await fs.remove(this.configFile);
      console.log(chalk.green('✅ Successfully logged out from JoonWeb'));
    } catch (error) {
      console.error(chalk.red('Logout failed:'), error.message);
    }
  }

  async getAccessToken() {
    try {
      if (await fs.pathExists(this.configFile)) {
        const config = await fs.readJson(this.configFile);
        if (config.access_token && config.expires_at > Date.now()) {
          return config.access_token;
        }
      }
    } catch (error) {
      // Ignore errors
    }
    return null;
  }

  async verifyToken(token) {
    try {
      if (await fs.pathExists(this.configFile)) {
        const config = await fs.readJson(this.configFile);
        return config.expires_at > Date.now();
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async storeToken(token) {
    await fs.ensureDir(this.configDir);
    
    const config = {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: Date.now() + (token.expires_in * 1000),
      scope: token.scope,
      logged_in_at: new Date().toISOString(),
      token_type: token.token_type
    };

    await fs.writeJson(this.configFile, config, { spaces: 2 });
  }

  async getCurrentUser() {
    const token = await this.getAccessToken();
    if (!token) return null;

    try {
      const response = await axios.get(`https://accounts.joonweb.com/api/?fetch=User`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000
      });

      if (response.status === 200) {
        console.log(chalk.yellow(JSON.stringify(response.data)));
        return response.data.data;
      }
    } catch (error) {
      // If user info endpoint fails, return minimal info from token
      console.log(chalk.yellow('⚠️  Could not fetch user details'));
    }

    return {
      name: 'JoonWeb Developer',
      email: 'developer@joonweb.com',
    };
  }

  async getUserOrganizations() {
    const token = await this.getAccessToken();
    if (!token) return [];
    try {
      const response = await axios.get(`https://accounts.joonweb.com/api/?fetch=Partners`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000
      });
      if (response.status === 200) {
        return response.data.data;
      } else {  
        return [];
      }
    } catch (error) {
      return [];
    }
  }

  async getDevelopmentSites(partner_id) {
    const token = await this.getAccessToken();
    if (!token) return [];
    try {
      const response = await axios.get(`https://accounts.joonweb.com/api/?fetch=DevSites`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000
      });
      if (response.status === 200) {
        return response.data.data;
      } else {  
        return [];
      }
    } catch (error) {
      return [];
    }
  }



  async fetchUserApps(selectedOrg) {
    const token = await this.getAccessToken();
    if (!token) return [];
    try {
      const response = await axios.get(`https://accounts.joonweb.com/api/?fetch=Apps&partner_id=${selectedOrg.id}&type=${selectedOrg.type}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000
      });
      if (response.status === 200) {
        return response.data.data;
      } else {  
        return [];
      }
    } catch (error) {
      return [];
    }
  }
    

  async isLoggedIn() {
    const token = await this.getAccessToken();
    return !!token && await this.verifyToken(token);
  }

  async getAuthStatus() {
    const isLoggedIn = await this.isLoggedIn();
    const user = await this.getCurrentUser();
    
    return {
      isLoggedIn,
      user,
      configFile: this.configFile
    };
  }
}

module.exports = AuthService;
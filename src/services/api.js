const axios = require('axios');
const crypto = require('crypto');
const AuthService = require('./auth');
const fs = require('fs');
const chalk = require('chalk');
const path = require('path');
const os = require('os');

class ApiService {
  constructor() {
    this.authService = new AuthService();
    this.baseURL = 'https://accounts.joonweb.com/api';
  }

  generateSignature(token, timestamp, nonce, body = '') {
    const baseString = token + timestamp + nonce + body;
    return crypto
      .createHmac('sha256', token)
      .update(baseString)
      .digest('hex');
  }
  

  async makeRequest(config) {
    const token = await this.authService.getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const timestamp = Date.now().toString();
    const nonce = Math.random().toString(36).substring(2);
    const body = config.data ? JSON.stringify(config.data) : '';
    const signature = this.generateSignature(token, timestamp, nonce, body);

    try {
      const response = await axios({
        ...config,
        baseURL: this.baseURL,
        url: config.url || '/',
        headers: {
          'X-JW-CLI-TOKEN': token,
          'X-JW-CLI-TIMESTAMP': timestamp,
          'X-JW-CLI-NONCE': nonce,
          'X-JW-CLI-SIGNATURE': signature,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...config.headers
        },
        timeout: 10000
      });


      return response;
    } catch (error) {
      if (error.response) {
        throw new Error(`API Error: ${error.response.status} - ${error.response.data?.error || error.message}`);
      } else if (error.request) {
        throw new Error('No response from server');
      } else {
        throw new Error(`Request error: ${error.message}`);
      }
    }
  }

  async getApps() {
    try {
      const response = await this.makeRequest({
        method: 'GET',
        url: '/v1/apps'
      });
      return response.data;
    } catch (error) {
      console.log('Using mock data due to error:', error.message);
      return [
        { id: 'app_1', name: 'My Store App' },
        { id: 'app_2', name: 'Analytics Dashboard' },
        { id: 'app_3', name: 'Customer Manager' }
      ];
    }
  }

 async getDevelopmentSites(){

 const response = await this.makeRequest({
    url: '/?fetch=Stores',
    method: 'GET'
  });

  return response.data;

}


 async InstallApp($install_data){

  try{
    const response = await this.makeRequest({
        url: '/',
        method: 'POST',
        data:{
          cli: 'app.install',
          ...$install_data
        }
      });

      console.log('Full response:', response.data);
      
      if (response.data && response.data.success) {
            return response.data.data;  
          } else {
            //throw new Error(`Failed to Install The app: ${response.data?.error || 'Unknown error'}`);
      }

    }catch(error){
      console.log('Error installing app:', error);
      throw new Error(`Error installing app: ${error.message}`);
    }

}

async pushExtensionUpdate(extensionData) {
  try {
    const response = await this.makeRequest({
      url: '/',
      method: 'POST',
      data: {
        cli: 'extension.push_update',
        ...extensionData
      }
    });
    return response.data;
  } catch (error) {
    throw new Error(`Error pushing extension update: ${error.message}`);
  }
}


async registerExtension(extensionData) {
  try {
    // Validate input
    if (!extensionData || typeof extensionData !== 'object') {
      throw new Error('Extension data must be a valid object');
    }

    const payload = { ...extensionData };
    
    // Async file handling for better performance
    if (payload.ext_zip_path) {
      const zipPath = payload.ext_zip_path;
      
      try {
        // Async file operations
        const stats = await fs.promises.stat(zipPath);
        
        if (!stats.isFile()) {
          throw new Error(`Path is not a file: ${zipPath}`);
        }
        
        // File size validation
        const MAX_FILE_SIZE = 50 * 1024 * 1024;
        if (stats.size > MAX_FILE_SIZE) {
          throw new Error(`File size ${(stats.size / 1024 / 1024).toFixed(1)}MB exceeds 50MB limit`);
        }
        
        // Read file asynchronously
        const fileBuffer = await fs.promises.readFile(zipPath);
        payload.extension_zip_base64 = fileBuffer.toString('base64');
        
        console.log(chalk.gray(`📦 Uploading ${(stats.size / 1024 / 1024).toFixed(2)}MB extension file`));
        
      } catch (fileError) {
        throw new Error(`Failed to process zip file: ${fileError.message}`);
      }
      
      // Remove temp property
      delete payload.ext_zip_path;
    }

    // Validate required fields for registration
    const requiredFields = ['site_id', 'app_jwt', 'extension_config'];
    const missingFields = requiredFields.filter(field => !payload[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    // Validate extension config structure
    if (payload.extension_config) {
      if (!payload.extension_config.name) {
        throw new Error('Extension config must include a name');
      }
      if (!payload.extension_config.type) {
        throw new Error('Extension config must include a type');
      }
    }

    // Make API request with progress indication
    console.log(chalk.cyan('🔄 Registering extension with server...'));
    
    const response = await this.makeRequest({
      url: '/',
      method: 'POST',
      data: {
        cli: 'extension.register',
        request_id: `ext_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        metadata: {
          timestamp: new Date().toISOString(),
          file_size: payload.extension_zip_base64 ? 
            Buffer.from(payload.extension_zip_base64, 'base64').length : 0,
          has_zip: !!payload.extension_zip_base64
        },
        ...payload
      },
      timeout: 180000, // 3 minutes for large uploads
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    // Response validation
    if (!response.data) {
      throw new Error('Empty response from server');
    }

    if (response.data.success === true) {
      const result = response.data.data || {};
      
      // Log success with details
      console.log(chalk.green(`✅ Extension "${payload.extension_config.name}" registered successfully`));
      
      if (result.extension_id) {
        console.log(chalk.gray(`   Extension ID: ${result.extension_id}`));
      }
      if (result.version) {
        console.log(chalk.gray(`   Version: ${result.version}`));
      }
      if (result.upload_url) {
        console.log(chalk.gray(`   Upload URL: ${result.upload_url}`));
      }
      
      return result;
      
    } else {
      // Enhanced error extraction
      const errorData = response.data.error || {};
      const errorMsg = errorData.message || 
                      response.data.message || 
                      'Registration failed';
      const errorDetails = errorData.details || 
                          (typeof response.data === 'string' ? response.data : '');
      
      let fullError = errorMsg;
      if (errorDetails) {
        fullError += `\nDetails: ${errorDetails}`;
      }
      
      // Specific error handling
      if (errorMsg.toLowerCase().includes('unauthorized') || 
          errorMsg.toLowerCase().includes('authentication')) {
        throw new Error(`Authentication failed: ${fullError}`);
      } else if (errorMsg.toLowerCase().includes('quota') || 
                errorMsg.toLowerCase().includes('limit')) {
        throw new Error(`Extension quota exceeded: ${fullError}`);
      } else if (errorMsg.toLowerCase().includes('validation')) {
        throw new Error(`Validation error: ${fullError}`);
      } else {
        throw new Error(fullError);
      }
    }

  } catch (error) {
    // Comprehensive error handling
    console.error(chalk.red(`❌ Extension registration failed`));
    
    // Re-throw with appropriate context
    if (error.message.includes('Extension registration')) {
      throw error; // Already has context
    } else {
      throw new Error(`Extension registration failed: ${error.message}`);
    }
  }
}


  async createApp(appData) {
    try {
      const response = await this.makeRequest({
        method: 'POST',
        url: '/', // Added URL
        data: { 
          cli: 'app.create',
          ...appData
        }
      });
      
      // Check the response data structure
      if (response.data && response.data.success) {
        return response.data.data;  
      } else {
        throw new Error(`Failed to create app: ${response.data?.error || 'Unknown error'}`);
      }
    } catch (error) {
      throw new Error(`Error creating app: ${error.message}`);
    }
  }

  async getApp(appId) {
    try {
      const response = await this.makeRequest({
        method: 'GET',
        url: `/v1/apps/${appId}`
      });
      return response.data;
    } catch (error) {
      throw new Error(`App not found: ${appId}`);
    }
  }
}

module.exports = ApiService;
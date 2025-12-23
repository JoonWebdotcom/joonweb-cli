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

async function extensionGenerate(options) {
  const authService = new AuthService();
  const apiService = new ApiService();
  console.log(chalk.cyan('🔐 Checking authentication...'));
  await authService.ensureAuthenticated();
  const user = await authService.getCurrentUser();
  const { port, tunnel, open: shouldOpen, subdomain } = options;
  const projectPath = process.cwd();

    // Check if this is a JoonWeb app directory
    const appConfig = await getAppConfig(projectPath);
    if (!appConfig) {
      console.log(chalk.yellow('⚠️  Not a JoonWeb app directory.'));
      console.log(chalk.cyan('💡 Run "joonweb init" to create a new app, before generating extension.'));
      return;
    }

    console.log(chalk.cyan(`🧩 Generating extension for app: ${appConfig.name}`));

  // Define your groups

  const extensionGroups = {
    '🎨 Theme Extensions': [{
      name: '  Theme App Extension',
      value: "theme_app_extension",
      description: 'Customize store themes'
    }],
    '🖥️  UI Extensions': [{
      name: '  Customer UI Extension',
      value: "customer_ui_extension",
      description: 'Customer-facing UI components'
    }, {
      name: '  Admin UI Extension',
      value: "admin_ui_extension",
      description: 'Admin panel UI components'
    }],
    '⚙️  Backend Extensions': [{
      name: '  Function Extension',
      value: "function_extension",
      description: 'Serverless functions & APIs'
    }, {
      name: '  Webhook Extension',
      value: "webhook_extension",
      description: 'Handle webhook events'
    }]
  };
  // Helper function to create grouped choices
  function createGroupedChoices(groups) {
    const choices = [];
    
    Object.entries(groups).forEach(([groupName, items]) => {
      // Add group header with styling
      choices.push(new inquirer.Separator(chalk.bold(`\n${groupName}`)));
      choices.push(new inquirer.Separator('─'.repeat(groupName.length + 2)));
      
      // Add items with optional descriptions
      items.forEach(item => {
        choices.push({
          name: item.description 
            ? `${item.name} ${chalk.gray(`- ${item.description}`)}`
            : item.name,
          value: item.value,
          short: item.name.trim() // For summary display
        });
      });
    });
    
    return choices;
  }

  // Prompt with grouped choices
  const { extension_group } = await inquirer.prompt([
    {
      type: 'list',
      name: 'extension_group',
      message: `${chalk.bold('Select the type of extension to generate:')}`,
      pageSize: 12, // Shows all items without scrolling
      choices: createGroupedChoices(extensionGroups),
      loop: false // Disable circular navigation
    }
  ]);
  

    console.log(chalk.cyan(`🧩 Selected extension type: ${extension_group}`));

    if(extension_group){
      // Here you can add logic to generate the selected extension type
      console.log(chalk.green(`Preparing ${extension_group} extension!`));
      // For example, create necessary files/folders based on the type
      // This is a placeholder for actual generation logic
      const extensionsDir = path.join(projectPath, 'extensions');
      if (!fs.existsSync(extensionsDir)){
        fs.mkdirSync(extensionsDir);
      }

      const { extension_name } = await inquirer.prompt([
        {
          type: 'input',
          name: 'extension_name',
          message: 'Enter a name for your extension',
          validate: input => {
            if (!input) return 'Extension name is required';
            if (input.length < 3) return 'Extension name must be at least 3 characters';
            return true;
          }
        }
      ]);

      console.log(chalk.cyan(`🧩 Extension name: ${extension_name}`));

      // Check if already extension folder exists with same name.
      const extensionPath = path.join(extensionsDir, extension_name);
      if (fs.existsSync(extensionPath)) {
        console.log(chalk.red(`❌ Extension with name "${extension_name}" already exists. Please choose a different name.`));
        return;
    } else {
        fs.mkdirSync(extensionPath);
        console.log(chalk.green(`✅ Created extension directory: ${extension_name}`));
    }

      // Either import template files based on extension type or create basic app-embeded app structure.
      // Import template files based on extension type.
      const isfileavailable = await importExtensionFiles(extension_group, extensionPath, extension_name);

      if(!isfileavailable){
        if(extension_group !== 'theme_app_extension') return console.log(chalk.yellow('⚠️  Currently, only "Theme App Extension" is supported, others extensions coming soon!'));
          // Create folder: assets, snippets, blocks, etc. based on extension type inside above created folder.
          const extensionFolderMap = ['assets','componenets','blocks'];
          // Check and create folder.
          extensionFolderMap.forEach(folderName => {
            const folderPath = path.join(extensionPath, folderName);
            if (!fs.existsSync(folderPath)){
              fs.mkdirSync(folderPath);
            }
          });

          // Now After folder, create joonweb.extension.json file inside it if not already present.
          const extensionConfigPath = path.join(extensionPath, 'joonweb.extension.json');
          if (fs.existsSync(extensionConfigPath)) {
            console.log(chalk.yellow('⚠️  Extension configuration already exists. Skipping creation.'));
          } else {
            // Creation of files
            const files = [
              'assets/' + extension_name + '.css',
              'assets/' + extension_name + '.js',
              'blocks/' + extension_name + '-block.jw'
            ];

            files.forEach(file => {
                const filePath = path.join(extensionPath, file);
                fs.writeFileSync(filePath, '');
            });

            const extensionConfig = {
              name: extension_name,
              version: "1.0.0",
              type: extension_group,
              blocks: [
                {
                  type: "app_embed",
                  name: `${extension_name} Block`,
                  target: "body",
                  src: `blocks/${extension_name}-block.jw`,
                }
              ],
              assets: [
                {
                  path: `assets/${extension_name}.css`,
                  type: "css"
                },
                {
                  path: `assets/${extension_name}.js`,
                  type: "js"
                }
              ]
            };
          
            fs.writeFileSync(extensionConfigPath, JSON.stringify(extensionConfig, null, 2));
            console.log(chalk.green('✅ Created extension configuration file: joonweb.extension.json'));
          }
      }
    }
}

async function importExtensionFiles(extensionType, destinationPath, extensionName) {
    // Map extension types to template directories
    const templateMap = {
        'theme_app_extension': 'theme-extension',
        'customer_ui_extension': 'customer-account-ui-extension',
    };
    // Check in github repo for template files.
    const templateDirName = templateMap[extensionType];
    if (!templateDirName) {
        console.log(chalk.yellow('⚠️  No template files available for this extension type. Creating basic structure instead.'));
        return false;
    }
    // Github repo base URL: https://github.com/JoonWebdotcom/extensions-templates/
    const githubBaseURL = 'https://raw.githubusercontent.com/JoonWebdotcom/extensions-templates/main/';
    const templateURL = `${githubBaseURL}${templateDirName}/`;  
    // Check if exists, and copy folder "extensionType" from github to destinationPath.
    // Check if temlate url exists.
    try {
        const response = await fetch(templateURL);
        if (!response.ok) {
            console.log(chalk.yellow('⚠️  Template files not found in repository. Creating basic structure instead.'));
            return false;
        }
    } catch (error) {
        console.log(chalk.yellow('⚠️  Error fetching template files. Creating basic structure instead.'));
        return false;
    }
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
  

module.exports = extensionGenerate;


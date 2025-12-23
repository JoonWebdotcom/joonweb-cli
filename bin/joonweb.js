#!/usr/bin/env node

const { program } = require('commander');
const chalk = require('chalk');
const { version } = require('../package.json');

// Import commands
const AppinitCommand = require('../src/commands/init');
const serveCommand = require('../src/commands/serve');
const deployCommand = require('../src/commands/deploy');
const loginCommand = require('../src/commands/login');
const logoutCommand = require('../src/commands/logout');
const whoamiCommand = require('../src/commands/whoami');
const extensionGenerate = require('../src/commands/extension');

program
  .name('joonweb')
  .description('JoonWeb CLI - Build apps for JoonWeb platform')
  .version(version);

// ---------- APP COMMAND GROUP ----------
const app = program.command('app').description('App related commands');

app
  .command('init')
  .description('Create a new JoonWeb app')
  .action(AppinitCommand);

app
  .command('serve')
  .description('Start development server with auto-tunnel')
  .option('--port <port>', 'port number', '3000')
  .option('--no-tunnel', 'disable auto-tunnel')
  .option('--no-open', 'disable browser auto-open')
  .action(serveCommand);

app
  .command('deploy')
  .description('Deploy app to JoonWeb')
  .option('--env <environment>', 'deployment environment', 'production')
  .action(deployCommand);

// ---------- Generate App Extensions ----------
const generate = app.command('generate').description('Generate app extensions');
generate
  .command('extension')
  .description('Generate a new app extension')
  .action(extensionGenerate);


// ---------- AUTH COMMANDS ----------
program
  .command('login')
  .description('Log in to your JoonWeb account')
  .option('--shop <shop>', 'shop domain')
  .action(loginCommand);

program
  .command('logout')
  .description('Log out from JoonWeb')
  .action(logoutCommand);

program
  .command('whoami')
  .description('Show current login status')
  .action(whoamiCommand);

// ---------- DEFAULT ----------
if (!process.argv.slice(2).length) {
  console.log(chalk.cyan('🚀 JoonWeb CLI'));
  console.log(chalk.gray('   Build amazing apps for JoonWeb\n'));
  program.outputHelp();
}

program.parse(process.argv);

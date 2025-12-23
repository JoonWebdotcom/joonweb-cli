const chalk = require('chalk');
const AuthService = require('../services/auth');

async function loginCommand() {
  try {
    const authService = new AuthService();
    
    // Check if already logged in
    if (await authService.isLoggedIn()) {
      const user = await authService.getCurrentUser();
      console.log(chalk.yellow('⚠️  Already logged in to JoonWeb'));
      console.log(chalk.blue(`👤 Currently logged in as: ${user.name}`));
      
      const { relogin } = await require('inquirer').prompt([
        {
          type: 'confirm',
          name: 'relogin',
          message: 'Do you want to log in again?',
          default: false
        }
      ]);

      if (!relogin) {
        return;
      }
    }

    console.log(chalk.cyan('\n🔐 JoonWeb Login'));
    console.log(chalk.gray('   You will be guided through device authorization\n'));
    
    // Start device auth flow
    await authService.deviceAuthFlow();
    
  } catch (error) {
    console.error(chalk.red('\n❌ Login failed:'), error.message);
    process.exit(1);
  }
}

module.exports = loginCommand;
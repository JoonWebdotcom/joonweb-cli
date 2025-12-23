const chalk = require('chalk');
const AuthService = require('../services/auth');

async function whoamiCommand() {
  try {
    const authService = new AuthService();
    const authStatus = await authService.getAuthStatus();
    
    if (authStatus.isLoggedIn && authStatus.user) {
      console.log(chalk.green('✅ Logged in to JoonWeb'));
      console.log(chalk.blue(`👤 Name: ${authStatus.user.name}`));
      console.log(chalk.blue(`📧 Email: ${authStatus.user.email}`));
      console.log(chalk.gray(`🔑 Config: ${authStatus.configFile}`));
    } else {
      console.log(chalk.yellow('🔒 Not logged in to JoonWeb'));
      console.log(chalk.blue('   Run "joonweb login" to authenticate'));
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

module.exports = whoamiCommand;
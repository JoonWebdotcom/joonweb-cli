const chalk = require('chalk');
const AuthService = require('../services/auth');

async function logoutCommand() {
  try {
    const authService = new AuthService();
    await authService.logout();
  } catch (error) {
    console.error(chalk.red('Logout failed:'), error.message);
    process.exit(1);
  }
}

module.exports = logoutCommand;
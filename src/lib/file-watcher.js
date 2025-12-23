const chokidar = require('chokidar');
const chalk = require('chalk');
const path = require('path');

function watchForChanges(projectPath, onChangeCallback) {
  const watcher = chokidar.watch([
    path.join(projectPath, '**/*.html'),
    path.join(projectPath, '**/*.js'),
    path.join(projectPath, '**/*.css'),
    path.join(projectPath, '**/*.json')
  ], {
    ignored: /(^|[/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true
  });

  watcher
    .on('change', (filePath) => {
      const relativePath = path.relative(projectPath, filePath);
      console.log(chalk.blue(`🔄 File changed: ${relativePath}`));
      onChangeCallback();
    })
    .on('error', (error) => {
      console.log(chalk.red(`Watcher error: ${error}`));
    });

  return watcher;
}

module.exports = { watchForChanges };
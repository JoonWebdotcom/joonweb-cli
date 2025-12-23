const { AuthorizationCode } = require('simple-oauth2');

function createAuth() {
  const config = {
    client: {
      id: 'joonweb-cli',
      secret: 'cli-secret' // In real implementation, this would be secure
    },
    auth: {
      tokenHost: 'https://api.joonweb.com',
      tokenPath: '/oauth/token',
      authorizePath: '/oauth/authorize'
    }
  };

  return new AuthorizationCode(config);
}

module.exports = { createAuth };
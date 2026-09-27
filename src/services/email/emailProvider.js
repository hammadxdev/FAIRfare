const resendProvider = require("./resendEmailProvider");

let provider = resendProvider;

function setEmailProviderForTests(nextProvider) {
  provider = nextProvider || resendProvider;
}

function getEmailProvider() {
  return provider;
}

module.exports = { getEmailProvider, setEmailProviderForTests };

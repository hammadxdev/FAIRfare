const validator = require("./src/services/fairFareDatasetValidator.service");
if (require.main === module) {
  const report = validator.validateFairFareDatasetV1(process.argv[2]);
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) process.exitCode = 1;
}
module.exports = validator;

const fs = require("fs");
const path = require("path");
const db = require("../config/database");

function migrate() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);
  console.log("Migration complete: schema applied.");
}

migrate();

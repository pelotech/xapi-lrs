const connectionString = process.env.DATABASE_URL;

module.exports = {
  connectionString,
  shadowConnectionString: `${connectionString}_shadow`,
  rootConnectionString: connectionString.replace(/\/[^/]+$/, '/postgres'),
  pgSettings: {},
  placeholders: {},
  afterReset: [],
  afterAllMigrations: [],
  afterCurrent: [],
  blankMigrationContent: "-- Enter migration here\n",
  migrationsFolder: "./db/migrations",
};

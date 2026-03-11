/** @type {import("graphile-migrate").Settings} */
module.exports = {
  connectionString: process.env.DATABASE_URL || `postgres://${process.env.PGUSER || 'xapi_lrs'}:${process.env.PGPASSWORD || 'xapi_lrs'}@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || '5432'}/${process.env.PGDATABASE || 'xapi_lrs'}`,
  shadowConnectionString: process.env.SHADOW_DATABASE_URL || `postgres://${process.env.PGUSER || 'xapi_lrs'}:${process.env.PGPASSWORD || 'xapi_lrs'}@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || '5432'}/${process.env.PGDATABASE || 'xapi_lrs'}_shadow`,
  migrationsFolder: './db/migrations',
};

const app = require('./app');
const env = require('./config/env');
const sequelize = require('./config/database');
require('./models'); // registers all associations
const scheduler = require('./jobs/scheduler');

async function start() {
  await sequelize.authenticate();
  // eslint-disable-next-line no-console
  console.log('Database connection established.');

  if (env.nodeEnv === 'development') {
    await sequelize.sync(); // dev convenience only — production uses versioned migrations (NFR-23)
  }

  scheduler.start();

  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`LMS backend listening on port ${env.port} [${env.nodeEnv}]`);
  });
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});

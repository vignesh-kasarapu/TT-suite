require('express-async-errors');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const env = require('./config/env');
const routes = require('./routes');
const errorMiddleware = require('./middleware/error.middleware');

const app = express();

app.use(helmet());
app.use(cors({ origin: env.clientBaseUrl, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'));

// NFR-22: health endpoint reporting DB and mail-transport reachability.
app.get('/api/health', async (req, res) => {
  const sequelize = require('./config/database');
  let dbOk = true;
  try {
    await sequelize.authenticate();
  } catch {
    dbOk = false;
  }
  res.json({ status: dbOk ? 'ok' : 'degraded', database: dbOk, timestamp: new Date().toISOString() });
});

app.use('/api', routes);

app.use((req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'This endpoint does not exist.' } });
});

app.use(errorMiddleware);

module.exports = app;

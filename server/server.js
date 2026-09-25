import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import connectDB from './config/db.js';
import { notFound, errorHandler } from './middleware/errorMiddleware.js';
import healthRoutes from './routes/healthRoutes.js';
import authRoutes from './routes/authRoutes.js';
import challengeRoutes from './routes/challengeRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import collaborationRoutes from './routes/collaborationRoutes.js';
import userRoutes from './routes/userRoutes.js';
import sahayakRoutes from './routes/sahayakRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import industryRoutes from './routes/industryRoutes.js';
import clubRoutes from './routes/clubRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import locationRoutes from './routes/locationRoutes.js';
import rewardRoutes from './routes/rewardRoutes.js';
import searchRoutes from './routes/searchRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';

// Load environment variables
const currentFilePath = fileURLToPath(import.meta.url);
const serverDirectory = path.dirname(currentFilePath);
dotenv.config({ path: path.resolve(serverDirectory, '..', '.env') });

const app = express();
const PORT = Number.parseInt(process.env.PORT || '5000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const configuredOrigins = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);
const developmentOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const allowedOrigins = configuredOrigins.length ? configuredOrigins : developmentOrigins;
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) {
      return callback(null, true);
    }
    return callback(new Error('CORS origin is not allowed'));
  },
  credentials: true,
}));

// Routes
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/collaborations', collaborationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sahayak', sahayakRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/rewards', rewardRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/industry', industryRoutes);
app.use('/api/clubs', clubRoutes);

// 404 Middleware
app.use(notFound);

// Error Handler Middleware
app.use(errorHandler);

// Connect to MongoDB before accepting requests so auth never runs against an
// unready database connection.
const startServer = async () => {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not defined in the project-root .env file');
    }

    await connectDB();
    app.listen(PORT, HOST, () => {
      console.log(`\n✓ Server running on http://${HOST}:${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}\n`);
    });
  } catch (error) {
    console.error(`✗ Server startup failed: ${error.message}`);
    process.exitCode = 1;
  }
};

startServer();

export default app;

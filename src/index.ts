import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { testRedisConnection } from './redis.js';
import { authenticateToken } from './middleware/auth.js';
import signalingRoutes from './routes/signaling.js';

dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET', 'REDIS_HOST'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => console.error(`   - ${varName}`));
  process.exit(1);
}

console.log('✅ Environment variables validated');

const app = express();
const PORT = parseInt(process.env.PORT || '3002', 10);

// Trust proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS configuration
const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS: Rejected request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting - Very relaxed for P2P (signal polling happens every second)
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10000, // 10000 requests per minute (allows ~166 req/sec)
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false
});

const announceLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500, // 500 announces per minute per IP (for multiple patches + re-announces)
  message: { error: 'Too many announce requests' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', globalLimiter);
app.use('/api/announce', announceLimiter);

// Body parsing (increased limit for large bitfields)
app.use(express.json({ limit: '1mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'ERROR' : 'INFO';
    console.log(`[${logLevel}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Public routes (no auth)
app.get('/health', signalingRoutes);
app.get('/metrics', signalingRoutes);

// Protected routes (require auth)
app.use('/api', authenticateToken, signalingRoutes);

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Server startup
async function startServer() {
  try {
    console.log('🚀 Starting Hades Signaling Server...');
    console.log(`📌 Environment: ${process.env.NODE_ENV || 'development'}`);
    
    // Test Redis connection
    console.log('🔌 Testing Redis connection...');
    await testRedisConnection();
    
    // Start HTTP server on all interfaces (0.0.0.0)
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Signaling server running on port ${PORT}`);
      console.log(`🌐 API available at http://0.0.0.0:${PORT}/api`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\nSIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\nSIGINT received, shutting down gracefully...');
  process.exit(0);
});

startServer();


import { worker } from "node:cluster";
import { query } from "winston";

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

export const config = {
  role:          (process.env.ROLE as 'api' | 'worker' | 'scheduler') || 'api',
  port:          parseInt(process.env.PORT || '3000'),
  dbType:        required('DB_TYPE'),
  dbName:        required('DB_NAME'),
  mongoUri:      required('MONGO_URL'),
  dbPoolSize:    Number(process.env.DB_POOL_SIZE) || 15,
  serverTimeout: Number(process.env.SERVER_SEL_TIMEOUT) || 5000,
  redisUrl:      required('REDIS_URL'),
  channel : {
    logFileDir:  process.env.LOG_FILE_DIR || '../../logs',
  },
  queueName:     process.env.QUEUE_NAME || 'reminder',
  birthdayHour:  parseInt(process.env.BIRTHDAY_HOUR || '9'),
  schedulingFrequency: parseInt(process.env.SCHEDULING_FREQUENCY || '1'), // in hours
  queryBatchSize: parseInt(process.env.QUERY_BATCH_SIZE || '420'),
  workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '5'),
};
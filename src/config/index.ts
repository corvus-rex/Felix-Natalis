const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

export const config = {
  port:    parseInt(process.env.PORT || '3000'),
  dbType: required('DB_TYPE'),
  dbName: required('DB_NAME'),
  mongoUri: required('MONGO_URI'),
  dbPoolSize: Number(process.env.DB_POOL_SIZE) || 10,
  serverTimeout: Number(process.env.SERVER_SEL_TIMEOUT) || 5000,
  redisUrl: required('REDIS_URL'),
};
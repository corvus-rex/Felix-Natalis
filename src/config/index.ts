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
};
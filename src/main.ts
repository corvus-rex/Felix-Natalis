import express from 'express';

const app  = express();
const PORT = process.env.PORT || 3001;

app.get('/health', (_, res) => {
  res.json({ status: 'Hello sekai' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import { cors } from 'hono/cors';

type Env = {
  DATABASE_URL: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use(
  '/*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Content-Length', 'X-Requested-With'],
  })
);

// GET all users
app.get('/users', async (c) => {
  if (!c.env.DATABASE_URL) {
    return c.json({ error: 'DATABASE_URL is not set' }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);

  try {
    const result = await sql`
      SELECT 
        id,
        name,
        email,
        status,
        created_at
      FROM users
      ORDER BY created_at DESC
    `;
    
    return c.json(result);
  } catch (error) {
    console.error('Database error:', error);
    return c.json({ error: 'Failed to fetch users' }, 500);
  }
});

// Error handler
app.onError((e, c) => {
  console.error(e);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
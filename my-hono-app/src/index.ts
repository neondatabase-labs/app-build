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

// POST new user
app.post('/users', async (c) => {
  if (!c.env.DATABASE_URL) {
    return c.json({ error: 'DATABASE_URL is not set' }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);

  try {
    const body = await c.req.json();

    // Basic validation
    if (!body.username || !body.email || !body.password_hash) {
      return c.json({ error: 'username, email, and password_hash are required' }, 400);
    }

    const result = await sql`
      INSERT INTO users (
        username, 
        email, 
        password_hash,
        created_at
      ) VALUES (
        ${body.username},
        ${body.email},
        ${body.password_hash},
        CURRENT_TIMESTAMP
      )
      RETURNING id, username, email, created_at
    `;

    return c.json(result[0], 201);
  } catch (error) {
    // Check for unique constraint violations
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      return c.json({ error: 'Username or email already exists' }, 409);
    }
    throw error;
  }
});

// Error handler
app.onError((e, c) => {
  console.error(e);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
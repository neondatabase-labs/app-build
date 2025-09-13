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

// USERS ROUTES

// GET all users
app.get('/users', async (c) => {
  if (!c.env.DATABASE_URL) {
    return c.json({ error: 'DATABASE_URL is not set' }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);

  try {
    const result = await sql`
      SELECT id, name, email, status, created_at
      FROM users
      ORDER BY created_at DESC
    `;
    return c.json(result);
  } catch (error) {
    console.error('Error fetching users:', error);
    return c.json({ error: 'Failed to fetch users' }, 500);
  }
});

// GET single user
app.get('/users/:id', async (c) => {
  if (!c.env.DATABASE_URL) {
    return c.json({ error: 'DATABASE_URL is not set' }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);
  const userId = parseInt(c.req.param('id'));

  if (isNaN(userId)) {
    return c.json({ error: 'Invalid user ID' }, 400);
  }

  try {
    const result = await sql`
      SELECT id, name, email, status, created_at
      FROM users
      WHERE id = ${userId}
    `;

    if (result.length === 0) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json(result[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    return c.json({ error: 'Failed to fetch user' }, 500);
  }
});

// POST new user
app.post('/users', async (c) => {
  if (!c.env.DATABASE_URL) {
    return c.json({ error: 'DATABASE_URL is not set' }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);

  try {
    const body = await c.req.json();

    if (!body.name || !body.email || !body.status) {
      return c.json({ error: 'Name, email, and status are required' }, 400);
    }

    const result = await sql`
      INSERT INTO users (name, email, status, created_at)
      VALUES (${body.name}, ${body.email}, ${body.status}, CURRENT_TIMESTAMP)
      RETURNING id, name, email, status, created_at
    `;

    return c.json(result[0], 201);
  } catch (error) {
    console.error('Error creating user:', error);
    return c.json({ error: 'Failed to create user' }, 500);
  }
});

// PUT update user
app.put('/users/:id', async (c) => {
  if (!c.env.DATABASE_URL) {
    return c.json({ error: 'DATABASE_URL is not set' }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);
  const userId = parseInt(c.req.param('id'));

  if (isNaN(userId)) {
    return c.json({ error: 'Invalid user ID' }, 400);
  }

  try {
    const body = await c.req.json();

    if (!body.name || !body.email || !body.status) {
      return c.json({ error: 'Name, email, and status are required' }, 400);
    }

    const result = await sql`
      UPDATE users
      SET name = ${body.name}, email = ${body.email}, status = ${body.status}
      WHERE id = ${userId}
      RETURNING id, name, email, status, created_at
    `;

    if (result.length === 0) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json(result[0]);
  } catch (error) {
    console.error('Error updating user:', error);
    return c.json({ error: 'Failed to update user' }, 500);
  }
});

// DELETE user
app.delete('/users/:id', async (c) => {
  if (!c.env.DATABASE_URL) {
    return c.json({ error: 'DATABASE_URL is not set' }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);
  const userId = parseInt(c.req.param('id'));

  if (isNaN(userId)) {
    return c.json({ error: 'Invalid user ID' }, 400);
  }

  try {
    const result = await sql`
      DELETE FROM users
      WHERE id = ${userId}
      RETURNING id
    `;

    if (result.length === 0) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    return c.json({ error: 'Failed to delete user' }, 500);
  }
});

// TRANSACTIONS ROUTES

// GET all transactions
app.get('/transactions', async (c) => {
  if (!c.env.DATABASE_URL) {
    return c.json({ error: 'DATABASE_URL is not set' }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);

  try {
    const result = await sql`
      SELECT 
        t.id,
        t.user_id,
        t.amount,
        t.created_at,
        u.name as user_name,
        u.email as user_email
      FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
      ORDER BY t.created_at DESC
    `;
    return c.json(result);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return c.json({ error: 'Failed to fetch transactions' }, 500);
  }
});

// GET single transaction
app.get('/transactions/:id', async (c) => {
  if (!c.env.DATABASE_URL) {
    return c.json({ error: 'DATABASE_URL is not set' }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);
  const transactionId = parseInt(c.req.param('id'));

  if (isNaN(transactionId)) {
    return c.json({ error: 'Invalid transaction ID' }, 400);
  }

  try {
    const result = await sql`
      SELECT 
        t.id,
        t.user_id,
        t.amount,
        t.created_at,
        u.name as user_name,
        u.email as user_email
      FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.id = ${transactionId}
    `;

    if (result.length === 0) {
      return c.json({ error: 'Transaction not found' }, 404);
    }

    return c.json(result[0]);
  } catch (error) {
    console.error('Error fetching transaction:', error);
    return c.json({ error: 'Failed to fetch transaction' }, 500);
  }
});

// GET transactions by user
app.get('/users/:id/transactions', async (c) => {
  if (!c.env.DATABASE_URL) {
    return c.json({ error: 'DATABASE_URL is not set' }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);
  const userId = parseInt(c.req.param('id'));

  if (isNaN(userId)) {
    return c.json({ error: 'Invalid user ID' }, 400);
  }

  try {
    const result = await sql`
      SELECT 
        t.id,
        t.user_id,
        t.amount,
        t.created_at,
        u.name as user_name,
        u.email as user_email
      FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.user_id = ${userId}
      ORDER BY t.created_at DESC
    `;

    return c.json(result);
  } catch (error) {
    console.error('Error fetching user transactions:', error);
    return c.json({ error: 'Failed to fetch user transactions' }, 500);
  }
});

// POST new transaction
app.post('/transactions', async (c) => {
  if (!c.env.DATABASE_URL) {
    return c.json({ error: 'DATABASE_URL is not set' }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);

  try {
    const body = await c.req.json();

    if (body.amount === undefined || body.amount === null) {
      return c.json({ error: 'Amount is required' }, 400);
    }

    const result = await sql`
      INSERT INTO transactions (user_id, amount, created_at)
      VALUES (${body.user_id || null}, ${body.amount}, CURRENT_TIMESTAMP)
      RETURNING id, user_id, amount, created_at
    `;

    return c.json(result[0], 201);
  } catch (error) {
    console.error('Error creating transaction:', error);
    if (error instanceof Error && 'code' in error && error.code === '23503') {
      return c.json({ error: 'Invalid user_id' }, 400);
    }
    return c.json({ error: 'Failed to create transaction' }, 500);
  }
});

// PUT update transaction
app.put('/transactions/:id', async (c) => {
  if (!c.env.DATABASE_URL) {
    return c.json({ error: 'DATABASE_URL is not set' }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);
  const transactionId = parseInt(c.req.param('id'));

  if (isNaN(transactionId)) {
    return c.json({ error: 'Invalid transaction ID' }, 400);
  }

  try {
    const body = await c.req.json();

    if (body.amount === undefined || body.amount === null) {
      return c.json({ error: 'Amount is required' }, 400);
    }

    const result = await sql`
      UPDATE transactions
      SET user_id = ${body.user_id || null}, amount = ${body.amount}
      WHERE id = ${transactionId}
      RETURNING id, user_id, amount, created_at
    `;

    if (result.length === 0) {
      return c.json({ error: 'Transaction not found' }, 404);
    }

    return c.json(result[0]);
  } catch (error) {
    console.error('Error updating transaction:', error);
    if (error instanceof Error && 'code' in error && error.code === '23503') {
      return c.json({ error: 'Invalid user_id' }, 400);
    }
    return c.json({ error: 'Failed to update transaction' }, 500);
  }
});

// DELETE transaction
app.delete('/transactions/:id', async (c) => {
  if (!c.env.DATABASE_URL) {
    return c.json({ error: 'DATABASE_URL is not set' }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);
  const transactionId = parseInt(c.req.param('id'));

  if (isNaN(transactionId)) {
    return c.json({ error: 'Invalid transaction ID' }, 400);
  }

  try {
    const result = await sql`
      DELETE FROM transactions
      WHERE id = ${transactionId}
      RETURNING id
    `;

    if (result.length === 0) {
      return c.json({ error: 'Transaction not found' }, 404);
    }

    return c.json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    return c.json({ error: 'Failed to delete transaction' }, 500);
  }
});

// Error handler
app.onError((e, c) => {
  console.error(e);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
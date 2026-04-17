const bcrypt = require('bcrypt');
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

console.log('Starting server...');

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '2804',
  database: 'poultry',
});

const dbQuery = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.query(sql, params, (error, results) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(results);
    });
  });

const normalizeEmail = value => String(value || '').trim().toLowerCase();

const ensureColumnExists = async (tableName, columnName, definition) => {
  const existingColumns = await dbQuery(
    `SHOW COLUMNS FROM ${tableName} LIKE ?`,
    [columnName]
  );

  if (existingColumns.length) {
    return;
  }

  await dbQuery(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  console.log(`${columnName} column added to ${tableName}`);
};

const schemaStatements = [
  {
    name: 'users',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        user_id INT PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        owner_user_id INT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_users_owner_user_id (owner_user_id),
        CONSTRAINT fk_users_owner_user
          FOREIGN KEY (owner_user_id) REFERENCES users(user_id)
          ON DELETE SET NULL
      )
    `,
  },
  {
    name: 'farms',
    sql: `
      CREATE TABLE IF NOT EXISTS farms (
        farm_id INT PRIMARY KEY,
        user_id INT NOT NULL,
        farm_name VARCHAR(255) NOT NULL,
        location VARCHAR(255) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        synced TINYINT(1) DEFAULT 0,
        INDEX idx_farms_user_id (user_id),
        CONSTRAINT fk_farms_user
          FOREIGN KEY (user_id) REFERENCES users(user_id)
          ON DELETE CASCADE
      )
    `,
  },
  {
    name: 'batches',
    sql: `
      CREATE TABLE IF NOT EXISTS batches (
        batch_id INT PRIMARY KEY,
        farm_id INT NOT NULL,
        start_date VARCHAR(50) NULL,
        breed VARCHAR(100) NULL,
        initial_chicks INT NULL,
        purchase_cost DECIMAL(12, 2) DEFAULT 0,
        status VARCHAR(50) NULL,
        deleted_at DATETIME NULL,
        synced TINYINT(1) DEFAULT 0,
        INDEX idx_batches_farm_id (farm_id),
        CONSTRAINT fk_batches_farm
          FOREIGN KEY (farm_id) REFERENCES farms(farm_id)
          ON DELETE CASCADE
      )
    `,
  },
  {
    name: 'feed_records',
    sql: `
      CREATE TABLE IF NOT EXISTS feed_records (
        feed_id INT PRIMARY KEY,
        batch_id INT NOT NULL,
        feed_type VARCHAR(100) NULL,
        feed_quantity DECIMAL(12, 2) NULL,
        feed_cost DECIMAL(12, 2) NULL,
        date_recorded VARCHAR(50) NULL,
        deleted_at DATETIME NULL,
        synced TINYINT(1) DEFAULT 0,
        INDEX idx_feed_records_batch_id (batch_id),
        CONSTRAINT fk_feed_records_batch
          FOREIGN KEY (batch_id) REFERENCES batches(batch_id)
          ON DELETE CASCADE
      )
    `,
  },
  {
    name: 'mortality_records',
    sql: `
      CREATE TABLE IF NOT EXISTS mortality_records (
        mortality_id INT PRIMARY KEY,
        batch_id INT NOT NULL,
        number_dead INT NULL,
        cause_of_death VARCHAR(255) NULL,
        date_recorded VARCHAR(50) NULL,
        deleted_at DATETIME NULL,
        synced TINYINT(1) DEFAULT 0,
        INDEX idx_mortality_records_batch_id (batch_id),
        CONSTRAINT fk_mortality_records_batch
          FOREIGN KEY (batch_id) REFERENCES batches(batch_id)
          ON DELETE CASCADE
      )
    `,
  },
  {
    name: 'vaccination_records',
    sql: `
      CREATE TABLE IF NOT EXISTS vaccination_records (
        vaccination_id INT PRIMARY KEY,
        batch_id INT NOT NULL,
        vaccine_name VARCHAR(255) NULL,
        vaccination_date VARCHAR(50) NULL,
        next_due_date VARCHAR(50) NULL,
        due_completed_at VARCHAR(50) NULL,
        notes TEXT NULL,
        deleted_at DATETIME NULL,
        synced TINYINT(1) DEFAULT 0,
        INDEX idx_vaccination_records_batch_id (batch_id),
        CONSTRAINT fk_vaccination_records_batch
          FOREIGN KEY (batch_id) REFERENCES batches(batch_id)
          ON DELETE CASCADE
      )
    `,
  },
  {
    name: 'expenses',
    sql: `
      CREATE TABLE IF NOT EXISTS expenses (
        expense_id INT PRIMARY KEY,
        farm_id INT NULL,
        batch_id INT NULL,
        description VARCHAR(255) NULL,
        amount DECIMAL(12, 2) NULL,
        expense_date VARCHAR(50) NULL,
        expense_scope VARCHAR(20) DEFAULT 'batch',
        feed_type VARCHAR(100) NULL,
        quantity_bought DECIMAL(12, 2) NULL,
        deleted_at DATETIME NULL,
        synced TINYINT(1) DEFAULT 0,
        INDEX idx_expenses_farm_id (farm_id),
        INDEX idx_expenses_batch_id (batch_id),
        CONSTRAINT fk_expenses_farm
          FOREIGN KEY (farm_id) REFERENCES farms(farm_id)
          ON DELETE CASCADE,
        CONSTRAINT fk_expenses_batch
          FOREIGN KEY (batch_id) REFERENCES batches(batch_id)
          ON DELETE CASCADE
      )
    `,
  },
  {
    name: 'sales',
    sql: `
      CREATE TABLE IF NOT EXISTS sales (
        sale_id INT PRIMARY KEY,
        batch_id INT NOT NULL,
        birds_sold INT NULL,
        price_per_bird DECIMAL(12, 2) NULL,
        total_revenue DECIMAL(12, 2) NULL,
        sale_date VARCHAR(50) NULL,
        deleted_at DATETIME NULL,
        synced TINYINT(1) DEFAULT 0,
        INDEX idx_sales_batch_id (batch_id),
        CONSTRAINT fk_sales_batch
          FOREIGN KEY (batch_id) REFERENCES batches(batch_id)
          ON DELETE CASCADE
      )
    `,
  },
];

const backupConfigs = {
  users: {
    tableName: 'users',
    idColumn: 'user_id',
    columns: ['user_id', 'first_name', 'last_name', 'email', 'password', 'role', 'owner_user_id', 'created_at'],
    transformRecord: async record => ({
      user_id: record.user_id,
      first_name: record.first_name,
      last_name: record.last_name,
      email: normalizeEmail(record.email),
      password: await bcrypt.hash(String(record.password || ''), 10),
      role: record.role,
      owner_user_id: record.owner_user_id ?? null,
      created_at: record.created_at ?? null,
    }),
  },
  farms: {
    tableName: 'farms',
    idColumn: 'farm_id',
    columns: ['farm_id', 'user_id', 'farm_name', 'location', 'created_at', 'deleted_at'],
  },
  batches: {
    tableName: 'batches',
    idColumn: 'batch_id',
    columns: ['batch_id', 'farm_id', 'start_date', 'breed', 'initial_chicks', 'purchase_cost', 'status', 'deleted_at'],
  },
  'feed-records': {
    tableName: 'feed_records',
    idColumn: 'feed_id',
    columns: ['feed_id', 'batch_id', 'feed_type', 'feed_quantity', 'feed_cost', 'date_recorded', 'deleted_at'],
  },
  'mortality-records': {
    tableName: 'mortality_records',
    idColumn: 'mortality_id',
    columns: ['mortality_id', 'batch_id', 'number_dead', 'cause_of_death', 'date_recorded', 'deleted_at'],
  },
  'vaccination-records': {
    tableName: 'vaccination_records',
    idColumn: 'vaccination_id',
    columns: ['vaccination_id', 'batch_id', 'vaccine_name', 'vaccination_date', 'next_due_date', 'due_completed_at', 'notes', 'deleted_at'],
  },
  expenses: {
    tableName: 'expenses',
    idColumn: 'expense_id',
    columns: ['expense_id', 'farm_id', 'batch_id', 'description', 'amount', 'expense_date', 'expense_scope', 'feed_type', 'quantity_bought', 'deleted_at'],
  },
  sales: {
    tableName: 'sales',
    idColumn: 'sale_id',
    columns: ['sale_id', 'batch_id', 'birds_sold', 'price_per_bird', 'total_revenue', 'sale_date', 'deleted_at'],
  },
};

const initializeSchema = async () => {
  for (const { name, sql } of schemaStatements) {
    try {
      await dbQuery(sql);
      console.log(`${name} table is ready`);
    } catch (error) {
      console.log(`Failed to create ${name} table:`, error);
      throw error;
    }
  }

  const softDeleteTables = [
    'farms',
    'batches',
    'feed_records',
    'mortality_records',
    'vaccination_records',
    'expenses',
    'sales',
  ];

  for (const tableName of softDeleteTables) {
    await ensureColumnExists(tableName, 'deleted_at', 'DATETIME NULL');
  }

  await ensureColumnExists('expenses', 'farm_id', 'INT NULL');
  await ensureColumnExists('expenses', 'expense_scope', `VARCHAR(20) DEFAULT 'batch'`);
  await ensureColumnExists('expenses', 'feed_type', 'VARCHAR(100) NULL');
  await ensureColumnExists('expenses', 'quantity_bought', 'DECIMAL(12, 2) NULL');
  await ensureColumnExists('vaccination_records', 'due_completed_at', 'VARCHAR(50) NULL');
  await dbQuery('ALTER TABLE expenses MODIFY COLUMN batch_id INT NULL');
};

const getNextPrimaryKey = async (tableName, idColumn) => {
  const rows = await dbQuery(
    `SELECT COALESCE(MAX(${idColumn}), 0) + 1 AS nextId FROM ${tableName}`
  );

  return rows[0]?.nextId ?? 1;
};

const getAccessibleOwnerId = user =>
  user.role === 'owner' ? user.user_id : user.owner_user_id;

const getBootstrapPayloadForUser = async user => {
  const ownerId = getAccessibleOwnerId(user);

  if (!ownerId) {
    return {
      users: [user],
      farms: [],
      batches: [],
      feed_records: [],
      mortality_records: [],
      vaccination_records: [],
      expenses: [],
      sales: [],
    };
  }

  const ownerRows = await dbQuery(
    `SELECT user_id, first_name, last_name, email, role, owner_user_id, created_at
     FROM users
     WHERE user_id = ?
     LIMIT 1`,
    [ownerId]
  );

  const users = ownerId === user.user_id
    ? [user]
    : [ownerRows[0], user].filter(Boolean);

  const farms = await dbQuery(
    `SELECT farm_id, user_id, farm_name, location, created_at, deleted_at
     FROM farms
     WHERE user_id = ?
       AND deleted_at IS NULL
     ORDER BY farm_id`,
    [ownerId]
  );

  const farmIds = farms.map(item => item.farm_id);
  const farmExpenses = farmIds.length
    ? await dbQuery(
      `SELECT expense_id, farm_id, batch_id, description, amount, expense_date, expense_scope, feed_type, quantity_bought, deleted_at
       FROM expenses
       WHERE farm_id IN (${farmIds.map(() => '?').join(', ')})
         AND deleted_at IS NULL
       ORDER BY expense_id`,
      farmIds
    )
    : [];

  if (!farmIds.length) {
    return {
      users,
      farms,
      batches: [],
      feed_records: [],
      mortality_records: [],
      vaccination_records: [],
      expenses: farmExpenses,
      sales: [],
    };
  }

  const farmPlaceholders = farmIds.map(() => '?').join(', ');
  const batches = await dbQuery(
    `SELECT batch_id, farm_id, start_date, breed, initial_chicks, purchase_cost, status, deleted_at
     FROM batches
     WHERE farm_id IN (${farmPlaceholders})
       AND deleted_at IS NULL
     ORDER BY batch_id`,
    farmIds
  );

  const batchIds = batches.map(item => item.batch_id);

  if (!batchIds.length) {
    return {
      users,
      farms,
      batches,
      feed_records: [],
      mortality_records: [],
      vaccination_records: [],
      expenses: farmExpenses,
      sales: [],
    };
  }

  const batchPlaceholders = batchIds.map(() => '?').join(', ');
  const [
    feedRecords,
    mortalityRecords,
    vaccinationRecords,
    expenses,
    sales,
  ] = await Promise.all([
    dbQuery(
      `SELECT feed_id, batch_id, feed_type, feed_quantity, feed_cost, date_recorded, deleted_at
       FROM feed_records
       WHERE batch_id IN (${batchPlaceholders})
         AND deleted_at IS NULL
       ORDER BY feed_id`,
      batchIds
    ),
    dbQuery(
      `SELECT mortality_id, batch_id, number_dead, cause_of_death, date_recorded, deleted_at
       FROM mortality_records
       WHERE batch_id IN (${batchPlaceholders})
         AND deleted_at IS NULL
       ORDER BY mortality_id`,
      batchIds
    ),
    dbQuery(
      `SELECT vaccination_id, batch_id, vaccine_name, vaccination_date, next_due_date, due_completed_at, notes, deleted_at
       FROM vaccination_records
       WHERE batch_id IN (${batchPlaceholders})
         AND deleted_at IS NULL
       ORDER BY vaccination_id`,
      batchIds
    ),
    dbQuery(
      `SELECT expense_id, farm_id, batch_id, description, amount, expense_date, expense_scope, feed_type, quantity_bought, deleted_at
       FROM expenses
       WHERE (
         batch_id IN (${batchPlaceholders})
         OR farm_id IN (${farmPlaceholders})
       )
         AND deleted_at IS NULL
       ORDER BY expense_id`,
      [...batchIds, ...farmIds]
    ),
    dbQuery(
      `SELECT sale_id, batch_id, birds_sold, price_per_bird, total_revenue, sale_date, deleted_at
       FROM sales
       WHERE batch_id IN (${batchPlaceholders})
         AND deleted_at IS NULL
       ORDER BY sale_id`,
      batchIds
    ),
  ]);

  return {
    users,
    farms,
    batches,
    feed_records: feedRecords,
    mortality_records: mortalityRecords,
    vaccination_records: vaccinationRecords,
    expenses,
    sales,
  };
};

const upsertRecords = config => {
  return async (req, res) => {
    const records = Array.isArray(req.body?.records) ? req.body.records : [];

    if (!records.length) {
      return res.send({ success: true, syncedIds: [] });
    }

    try {
      const preparedRecords = [];

      for (const inputRecord of records) {
        const transformedRecord = config.transformRecord
          ? await config.transformRecord(inputRecord)
          : inputRecord;

        preparedRecords.push(transformedRecord);
      }

      const updateColumns = config.columns.filter(column => column !== config.idColumn);
      const placeholders = config.columns.map(() => '?').join(', ');
      const sql = `
        INSERT INTO ${config.tableName} (${config.columns.join(', ')})
        VALUES (${placeholders})
        ON DUPLICATE KEY UPDATE
        ${updateColumns.map(column => `${column} = VALUES(${column})`).join(', ')}
      `;

      const syncedIds = [];
      const skipped = [];

      for (const record of preparedRecords) {
        try {
          await dbQuery(
            sql,
            config.columns.map(column => (record[column] ?? null))
          );
          syncedIds.push(record[config.idColumn]);
        } catch (error) {
          console.log(`Skipped ${config.tableName} record ${record[config.idColumn]}:`, error.message);
          skipped.push({
            id: record[config.idColumn],
            reason: error.code || 'UNKNOWN_ERROR',
          });
        }
      }

      res.send({
        success: true,
        syncedIds,
        skipped,
      });
    } catch (error) {
      console.log(`Backup error for ${config.tableName}:`, error);
      res.status(500).send({ success: false, message: `Backup failed for ${config.tableName}` });
    }
  };
};

app.get('/health', (_req, res) => {
  res.send({ success: true, status: 'ok' });
});

app.post('/users', async (req, res) => {
  console.log('Incoming request:', req.body);

  const { first_name, last_name, email, password, role, owner_user_id = null } = req.body;

  if (!first_name || !last_name || !email || !password || !role) {
    return res.status(400).send({ success: false, message: 'Missing required fields' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = req.body.user_id ?? await getNextPrimaryKey('users', 'user_id');

    const sql = `
      INSERT INTO users (user_id, first_name, last_name, email, password, role, owner_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      first_name = VALUES(first_name),
      last_name = VALUES(last_name),
      email = VALUES(email),
      password = VALUES(password),
      role = VALUES(role),
      owner_user_id = VALUES(owner_user_id)
    `;

    db.query(
      sql,
      [userId, first_name, last_name, normalizeEmail(email), hashedPassword, role, owner_user_id],
      err => {
        if (err) {
          console.log('Insert error:', err);

          if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).send({ success: false, message: 'Email already exists' });
          }

          return res.status(500).send({ success: false, message: 'Failed to save user' });
        }

        console.log('User saved with hashed password');
        res.send({ success: true, user_id: userId });
      }
    );
  } catch (error) {
    console.log('Hashing error:', error);
    res.status(500).send({ success: false, message: 'Error hashing password' });
  }
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).send({ success: false, message: 'Email and password are required' });
  }

  console.log('Login attempt for:', email);

  const sql = 'SELECT * FROM users WHERE email = ? LIMIT 1';

  db.query(sql, [normalizeEmail(email)], async (err, results) => {
    if (err) {
      console.log('DB error:', err);
      return res.status(500).send({ success: false, message: 'Server error' });
    }

    if (!results.length) {
      console.log('User not found');
      return res.status(401).send({ success: false, message: 'User not found' });
    }

    const user = results[0];

    try {
      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return res.status(401).send({ success: false, message: 'Invalid password' });
      }

      console.log('Login successful');
      res.send({
        success: true,
        user: {
          user_id: user.user_id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          role: user.role,
          owner_user_id: user.owner_user_id,
        },
      });
    } catch (error) {
      console.log('Password compare error:', error);
      res.status(500).send({ success: false, message: 'Server error' });
    }
  });
});

app.post('/bootstrap/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).send({ success: false, message: 'Email and password are required' });
  }

  try {
    const results = await dbQuery(
      'SELECT * FROM users WHERE email = ? LIMIT 1',
      [normalizeEmail(email)]
    );

    if (!results.length) {
      return res.status(401).send({ success: false, message: 'User not found' });
    }

    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).send({ success: false, message: 'Invalid password' });
    }

    const bootstrapUser = {
      user_id: user.user_id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role: user.role,
      owner_user_id: user.owner_user_id,
      created_at: user.created_at,
    };

    const bootstrapData = await getBootstrapPayloadForUser(bootstrapUser);

    res.send({
      success: true,
      authenticatedUser: {
        ...bootstrapUser,
        password,
      },
      bootstrapData,
    });
  } catch (error) {
    console.log('Bootstrap login error:', error);
    res.status(500).send({ success: false, message: 'Bootstrap failed' });
  }
});

app.post('/backup/users', upsertRecords(backupConfigs.users));
app.post('/backup/farms', upsertRecords(backupConfigs.farms));
app.post('/backup/batches', upsertRecords(backupConfigs.batches));
app.post('/backup/feed-records', upsertRecords(backupConfigs['feed-records']));
app.post('/backup/mortality-records', upsertRecords(backupConfigs['mortality-records']));
app.post('/backup/vaccination-records', upsertRecords(backupConfigs['vaccination-records']));
app.post('/backup/expenses', upsertRecords(backupConfigs.expenses));
app.post('/backup/sales', upsertRecords(backupConfigs.sales));

db.connect(async err => {
  if (err) {
    console.log('DB connection error:', err);
    return;
  }

  console.log('MySQL connected');

  try {
    await initializeSchema();
  } catch (error) {
    console.log('Schema initialization stopped:', error);
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});

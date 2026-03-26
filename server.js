const bcrypt = require('bcrypt');
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

console.log("Starting server..."); // 👈 ADD THIS

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '2804', 
  database: 'poultry'
});

db.connect(err => {
  if (err) {
    console.log("❌ DB ERROR:", err);
    return;
  }
  console.log('✅ MySQL Connected');
});

app.post('/users', async (req, res) => {
  console.log("📥 Incoming request:", req.body);

  const { first_name, last_name, email, password, role } = req.body;

  try {
    // 🔐 Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = `
      INSERT INTO users (first_name, last_name, email, password, role)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.query(
      sql,
      [first_name, last_name, email, hashedPassword, role],
      (err, result) => {
        if (err) {
          console.log("❌ Insert error:", err);
          return res.status(500).send(err);
        }

        console.log("✅ User saved with hashed password");
        res.send({ success: true });
      }
    );

  } catch (error) {
    console.log("❌ Hashing error:", error);
    res.status(500).send("Error hashing password");
  }
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;

  console.log("🔐 Login attempt:");
  console.log("Entered email:", email);
  console.log("Entered password:", password);
  console.log("User synced:", email);

  const sql = "SELECT * FROM users WHERE email = ?";

  db.query(sql, [email], async (err, results) => {
    if (err) {
      console.log("❌ DB error:", err);
      return res.status(500).send("Server error");
    }

    console.log("🧾 DB results:", results);

    if (results.length === 0) {
      console.log("❌ User not found");
      return res.status(401).send("User not found");
    }

    const user = results[0];

    console.log("🗄 Stored hash:", user.password);

    const isMatch = await bcrypt.compare(password, user.password);

    console.log("✅ Match result:", isMatch);

    if (!isMatch) {
      return res.status(401).send("Invalid password");
    }

    console.log("✅ Login successful");

    res.send({ success: true });
  });
});

app.listen(3000, () => {
  console.log('🚀 Server running on port 3000');
});
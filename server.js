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

app.post('/users', (req, res) => {
  console.log("📥 Incoming request:", req.body);

  const { first_name, last_name, email, password, role } = req.body;

  const sql = `
    INSERT INTO users (first_name, last_name, email, password, role)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(sql, [first_name, last_name, email, password, role], (err, result) => {
    if (err) {
      console.log("❌ Insert error:", err);
      return res.status(500).send(err);
    }
    console.log("✅ User saved to MySQL");
    res.send({ success: true });
  });
});

app.listen(3000, () => {
  console.log('🚀 Server running on port 3000');
});
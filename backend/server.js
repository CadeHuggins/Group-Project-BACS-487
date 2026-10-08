
const express = require("express");
const pool = require("./db");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const argon2 = require("argon2");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(session({
  store: new PgSession({
    pool: pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }),
  name: "application_tracker.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, // Local HTTP development only
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24
  }
}));

app.get("/api/test", (req, res) => {
  res.json({
    message: "Backend is working!"
  });
});

app.get("/api/database", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT current_database() AS database"
    );

    res.json({
      message: "PostgreSQL connected!",
      database: result.rows[0].database
    });

  } catch (error) {
    console.error("Database error:", error.message);

    res.status(500).json({
      error: "Database connection failed"
    });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validate input
    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      !name.trim() ||
      !email.trim()
    ) {
      return res.status(400).json({
        error: "Name, email, and password are required"
      });
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (
      cleanName.length > 100 ||
      cleanEmail.length > 255 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
    ) {
      return res.status(400).json({
        error: "Invalid name or email"
      });
    }

    if (password.length < 12 || password.length > 128) {
      return res.status(400).json({
        error: "Password must be 12–128 characters"
      });
    }

    // Hash the password
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id
    });

    // Save student to PostgreSQL
    const result = await pool.query(
      `INSERT INTO students
       (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email`,
      [cleanName, cleanEmail, passwordHash]
    );

    res.status(201).json({
      message: "Student registered successfully",
      student: result.rows[0]
    });

  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Email already registered"
      });
    }

    console.error("Registration error:", error.message);

    res.status(500).json({
      error: "Registration failed"
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required"
      });
    }

    const result = await pool.query(
      "SELECT id, name, email, password_hash FROM students WHERE email = $1",
      [email.trim().toLowerCase()]
    );

    const student = result.rows[0];

    if (!student || !(await argon2.verify(student.password_hash, password))) {
      return res.status(401).json({
        error: "Invalid email or password"
      });
    }

    req.session.regenerate((error) => {
      if (error) {
        return res.status(500).json({ error: "Login failed" });
      }

      req.session.studentId = student.id;

      req.session.save((error) => {
        if (error) {
          return res.status(500).json({ error: "Login failed" });
        }

        res.json({
          message: "Login successful",
          student: {
            id: student.id,
            name: student.name,
            email: student.email
          }
        });
      });
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.session.studentId) {
    return res.status(401).json({
      error: "Not logged in"
    });
  }

  try {
    const result = await pool.query(
      "SELECT id, name, email FROM students WHERE id = $1",
      [req.session.studentId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Student not found"
      });
    }

    res.json({
      student: result.rows[0]
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Could not retrieve student"
    });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error("Logout error:", error);
      return res.status(500).json({
        error: "Logout failed"
      });
    }

    res.clearCookie("application_tracker.sid");

    res.json({
      message: "Logged out successfully"
    });
  });
});

function requireLogin(req, res, next) {
  if (!req.session.studentId) {
    return res.status(401).json({
      error: "You must be logged in"
    });
  }

  next();
}

app.post("/api/applications", requireLogin, async (req, res) => {
  try {
    const { company, position, status, deadline } = req.body || {};

    if (
      typeof company !== "string" ||
      typeof position !== "string" ||
      !company.trim() ||
      !position.trim()
    ) {
      return res.status(400).json({
        error: "Company and position are required"
      });
    }

    const allowedStatuses = [
      "Saved",
      "Applied",
      "Interview",
      "Offer",
      "Rejected"
    ];

    const applicationStatus = status ?? "Saved";

    if (!allowedStatuses.includes(applicationStatus)) {
      return res.status(400).json({
        error: "Invalid application status"
      });
    }

    if (company.trim().length > 150 || position.trim().length > 150) {
      return res.status(400).json({
        error: "Company and position must be 150 characters or fewer"
      });
    }

    if (
      deadline != null &&
      (typeof deadline !== "string" ||
       !/^\d{4}-\d{2}-\d{2}$/.test(deadline) ||
       Number.isNaN(Date.parse(deadline)) ||
       new Date(deadline).toISOString().slice(0, 10) !== deadline)
    ) {
      return res.status(400).json({
        error: "Deadline must be a valid date in YYYY-MM-DD format"
      });
    }

    const result = await pool.query(
      `INSERT INTO applications
       (student_id, company, position, status, deadline)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        req.session.studentId,
        company.trim(),
        position.trim(),
        applicationStatus,
        deadline || null
      ]
    );

    res.status(201).json({
      message: "Application added successfully",
      application: result.rows[0]
    });

  } catch (error) {
    console.error("Add application error:", error);
    res.status(500).json({
      error: "Failed to add application"
    });
  }
});

app.get("/api/applications", requireLogin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, company, position, status, deadline, created_at
       FROM applications
       WHERE student_id = $1
       ORDER BY created_at DESC, id DESC`,
      [req.session.studentId]
    );

    res.json({
      message: "Applications retrieved successfully",
      applications: result.rows
    });

  } catch (error) {
    console.error("Get applications error:", error);

    res.status(500).json({
      error: "Failed to retrieve applications"
    });
  }
});


app.put("/api/applications/:id", requireLogin, async (req, res) => {
  try {
    const { company, position, status, deadline } = req.body || {};
    const applicationId = req.params.id;

    if (!/^[1-9]\d*$/.test(applicationId)) {
      return res.status(400).json({
        error: "Invalid application ID"
      });
    }

    if (
      typeof company !== "string" ||
      typeof position !== "string" ||
      !company.trim() ||
      !position.trim() ||
      company.trim().length > 150 ||
      position.trim().length > 150
    ) {
      return res.status(400).json({
        error: "Valid company and position are required (maximum 150 characters)"
      });
    }

    const allowedStatuses = [
      "Saved", "Applied", "Interview", "Offer", "Rejected"
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid application status"
      });
    }

    if (
      deadline != null &&
      (
        typeof deadline !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(deadline) ||
        Number.isNaN(Date.parse(deadline)) ||
        new Date(deadline).toISOString().slice(0, 10) !== deadline
      )
    ) {
      return res.status(400).json({
        error: "Deadline must be a valid YYYY-MM-DD date"
      });
    }

    const result = await pool.query(
      `UPDATE applications
       SET company = $1,
           position = $2,
           status = $3,
           deadline = $4
       WHERE id = $5 AND student_id = $6
       RETURNING *`,
      [
        company.trim(),
        position.trim(),
        status,
        deadline || null,
        applicationId,
        req.session.studentId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Application not found"
      });
    }

    res.json({
      message: "Application updated successfully",
      application: result.rows[0]
    });

  } catch (error) {
    console.error("Update application error:", error);
    res.status(500).json({
      error: "Failed to update application"
    });
  }
});

// Start the server
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Backend running on port ${PORT}`);
});

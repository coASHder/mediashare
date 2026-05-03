const express    = require('express');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MongoDB connection ────────────────────────────────────────────────────────
// Change this URI if you are using MongoDB Atlas (cloud) instead of local.
// Atlas URI looks like:
//   mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/mediashare
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME   = 'mediashare';

let imagesCollection; // set after connection
let usersCollection;
let sessionsCollection;

async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  imagesCollection = db.collection('images');
  usersCollection = db.collection('users');
  sessionsCollection = db.collection('sessions');
  await usersCollection.createIndex({ email: 1 }, { unique: true });
  await sessionsCollection.createIndex({ token: 1 }, { unique: true });
  await sessionsCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
  await usersCollection.updateMany({ email: { $ne: 'ash@gmail.com' }, role: { $exists: false } }, { $set: { role: 'standard' } });
  await usersCollection.updateOne({ email: 'ash@gmail.com' }, { $set: { role: 'admin' } });
  console.log(`✅ Connected to MongoDB — database: "${DB_NAME}"`);
}

// ── File upload setup (multer) ────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:    (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// ── Page Routes ───────────────────────────────────────────────────────────────
app.get('/',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/upload',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'upload.html')));
app.get('/login',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/signup',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/image/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'detail.html')));

app.post('/api/signup', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const user = {
      name,
      email,
      role: email === 'ash@gmail.com' ? 'admin' : 'standard',
      password: hashPassword(password),
      createdAt: new Date()
    };
    const result = await usersCollection.insertOne(user);
    const token = await createSession(result.insertedId);
    res.json({ success: true, token, user: publicUser({ ...user, _id: result.insertedId }) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'An account with this email already exists' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await usersCollection.findOne({ email });

    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = await createSession(user._id);
    res.json({ success: true, token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/me', async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (token) await sessionsCollection.deleteOne({ token });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: GET all images ───────────────────────────────────────────────────────
app.get('/api/images', async (req, res) => {
  try {
    const images = await imagesCollection.find().sort({ createdAt: -1 }).toArray();
    res.json(images.map(normalise));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: GET single image ─────────────────────────────────────────────────────
app.get('/api/images/:id', async (req, res) => {
  try {
    const image = await imagesCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!image) return res.status(404).json({ error: 'Image not found' });
    res.json(normalise(image));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: POST upload image ────────────────────────────────────────────────────
app.post('/api/upload', requireUser, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });
  try {
    const { title, location, datetime, genre, description } = req.body;
    const doc = {
      title,
      location:    location    || '',
      datetime:    datetime    || '',
      genre:       genre       || '',
      description: description || '',
      filepath:    '/uploads/' + req.file.filename,
      createdAt:   new Date(),
      userId:      req.user._id,
      userName:    req.user.name
    };
    const result = await imagesCollection.insertOne(doc);
    res.json({ success: true, id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: DELETE image ─────────────────────────────────────────────────────────
// Admin only: update image metadata, never the uploaded file.
app.put('/api/images/:id', requireAdmin, async (req, res) => {
  try {
    const id = new ObjectId(req.params.id);
    const { title, location, datetime, genre, description } = req.body;

    if (!String(title || '').trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const updates = {
      title: String(title).trim(),
      location: String(location || '').trim(),
      datetime: String(datetime || '').trim(),
      genre: String(genre || '').trim(),
      description: String(description || '').trim(),
      updatedAt: new Date()
    };

    const result = await imagesCollection.findOneAndUpdate(
      { _id: id },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ error: 'Image not found' });
    res.json({ success: true, image: normalise(result) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/images/:id', requireAdmin, async (req, res) => {
  try {
    const image = await imagesCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!image) return res.status(404).json({ error: 'Image not found' });

    const filePath = path.join(__dirname, image.filepath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await imagesCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: make MongoDB docs frontend-friendly ───────────────────────────────
function normalise(doc) {
  return {
    id:          doc._id.toString(),
    title:       doc.title,
    location:    doc.location,
    datetime:    doc.datetime,
    genre:       doc.genre,
    description: doc.description,
    filepath:    doc.filepath,
    createdAt:   doc.createdAt,
    updatedAt:   doc.updatedAt,
    userName:    doc.userName
  };
}

// ── Start server ──────────────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, originalHash] = String(stored || '').split(':');
  if (!salt || !originalHash) return false;
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(originalHash, 'hex'), Buffer.from(hash, 'hex'));
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await sessionsCollection.insertOne({ token, userId, createdAt: new Date() });
  return token;
}

function getBearerToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

async function getUserFromRequest(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  const session = await sessionsCollection.findOne({ token });
  if (!session) return null;
  return usersCollection.findOne({ _id: session.userId });
}

async function requireUser(req, res, next) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Please log in first' });
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Please log in first' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Only admins can delete photos' });
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role || (user.email === 'ash@gmail.com' ? 'admin' : 'standard')
  };
}

connectDB().then(() => {
  startServer(Number(PORT));
  /*
  app.listen(PORT, () => {
    console.log(`\n🚀 Media Share is running!`);
    console.log(`   Open http://localhost:${PORT} in your browser\n`);
  });
  */
}).catch(err => {
  console.error('❌ Failed to connect to MongoDB:', err.message);
  console.error('   Make sure MongoDB is running: mongod --dbpath ./data');
  process.exit(1);
});

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`\nMedia Share is running!`);
    console.log(`   Open http://localhost:${port} in your browser\n`);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE' && !process.env.PORT) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is already in use. Trying ${nextPort}...`);
      startServer(nextPort);
      return;
    }
    throw err;
  });
}

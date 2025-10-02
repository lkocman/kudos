/*
Kudos - openSUSE recognition service
Run: node kudos_server.js
*/

// ES Module syntax:
import express from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import cors from 'cors';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';

// For __dirname in ES module:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));


// Placeholder auth: X-User header
function requireUser(req, res, next) {
  const user = req.get('X-User') || req.body.actor || req.query.user;
  if (!user) return res.status(401).json({ error: 'Missing X-User header (placeholder auth).' });
  req.user = user;
  next();
}

const DB_FILE = path.join(__dirname, 'db.json');
const adapter = new JSONFile(DB_FILE);
const db = new Low(adapter, { users: {}, achievementTypes: {}, kudos: [] }); // provide default data

await db.read();
db.data ||= { users: {}, achievementTypes: {}, kudos: [] };
await db.write();

// Ensure user exists in DB
function ensureUser(userId) {
  if (!db.data.users[userId]) {
    db.data.users[userId] = { id: userId, displayName: userId, createdAt: Date.now() };
  }
}

async function initDb() {
  await db.read();
  db.data ||= {};
  db.data.users ||= {};
  db.data.achievementTypes ||= {};
  db.data.kudos ||= [];

  const builtin = [
    { id:'first-kudos', title:'First Kudos', description:'Give your first recognition', icon:'✨', graphic:'/img/default_recognition.png' },
    { id:'recognize-10', title:'Social Butterfly', description:'Recognized 10 peers', icon:'💌', graphic:'/img/default_recognition.png' },
    { id:'recognize-100', title:'Community Leader', description:'Recognized 100 peers', icon:'🏆', graphic:'/img/default_recognition.png' },
    { id:'visited-site', title:'Visitor', description:'Visited the Kudos site', icon:'👀', graphic:'/img/default_recognition.png' },
  ];

  for (const a of builtin) {
    db.data.achievementTypes[a.id] = db.data.achievementTypes[a.id] || a;
  }

  await db.write();
}

initDb().catch(err => {
  console.error('DB init failed', err);
  process.exit(1);
});

// APIs

// Index page - feed
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// feed of recent kudos
app.get('/api/feed', async (req, res) => {
  await db.read();
  const sorted = [...db.data.kudos].sort((a,b)=>b.createdAt-a.createdAt);
  res.json(sorted.slice(0,200));
});

// user's kudos - received and given
app.get('/api/kudos/:id', async (req, res) => {
  await db.read();
  const k = db.data.kudos.find(x => x.id === req.params.id);
  if(!k) return res.status(404).json({ error: 'Kudos not found' });

  const typeInfo = db.data.achievementTypes[k.type];
  const graphic = typeInfo?.graphic || '/img/default_recognition.png';

  res.json({ ...k, graphic });
});

// all achievements
app.get('/api/achievement-types', async (req,res)=>{
  await db.read();
  res.json(Object.values(db.data.achievementTypes));
});

// Individual kudos page (permalink view)
app.get('/r/:id', async (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kudos_view.html'));
});

// API to get single kudos
app.get('/api/kudos/:id', async (req, res) => {
  await db.read();
  const k = db.data.kudos.find(x => x.id === req.params.id);
  if(!k) return res.status(404).json({ error: 'Kudos not found' });
  res.json(k);
});

// create achievement type
app.post('/api/achievement-types', requireUser, async (req,res)=>{
  const { id, title, description, icon } = req.body;
  if (!id || !title) return res.status(400).json({ error: 'id and title required' });
  await db.read();
  db.data.achievementTypes[id] = { id, title, description: description||'', icon: icon||'🏅' };
  await db.write();
  res.status(201).json(db.data.achievementTypes[id]);
});

// delete achievement type
app.delete('/api/achievement-types/:id', requireUser, async (req,res)=>{
  await db.read();
  delete db.data.achievementTypes[req.params.id];
  await db.write();
  res.json({ok:true});
});

// add kudos
app.post('/api/kudos', requireUser, async (req,res)=>{
  const actor = req.user;
  const { to, type, message, cc } = req.body;
  if (!to) return res.status(400).json({ error: 'Recipient required' });
  await db.read();
  const id = nanoid(10);
  ensureUser(actor);
  ensureUser(to);
  const kudos = { id, actor, to, type: type||'first-kudos', message: message||'', cc: Array.isArray(cc)?cc:(cc? [cc]:[]), likes:0, congrats:0, createdAt: Date.now() };
  db.data.kudos.push(kudos);
  await db.write();
  res.status(201).json(kudos);

  // TODO: send email notification
  console.log(`Notify ${to} that they received kudos from ${actor}`);
});

// like/congrats
app.post('/api/kudos/:id/like', requireUser, async (req,res)=>{
  await db.read();
  const k = db.data.kudos.find(x=>x.id===req.params.id);
  if(!k) return res.status(404).json({error:'Not found'});
  k.likes=(k.likes||0)+1;
  await db.write();
  res.json({likes:k.likes});
});

app.post('/api/kudos/:id/congrats', requireUser, async (req,res)=>{
  await db.read();
  const k=db.data.kudos.find(x=>x.id===req.params.id);
  if(!k) return res.status(404).json({error:'Not found'});
  k.congrats=(k.congrats||0)+1;
  await db.write();
  res.json({congrats:k.congrats});
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`Kudos server running on http://localhost:${PORT}`));


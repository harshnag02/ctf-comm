const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use('/client', express.static(path.join(__dirname, 'public/client')));
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));

// ---------- Config ----------
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
if (!process.env.ADMIN_PASS) {
  console.warn('[WARNING] ADMIN_PASS not set in environment. Using default "admin123". Set ADMIN_USER / ADMIN_PASS in your Render environment variables before the event.');
}

// ---------- In-memory state ----------
// users: username -> { passwordHash, label, id }
const users = {};
// messages: username -> [{ id, from: 'client'|'server', text, ts }]
const messages = {};
// tokens
const adminTokens = new Set();
const clientTokens = {}; // token -> username
// online tracking: username -> number of active sockets
const onlineCounts = {};
function markOnline(username) {
  onlineCounts[username] = (onlineCounts[username] || 0) + 1;
  io.to('admin-room').emit('admin:presence', { username, online: true });
}
function markOffline(username) {
  if (!onlineCounts[username]) return;
  onlineCounts[username] -= 1;
  if (onlineCounts[username] <= 0) {
    delete onlineCounts[username];
    io.to('admin-room').emit('admin:presence', { username, online: false });
    io.to('admin-room').emit('rtc:end', { username, kind: 'screen' });
    io.to('admin-room').emit('rtc:end', { username, kind: 'call' });
  }
}

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: 'Not authorized' });
  }
  next();
}

// ---------- Admin API ----------
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = newToken();
    adminTokens.add(token);
    return res.json({ token });
  }
  return res.status(401).json({ error: 'Invalid admin credentials' });
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { username, password, label } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  if (users[username]) {
    return res.status(409).json({ error: 'That username already exists' });
  }
  const passwordHash = bcrypt.hashSync(password, 8);
  users[username] = { passwordHash, label: label || username, id: crypto.randomUUID() };
  messages[username] = [];
  return res.json({ ok: true, username, label: users[username].label });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const list = Object.keys(users).map((username) => {
    const thread = messages[username] || [];
    const last = thread[thread.length - 1];
    return {
      username,
      label: users[username].label,
      online: !!onlineCounts[username],
      messageCount: thread.length,
      lastMessage: last ? last.text : null,
      lastTs: last ? last.ts : null,
    };
  });
  res.json(list);
});

app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
  const { username } = req.params;
  delete users[username];
  delete messages[username];
  res.json({ ok: true });
});

app.get('/api/admin/messages/:username', requireAdmin, (req, res) => {
  const { username } = req.params;
  if (!users[username]) return res.status(404).json({ error: 'Unknown user' });
  res.json(messages[username] || []);
});

app.post('/api/admin/reply', requireAdmin, (req, res) => {
  const { username, text } = req.body || {};
  if (!users[username]) return res.status(404).json({ error: 'Unknown user' });
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });

  const entry = { id: crypto.randomUUID(), from: 'server', text: text.trim(), ts: Date.now() };
  messages[username].push(entry);
  io.to(`user-${username}`).emit('message:reply', entry);
  io.to('admin-room').emit('admin:thread-updated', { username, entry });
  res.json({ ok: true, entry });
});

// ---------- Client API ----------
app.post('/api/client/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = users[username];
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = newToken();
  clientTokens[token] = username;
  res.json({ token, label: user.label });
});

// ---------- Sockets ----------
io.on('connection', (socket) => {
  let boundUsername = null;
  let isAdmin = false;

  socket.on('auth', ({ token, role }) => {
    if (role === 'admin') {
      if (adminTokens.has(token)) {
        isAdmin = true;
        socket.join('admin-room');
        socket.emit('auth:ok');
      } else {
        socket.emit('auth:fail');
      }
    } else {
      const username = clientTokens[token];
      if (username) {
        boundUsername = username;
        socket.join(`user-${username}`);
        markOnline(username);
        socket.emit('auth:ok');
      } else {
        socket.emit('auth:fail');
      }
    }
  });

  socket.on('message:send', ({ text }) => {
    if (!boundUsername || !text || !text.trim()) return;
    const entry = { id: crypto.randomUUID(), from: 'client', text: text.trim(), ts: Date.now() };
    messages[boundUsername].push(entry);
    io.to('admin-room').emit('admin:new-message', { username: boundUsername, entry });
  });

  // ---- Latency probe ----
  socket.on('ping:check', (clientTs, cb) => {
    if (typeof cb === 'function') cb(clientTs);
  });

  // ---- WebRTC signaling relay (screen share + video call) ----
  // kind: 'screen' | 'call'
  socket.on('rtc:request', ({ username, kind }) => {
    if (!isAdmin || !username) return;
    io.to(`user-${username}`).emit('rtc:request', { kind });
  });

  socket.on('rtc:response', ({ kind, accepted }) => {
    if (!boundUsername) return;
    io.to('admin-room').emit('rtc:response', { username: boundUsername, kind, accepted });
  });

  socket.on('rtc:offer', ({ username, kind, sdp }) => {
    if (isAdmin && username) {
      io.to(`user-${username}`).emit('rtc:offer', { kind, sdp, from: 'admin' });
    } else if (!isAdmin && boundUsername) {
      io.to('admin-room').emit('rtc:offer', { username: boundUsername, kind, sdp, from: 'client' });
    }
  });

  socket.on('rtc:answer', ({ username, kind, sdp }) => {
    if (isAdmin && username) {
      io.to(`user-${username}`).emit('rtc:answer', { kind, sdp, from: 'admin' });
    } else if (!isAdmin && boundUsername) {
      io.to('admin-room').emit('rtc:answer', { username: boundUsername, kind, sdp, from: 'client' });
    }
  });

  socket.on('rtc:ice', ({ username, kind, candidate }) => {
    if (isAdmin && username) {
      io.to(`user-${username}`).emit('rtc:ice', { kind, candidate, from: 'admin' });
    } else if (!isAdmin && boundUsername) {
      io.to('admin-room').emit('rtc:ice', { username: boundUsername, kind, candidate, from: 'client' });
    }
  });

  socket.on('rtc:end', ({ username, kind }) => {
    if (isAdmin && username) {
      io.to(`user-${username}`).emit('rtc:end', { kind });
    } else if (!isAdmin && boundUsername) {
      io.to('admin-room').emit('rtc:end', { username: boundUsername, kind });
    }
  });

  socket.on('disconnect', () => {
    if (boundUsername) {
      markOffline(boundUsername);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CTF comm server running on port ${PORT}`);
  console.log(`Admin dashboard:  /admin`);
  console.log(`Client terminal:  /client`);
});

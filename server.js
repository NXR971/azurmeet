/**
 * AzurMeet — serveur de chat vidéo aléatoire
 * - Connexion Google vérifiée côté serveur
 * - Matchmaking garçon <-> fille obligatoire + filtre pays
 * - 3 signalements (par des personnes différentes) = ban 1 heure
 * - Signaling WebRTC (la vidéo passe en direct entre les navigateurs)
 */
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { OAuth2Client } = require('google-auth-library');

const PORT = process.env.PORT || 3000;
// Mets ton Client ID Google ici ou dans la variable d'environnement GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '258817195246-ktg1h15s7qs3q82brvikq59gvck2ukh5.apps.googleusercontent.com';

const BAN_DURATION_MS = 60 * 60 * 1000;      // 1 heure
const REPORTS_TO_BAN = 3;                     // 3 avertissements
const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000; // signalements comptés sur 24h

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/config', (_req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID }));

// ---------- État en mémoire ----------
const peers = new Map();   // socket.id -> { userId, name, picture, gender, myCountry, wantCountry, partner, lastPartnerUserId }
const queue = [];          // socket.id en attente
const bans = new Map();    // userId -> timestamp de fin de ban
const reports = new Map(); // userId signalé -> Map(reporterUserId -> timestamp)

function isBanned(userId) {
  const until = bans.get(userId);
  if (!until) return false;
  if (Date.now() >= until) { bans.delete(userId); return false; }
  return true;
}
function banRemaining(userId) {
  return Math.max(0, (bans.get(userId) || 0) - Date.now());
}

function countryOk(a, b) {
  // a accepte le pays de b ?
  return a.wantCountry === 'ALL' || a.wantCountry === b.myCountry;
}

function compatible(a, b) {
  if (!a || !b) return false;
  if (a.userId === b.userId) return false;               // pas soi-même
  if (!a.gender || !b.gender) return false;
  if (a.gender === b.gender) return false;               // garçon <-> fille obligatoire
  if (!countryOk(a, b) || !countryOk(b, a)) return false; // filtre pays des deux côtés
  return true;
}

function removeFromQueue(socketId) {
  const i = queue.indexOf(socketId);
  if (i !== -1) queue.splice(i, 1);
}

function publicProfile(p) {
  return { name: p.name, picture: p.picture, gender: p.gender, country: p.myCountry };
}

function pair(idA, idB) {
  const a = peers.get(idA), b = peers.get(idB);
  if (!a || !b) return;
  a.partner = idB; b.partner = idA;
  a.lastPartnerUserId = b.userId; b.lastPartnerUserId = a.userId;
  removeFromQueue(idA); removeFromQueue(idB);
  // "initiator" = celui qui crée l'offre WebRTC
  io.to(idA).emit('matched', { partner: publicProfile(b), initiator: true });
  io.to(idB).emit('matched', { partner: publicProfile(a), initiator: false });
}

function unpair(socketId, notifyPartner = true) {
  const me = peers.get(socketId);
  if (!me || !me.partner) return;
  const partnerId = me.partner;
  me.partner = null;
  const partner = peers.get(partnerId);
  if (partner && partner.partner === socketId) {
    partner.partner = null;
    if (notifyPartner) io.to(partnerId).emit('partner-left');
  }
}

function tryMatch(socketId) {
  const me = peers.get(socketId);
  if (!me) return;

  // 1er passage : on évite de retomber direct sur la même personne
  let candidateId = queue.find((id) => {
    const other = peers.get(id);
    return compatible(me, other) && other.userId !== me.lastPartnerUserId;
  });
  // 2e passage : sinon on accepte quand même
  if (!candidateId) candidateId = queue.find((id) => compatible(me, peers.get(id)));

  if (candidateId) {
    pair(socketId, candidateId);
  } else {
    if (!queue.includes(socketId)) queue.push(socketId);
    io.to(socketId).emit('waiting');
  }
}

// ---------- Socket.io ----------
io.on('connection', (socket) => {
  let authed = false;

  // Connexion Google : le navigateur envoie le jeton, on le vérifie vraiment
  socket.on('auth', async ({ credential, accessToken }) => {
    try {
      let payload; if (accessToken) { const info = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token='+encodeURIComponent(accessToken)).then(r=>r.ok?r.json():null); if (!info || info.aud !== GOOGLE_CLIENT_ID) throw new Error('bad token'); payload = await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+accessToken}}).then(r=>r.ok?r.json():null); if(!payload||!payload.sub) throw new Error('no userinfo'); } else { const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload(); }
      const userId = payload.sub;

      if (isBanned(userId)) {
        socket.emit('banned', { remainingMs: banRemaining(userId) });
        return;
      }

      peers.set(socket.id, {
        userId,
        name: payload.given_name || payload.name || 'Utilisateur',
        picture: payload.picture || '',
        gender: null,
        myCountry: null,
        wantCountry: 'ALL',
        partner: null,
        lastPartnerUserId: null,
      });
      authed = true;
      socket.emit('auth-ok', { name: payload.given_name || payload.name, picture: payload.picture || '' });
    } catch (e) {
      socket.emit('auth-error', { message: 'Connexion Google invalide. Vérifie le Client ID.' });
    }
  });

  // Lancer / relancer une recherche
  socket.on('find', ({ gender, myCountry, wantCountry }) => {
    const me = peers.get(socket.id);
    if (!authed || !me) return;
    if (isBanned(me.userId)) {
      socket.emit('banned', { remainingMs: banRemaining(me.userId) });
      return;
    }
    if (gender !== 'boy' && gender !== 'girl') {
      socket.emit('error-msg', { message: 'Choisis garçon ou fille avant de commencer.' });
      return;
    }
    me.gender = gender;
    me.myCountry = String(myCountry || 'XX').toUpperCase().slice(0, 2);
    me.wantCountry = wantCountry === 'ALL' ? 'ALL' : String(wantCountry || 'ALL').toUpperCase().slice(0, 2);
    unpair(socket.id);
    tryMatch(socket.id);
  });

  // Passer à la personne suivante
  socket.on('next', () => {
    if (!authed) return;
    unpair(socket.id);
    tryMatch(socket.id);
  });

  // Arrêter
  socket.on('stop', () => {
    unpair(socket.id);
    removeFromQueue(socket.id);
  });

  // Relais WebRTC (offre / réponse / candidats ICE)
  socket.on('signal', (data) => {
    const me = peers.get(socket.id);
    if (me && me.partner) io.to(me.partner).emit('signal', data);
  });

  // Chat texte
  socket.on('chat', ({ text }) => {
    const me = peers.get(socket.id);
    if (!me || !me.partner) return;
    const clean = String(text || '').slice(0, 500);
    if (!clean.trim()) return;
    io.to(me.partner).emit('chat', { text: clean });
  });

  // Prévenir le partenaire quand on coupe/rallume sa caméra
  socket.on('cam-state', ({ on }) => {
    const me = peers.get(socket.id);
    if (me && me.partner) io.to(me.partner).emit('partner-cam', { on: !!on });
  });

  // Signalement : 3 signalements de personnes différentes = ban 1h
  socket.on('report', () => {
    const me = peers.get(socket.id);
    if (!me || !me.partner) return;
    const partner = peers.get(me.partner);
    if (!partner) return;

    const now = Date.now();
    if (!reports.has(partner.userId)) reports.set(partner.userId, new Map());
    const r = reports.get(partner.userId);
    // nettoie les vieux signalements
    for (const [rep, t] of r) if (now - t > REPORT_WINDOW_MS) r.delete(rep);
    r.set(me.userId, now); // 1 seul signalement compté par personne

    const count = r.size;
    if (count >= REPORTS_TO_BAN) {
      bans.set(partner.userId, now + BAN_DURATION_MS);
      reports.delete(partner.userId);
      const partnerSocketId = me.partner;
      unpair(socket.id, false);
      io.to(partnerSocketId).emit('banned', { remainingMs: BAN_DURATION_MS });
      socket.emit('report-ok', { count, banned: true });
      tryMatch(socket.id); // le signaleur repart en recherche
    } else {
      socket.emit('report-ok', { count, banned: false });
      io.to(me.partner).emit('warning', { count, max: REPORTS_TO_BAN });
    }
  });

  socket.on('disconnect', () => {
    unpair(socket.id);
    removeFromQueue(socket.id);
    peers.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`AzurMeet en ligne sur http://localhost:${PORT}`);
  if (GOOGLE_CLIENT_ID.startsWith('REMPLACE_MOI')) {
    console.log('⚠️  Pense à mettre ton GOOGLE_CLIENT_ID (voir README.md) sinon la connexion Google ne marchera pas.');
  }
});

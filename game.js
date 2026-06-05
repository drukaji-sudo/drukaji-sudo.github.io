(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const menu = document.getElementById('menu');
  const hud = document.getElementById('hud');
  const leaderboard = document.getElementById('leaderboard');
  const playersPanel = document.getElementById('playersPanel');
  const statusEl = document.getElementById('status');

  const playerNameInput = document.getElementById('playerName');
  const roomNameInput = document.getElementById('roomName');
  const joinBtn = document.getElementById('joinBtn');
  const bodyColorInput = document.getElementById('bodyColor');
  const eyeColorInput = document.getElementById('eyeColor');
  const playerStyleInput = document.getElementById('playerStyle');

  const floorHud = document.getElementById('floorHud');
  const comboHud = document.getElementById('comboHud');
  const roomHud = document.getElementById('roomHud');
  const onlineHud = document.getElementById('onlineHud');
  const leaderList = document.getElementById('leaderList');
  const playersList = document.getElementById('playersList');

  const defaultCfg = window.FROST_TOWER_CONFIG || {};

  playerNameInput.value = localStorage.getItem('frostTowerName') || '';
  bodyColorInput.value = localStorage.getItem('frostTowerBodyColor') || '#73d7ff';
  eyeColorInput.value = localStorage.getItem('frostTowerEyeColor') || '#ffffff';
  playerStyleInput.value = localStorage.getItem('frostTowerStyle') || 'classic';

  let W = 0, H = 0, dpr = 1;
  function resize(){
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.floor(innerWidth);
    H = Math.floor(innerHeight);
    canvas.width = Math.floor(W*dpr);
    canvas.height = Math.floor(H*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  addEventListener('resize', resize);
  resize();

  const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()));
  const keys = {};
  let running = false;
  let room = 'friends';
  let supa = null;
  let dbLiveReady = false;
  let lastDbPush = 0;
  let lastDbPull = 0;
  const others = new Map();

  const state = {
    id,
    name: 'Player',
    color: '#73d7ff',
    eyeColor: '#ffffff',
    style: 'classic',
    x: 0, y: 0, vx: 0, vy: 0,
    w: 28, h: 42,
    grounded: false,
    alive: true,
    floor: 0,
    combo: 0,
    bestCombo: 0,
    cameraY: 0,
    scrollSpeed: 55
  };

  let platforms = [];
  let lastTime = 0;

  function hashString(str){
    let h = 2166136261;
    for(let i = 0; i < str.length; i++){
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed){
    return function(){
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function roomRandom(extra = 0){
    return mulberry32((hashString(room || 'friends') + extra) >>> 0);
  }

  function resetGame(){
    const rand = roomRandom(1000);
    const spawnPlatformY = H - 86;

    state.x = W / 2 - state.w / 2;
    state.y = spawnPlatformY - state.h;
    state.vx = 0;
    state.vy = 0;
    state.grounded = true;
    state.floor = 0;
    state.combo = 0;
    state.bestCombo = 0;
    state.cameraY = 0;
    state.scrollSpeed = 55;
    state.alive = true;

    platforms = [{
      x: Math.max(20, W / 2 - 125),
      y: spawnPlatformY,
      w: Math.min(250, W - 40),
      h: 16,
      floor: 0
    }];

    let y = spawnPlatformY - 70;
    let lastX = W / 2 - 75;

    for(let i = 1; i < 50; i++){
      const gap = Math.min(102, 68 + i * 2.2);
      y -= gap;
      const width = Math.max(86, 170 - i * 3);
      const maxHorizontalReach = Math.min(210, 110 + i * 6);
      const minX = Math.max(24, lastX - maxHorizontalReach);
      const maxX = Math.min(W - width - 24, lastX + maxHorizontalReach);
      const x = minX + rand() * Math.max(1, maxX - minX);
      platforms.push({x, y, w: width, h: 14, floor: i});
      lastX = x;
    }
  }

  async function connectSupabase(){
    try{
      const url = (defaultCfg.SUPABASE_URL || '').trim();
      const anon = (defaultCfg.SUPABASE_ANON_KEY || '').trim();

      if(!url || !anon){
        statusEl.textContent = 'Mode local : Supabase non configuré';
        return;
      }

      if(!window.supabase || !window.supabase.createClient){
        statusEl.textContent = 'Mode local : Supabase non chargé';
        return;
      }

      supa = window.supabase.createClient(url, anon);
      dbLiveReady = true;
      statusEl.textContent = 'Live fluide connecté : room ' + room;

      await pushDbState(true);
      await pullDbPlayers(true);
    }catch(e){
      console.error(e);
      dbLiveReady = false;
      statusEl.textContent = 'Live DB erreur : exécute supabase-db-live.sql';
    }
  }

  async function pushDbState(force=false){
    if(!supa || !dbLiveReady) return;
    const now = performance.now();
    if(!force && now - lastDbPush < 45) return;
    lastDbPush = now;

    const row = {
      room,
      player_id: id,
      name: state.name,
      color: state.color,
      eye_color: state.eyeColor,
      style: state.style,
      x: state.x,
      y: state.y,
      floor: state.floor,
      combo: state.combo,
      alive: state.alive,
      updated_at: new Date().toISOString()
    };

    const { error } = await supa
      .from('frost_tower_players')
      .upsert(row, { onConflict: 'room,player_id' });

    if(error){
      console.error(error);
      dbLiveReady = false;
      statusEl.textContent = 'Live DB erreur : exécute supabase-db-live.sql';
    }
  }

  async function pullDbPlayers(force=false){
    if(!supa || !dbLiveReady) return;
    const now = performance.now();
    if(!force && now - lastDbPull < 70) return;
    lastDbPull = now;

    const cutoff = new Date(Date.now() - 12000).toISOString();

    const { data, error } = await supa
      .from('frost_tower_players')
      .select('*')
      .eq('room', room)
      .gte('updated_at', cutoff);

    if(error){
      console.error(error);
      dbLiveReady = false;
      statusEl.textContent = 'Live DB erreur : exécute supabase-db-live.sql';
      return;
    }

    const presentIds = new Set();

    for(const p of data || []){
      if(p.player_id === id) continue;
      presentIds.add(p.player_id);
      const oldPlayer = others.get(p.player_id);
      const targetX = Number(p.x || W / 2);
      const targetY = Number(p.y || H - 160);

      others.set(p.player_id, {
        id: p.player_id,
        name: p.name || 'Player',
        color: p.color || '#73d7ff',
        eyeColor: p.eye_color || '#ffffff',
        style: p.style || 'classic',

        // position affichée localement
        x: oldPlayer ? oldPlayer.x : targetX,
        y: oldPlayer ? oldPlayer.y : targetY,

        // position cible reçue de Supabase
        targetX,
        targetY,

        floor: Number(p.floor || 0),
        combo: Number(p.combo || 0),
        alive: Boolean(p.alive),
        lastSeen: performance.now()
      });
    }

    for(const oid of Array.from(others.keys())){
      if(!presentIds.has(oid)) others.delete(oid);
    }

    onlineHud.textContent = String((data || []).length || 1);
    updateLeaderboard();
    updatePlayersList();
  }

  function dbLiveTick(){
    if(!dbLiveReady) return;
    pushDbState(false);
    pullDbPlayers(false);
  }

  function smoothOtherPlayers(dt){
    for(const p of others.values()){
      if(typeof p.targetX !== 'number') p.targetX = p.x;
      if(typeof p.targetY !== 'number') p.targetY = p.y;

      const speed = Math.min(1, dt * 18);
      p.x += (p.targetX - p.x) * speed;
      p.y += (p.targetY - p.y) * speed;
    }
  }

  function update(dt){
    if(!state.alive){
      resetGame();
      return;
    }

    const move = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    state.vx += move * 2500 * dt;
    state.vx *= Math.pow(0.0008, dt);
    state.x += state.vx * dt;

    if(state.x < -state.w) state.x = W + state.w;
    if(state.x > W + state.w) state.x = -state.w;

    state.vy += 1350 * dt;
    state.y += state.vy * dt;
    state.grounded = false;

    for(const p of platforms){
      const wasAbove = state.y + state.h - state.vy * dt <= p.y;
      const overlapping = state.x + state.w > p.x && state.x < p.x + p.w;
      const falling = state.vy >= 0;

      if(falling && wasAbove && overlapping && state.y + state.h >= p.y && state.y + state.h <= p.y + 26){
        state.y = p.y - state.h;
        state.vy = 0;
        state.grounded = true;

        if(p.floor > state.floor){
          const gained = p.floor - state.floor;
          state.combo = gained >= 2 ? state.combo + gained : 0;
          state.bestCombo = Math.max(state.bestCombo, state.combo);
          state.floor = p.floor;
        }
      }
    }

    if((keys.Space || keys.ArrowUp || keys.KeyW) && state.grounded){
      const boost = Math.min(260, Math.abs(state.vx) * 0.16);
      state.vy = -585 - boost;
      state.grounded = false;
    }

    const targetCam = Math.min(state.cameraY, state.y - H * 0.52);
    state.cameraY += (targetCam - state.cameraY) * Math.min(1, dt * 5);

    state.scrollSpeed = 55 + Math.max(0, Math.floor(state.floor / 20)) * 13;
    state.cameraY -= state.scrollSpeed * dt * 0.1;

    ensurePlatforms();

    platforms = platforms.filter(p => p.y - state.cameraY < H + 180);

    if(state.y - state.cameraY > H + 130){
      state.alive = false;
      state.floor = 0;
      state.combo = 0;
    }

    floorHud.textContent = state.floor;
    comboHud.textContent = state.combo;

    smoothOtherPlayers(dt);
    updateLeaderboard();
    updatePlayersList();
    dbLiveTick();
  }

  function ensurePlatforms(){
    const topNeeded = state.cameraY - 160;

    while(Math.min(...platforms.map(p => p.y)) > topNeeded){
      const nextFloor = Math.max(...platforms.map(p => p.floor)) + 1;
      const rand = roomRandom(1000 + nextFloor);
      const prev = platforms.find(p => p.floor === nextFloor - 1) || platforms.reduce((a,b) => a.y < b.y ? a : b);

      const difficulty = Math.min(72, nextFloor * 1.15);
      const width = Math.max(78, 160 - difficulty);
      const gap = Math.min(108, 72 + nextFloor * 0.65);
      const maxHorizontalReach = Math.min(230, 120 + nextFloor * 1.5);
      const minX = Math.max(22, prev.x - maxHorizontalReach);
      const maxX = Math.min(W - width - 22, prev.x + maxHorizontalReach);
      const x = minX + rand() * Math.max(1, maxX - minX);

      platforms.push({
        x,
        y: prev.y - gap,
        w: width,
        h: 14,
        floor: nextFloor
      });
    }
  }

  function draw(){
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'#102a49');
    g.addColorStop(1,'#050914');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    drawSnow();

    ctx.save();
    ctx.translate(0, -state.cameraY);

    for(const p of platforms){
      ctx.fillStyle = 'rgba(210,245,255,.92)';
      roundRect(ctx,p.x,p.y,p.w,p.h,8,true);
      ctx.fillStyle = 'rgba(115,215,255,.35)';
      roundRect(ctx,p.x,p.y+p.h-4,p.w,4,6,true);
    }

    if(running){
      drawPlayer(state.x, state.y, state.name, state.color, state.eyeColor, state.style, true);

      for(const p of others.values()){
        const screenY = p.y - state.cameraY;

        if(screenY > -80 && screenY < H + 80){
          drawPlayer(p.x, p.y, p.name, p.color, p.eyeColor, p.style, false);
        } else {
          // Fantôme de position sur le bord de l'écran pour voir l'ami en permanence.
          const edgeY = screenY < 0 ? state.cameraY + 38 : state.cameraY + H - 52;
          drawPlayer(p.x, edgeY, p.name + (screenY < 0 ? ' ↑' : ' ↓'), p.color, p.eyeColor, p.style, false);
        }
      }
    }

    ctx.restore();

    if(running){
      for(const p of others.values()){
        const screenY = p.y - state.cameraY;
        if(screenY <= -80 || screenY >= H + 80){
          drawFriendIndicator(p, screenY);
        }
      }

      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.font = 'bold 72px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(String(state.floor), W/2, 100);
    }
  }

  function drawSnow(){
    const t = performance.now()/1000;
    ctx.fillStyle = 'rgba(255,255,255,.38)';
    for(let i=0;i<70;i++){
      const x = (i*97 + Math.sin(t+i)*30) % W;
      const y = (i*61 + t*(20+i%6)) % H;
      ctx.beginPath();
      ctx.arc(x,y,1.3+(i%3)*.45,0,Math.PI*2);
      ctx.fill();
    }
  }

  function drawFriendIndicator(p, screenY){
    const x = Math.max(28, Math.min(W - 28, p.x || W / 2));
    const y = screenY < 0 ? 28 : H - 28;
    ctx.fillStyle = p.color || '#73d7ff';
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    const diff = Number(p.floor || 0) - Number(state.floor || 0);
    const floorText = diff === 0 ? 'même étage' : (diff > 0 ? `+${diff} étages` : `${diff} étages`);
    ctx.fillText(`${p.name || 'Player'} ${screenY < 0 ? '↑' : '↓'} ${floorText}`, x, y + (screenY < 0 ? 24 : -16));
  }

  function drawPlayer(x,y,name,color,eyeColor,style,isMe){
    ctx.fillStyle = color || '#73d7ff';
    roundRect(ctx,x,y,state.w,state.h,9,true);

    if(style === 'ninja'){
      ctx.fillStyle = 'rgba(0,0,0,.42)';
      roundRect(ctx,x+3,y+6,state.w-6,13,6,true);
    }

    if(style === 'ice'){
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.beginPath();
      ctx.moveTo(x + state.w/2, y - 8);
      ctx.lineTo(x + state.w/2 - 8, y + 4);
      ctx.lineTo(x + state.w/2 + 8, y + 4);
      ctx.closePath();
      ctx.fill();
    }

    if(style === 'crown'){
      ctx.fillStyle = '#ffd85c';
      ctx.beginPath();
      ctx.moveTo(x+5,y+1);
      ctx.lineTo(x+9,y-10);
      ctx.lineTo(x+14,y+0);
      ctx.lineTo(x+20,y-10);
      ctx.lineTo(x+24,y+1);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = isMe ? '#ffffff' : 'rgba(255,255,255,.82)';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(name || 'Player', x + state.w/2, y - 8);

    ctx.fillStyle = eyeColor || '#ffffff';
    ctx.fillRect(x+6,y+11,5,5);
    ctx.fillRect(x+state.w-11,y+11,5,5);

    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.fillRect(x+7,y+12,2,2);
    ctx.fillRect(x+state.w-10,y+12,2,2);
  }

  function updateLeaderboard(){
    const seen = new Map();
    seen.set(id, {name: state.name, floor: state.floor, combo: state.combo, color: state.color});

    for(const p of others.values()){
      seen.set(p.id || p.name, {
        name: p.name || 'Player',
        floor: Number(p.floor || 0),
        combo: Number(p.combo || 0),
        color: p.color || '#73d7ff'
      });
    }

    const list = Array.from(seen.values())
      .sort((a,b) => b.floor - a.floor || b.combo - a.combo)
      .slice(0,8);

    leaderList.innerHTML = list.map(p =>
      `<li><b>${escapeHtml(p.name)}</b> — étage ${p.floor}</li>`
    ).join('');
  }

  function updatePlayersList(){
    const players = [
      {id, name: state.name, color: state.color, me: true},
      ...Array.from(others.values()).map(p => ({
        id: p.id,
        name: p.name || 'Player',
        color: p.color || '#73d7ff',
        me: false
      }))
    ];

    playersList.innerHTML = players.map(p =>
      `<li><span class="dot" style="color:${escapeHtml(p.color)};background:${escapeHtml(p.color)}"></span>${escapeHtml(p.name)}${p.me ? ' <small>(toi)</small>' : ''}</li>`
    ).join('');
  }

  function loop(ts){
    if(!lastTime) lastTime = ts;
    const dt = Math.min(0.033, (ts - lastTime) / 1000);
    lastTime = ts;

    if(running) update(dt);
    draw();

    requestAnimationFrame(loop);
  }

  function roundRect(c,x,y,w,h,r,fill){
    c.beginPath();
    c.moveTo(x+r,y);
    c.arcTo(x+w,y,x+w,y+h,r);
    c.arcTo(x+w,y+h,x,y+h,r);
    c.arcTo(x,y+h,x,y,r);
    c.arcTo(x,y,x+w,y,r);
    if(fill) c.fill();
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, m => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#039;'
    }[m]));
  }

  addEventListener('keydown', e => {
    keys[e.code] = true;
    if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  });

  addEventListener('keyup', e => {
    keys[e.code] = false;
  });

  joinBtn.addEventListener('click', async () => {
    try{
      state.name = (playerNameInput.value || 'Player').trim().slice(0,16);
      state.color = bodyColorInput.value || '#73d7ff';
      state.eyeColor = eyeColorInput.value || '#ffffff';
      state.style = playerStyleInput.value || 'classic';

      room = (roomNameInput.value || 'friends')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g,'')
        .slice(0,24) || 'friends';

      localStorage.setItem('frostTowerName', state.name);
      localStorage.setItem('frostTowerBodyColor', state.color);
      localStorage.setItem('frostTowerEyeColor', state.eyeColor);
      localStorage.setItem('frostTowerStyle', state.style);

      others.clear();
      resetGame();

      menu.classList.add('hidden');
      hud.classList.remove('hidden');
      leaderboard.classList.remove('hidden');
      playersPanel.classList.remove('hidden');

      roomHud.textContent = room;
      floorHud.textContent = '0';
      comboHud.textContent = '0';
      onlineHud.textContent = '1';

      running = true;
      updateLeaderboard();
      updatePlayersList();

      statusEl.textContent = 'Jeu démarré, connexion live en cours...';
      connectSupabase();
    }catch(e){
      console.error(e);
      statusEl.textContent = 'Erreur au démarrage : voir console';
    }
  });

  requestAnimationFrame(loop);
})();

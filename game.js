(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const menu = document.getElementById('menu');
  const configPanel = document.getElementById('configPanel');
  const hud = document.getElementById('hud');
  const leaderboard = document.getElementById('leaderboard');
  const statusEl = document.getElementById('status');

  const playerNameInput = document.getElementById('playerName');
  const roomNameInput = document.getElementById('roomName');
  const joinBtn = document.getElementById('joinBtn');
  const configBtn = document.getElementById('configBtn');
  const saveConfigBtn = document.getElementById('saveConfigBtn');
  const backBtn = document.getElementById('backBtn');
  const supabaseUrlInput = document.getElementById('supabaseUrl');
  const supabaseAnonInput = document.getElementById('supabaseAnon');

  const floorHud = document.getElementById('floorHud');
  const comboHud = document.getElementById('comboHud');
  const roomHud = document.getElementById('roomHud');
  const onlineHud = document.getElementById('onlineHud');
  const leaderList = document.getElementById('leaderList');

  const savedCfg = JSON.parse(localStorage.getItem('frostTowerConfig') || '{}');
  const defaultCfg = window.FROST_TOWER_CONFIG || {};
  supabaseUrlInput.value = savedCfg.SUPABASE_URL || defaultCfg.SUPABASE_URL || '';
  supabaseAnonInput.value = savedCfg.SUPABASE_ANON_KEY || defaultCfg.SUPABASE_ANON_KEY || '';
  playerNameInput.value = localStorage.getItem('frostTowerName') || '';

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

  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random());
  const keys = {};
  let running = false;
  let supa = null;
  let channel = null;
  let room = 'friends';
  const others = new Map();

  const state = {
    id, name:'Player', color: randomColor(),
    x: 0, y: 0, vx: 0, vy: 0,
    w: 28, h: 42,
    grounded: false, alive: true,
    floor: 0, combo: 0, bestCombo: 0,
    cameraY: 0, scrollSpeed: 70,
    lastBroadcast: 0
  };

  let platforms = [];
  let lastTime = 0;

  function randomColor(){
    const colors = ['#73d7ff','#ffcf5c','#ff78b7','#80ff9f','#b187ff','#ff8a5c'];
    return colors[Math.floor(Math.random()*colors.length)];
  }

  function resetGame(){
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

    platforms = [];

    // Plateforme de départ garantie sous le joueur.
    platforms.push({
      x: Math.max(20, W / 2 - 125),
      y: spawnPlatformY,
      w: Math.min(250, W - 40),
      h: 16,
      floor: 0
    });

    // Premières plateformes rapprochées pour que le jump soit naturel.
    // L'écart vertical augmente doucement avec la difficulté.
    let y = spawnPlatformY - 70;
    let lastX = W / 2 - 75;

    for(let i = 1; i < 18; i++){
      const gap = Math.min(102, 68 + i * 2.2);
      y -= gap;

      const width = Math.max(86, 170 - i * 3);
      const maxHorizontalReach = Math.min(210, 110 + i * 6);
      const minX = Math.max(24, lastX - maxHorizontalReach);
      const maxX = Math.min(W - width - 24, lastX + maxHorizontalReach);
      const x = minX + Math.random() * Math.max(1, maxX - minX);

      platforms.push({
        x,
        y,
        w: width,
        h: 14,
        floor: i
      });

      lastX = x;
    }
  }

  async function connectSupabase(){
    const cfg = JSON.parse(localStorage.getItem('frostTowerConfig') || '{}');
    const url = cfg.SUPABASE_URL || defaultCfg.SUPABASE_URL;
    const anon = cfg.SUPABASE_ANON_KEY || defaultCfg.SUPABASE_ANON_KEY;

    if(!url || !anon){
      statusEl.textContent = 'Mode local : ajoute Supabase pour jouer live';
      return;
    }

    supa = window.supabase.createClient(url, anon, {
      realtime: { params: { eventsPerSecond: 20 } }
    });

    channel = supa.channel(`frost-tower-room-${room}`, {
      config: { presence: { key: id } }
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const presence = channel.presenceState();
        onlineHud.textContent = Object.keys(presence).length;
      })
      .on('broadcast', { event: 'state' }, ({ payload }) => {
        if(!payload || payload.id === id) return;
        payload.lastSeen = performance.now();
        others.set(payload.id, payload);
      })
      .subscribe(async (status, err) => {
        if(status === 'SUBSCRIBED'){
          statusEl.textContent = 'Connecté live avec Supabase';
          await channel.track({ id, name: state.name, joinedAt: Date.now() });
        } else if(err) {
          statusEl.textContent = 'Erreur Supabase : ' + (err.message || 'connexion impossible');
        } else {
          statusEl.textContent = 'Supabase : ' + status;
        }
      });
  }

  function broadcast(){
    if(!channel || performance.now() - state.lastBroadcast < 50) return;
    state.lastBroadcast = performance.now();
    channel.send({
      type: 'broadcast',
      event: 'state',
      payload: {
        id, name: state.name, color: state.color,
        x: state.x, y: state.y, floor: state.floor,
        combo: state.combo, alive: state.alive
      }
    });
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
      const wasAbove = state.y + state.h - state.vy*dt <= p.y;
      const overlapping = state.x + state.w > p.x && state.x < p.x + p.w;
      const falling = state.vy > 0;
      if(falling && wasAbove && overlapping && state.y + state.h >= p.y && state.y + state.h <= p.y + 24){
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

    const targetCam = Math.min(state.cameraY, state.y - H*0.52);
    state.cameraY += (targetCam - state.cameraY) * Math.min(1, dt*5);

    const climbFactor = Math.max(0, Math.floor(state.floor / 20));
    state.scrollSpeed = 70 + climbFactor * 13;
    state.cameraY -= state.scrollSpeed * dt * 0.12;

    const topNeeded = state.cameraY - 120;
    while(Math.min(...platforms.map(p=>p.y)) > topNeeded){
      const highestPlatform = platforms.reduce((a,b) => a.y < b.y ? a : b);
      const nextFloor = Math.max(...platforms.map(p=>p.floor)) + 1;
      const difficulty = Math.min(72, nextFloor * 1.15);
      const width = Math.max(78, 160 - difficulty);
      const gap = Math.min(108, 72 + nextFloor * 0.65);

      const maxHorizontalReach = Math.min(230, 120 + nextFloor * 1.5);
      const minX = Math.max(22, highestPlatform.x - maxHorizontalReach);
      const maxX = Math.min(W - width - 22, highestPlatform.x + maxHorizontalReach);
      const x = minX + Math.random() * Math.max(1, maxX - minX);

      platforms.push({
        x,
        y: highestPlatform.y - gap,
        w: width,
        h: 14,
        floor: nextFloor
      });
    }
    platforms = platforms.filter(p => p.y - state.cameraY < H + 160);

    if(state.y - state.cameraY > H + 120){
      state.alive = false;
      state.floor = 0;
      state.combo = 0;
    }

    // Nettoie les joueurs fantômes après 3 secondes sans update
    const now = performance.now();
    for(const [oid, p] of others){
      if(now - (p.lastSeen || 0) > 3000) others.delete(oid);
    }

    floorHud.textContent = state.floor;
    comboHud.textContent = state.combo;
    updateLeaderboard();
    broadcast();
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

    // plateformes
    for(const p of platforms){
      ctx.fillStyle = 'rgba(210,245,255,.92)';
      roundRect(ctx,p.x,p.y,p.w,p.h,8,true);
      ctx.fillStyle = 'rgba(115,215,255,.35)';
      roundRect(ctx,p.x,p.y+p.h-4,p.w,4,6,true);
    }

    // joueur local
    drawPlayer(state.x, state.y, state.name, state.color, true);

    // autres joueurs
    for(const p of others.values()){
      drawPlayer(p.x, p.y, p.name, p.color, false);
    }

    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.font = 'bold 72px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(String(state.floor), W/2, 100);
  }

  function drawPlayer(x,y,name,color,isMe){
    ctx.fillStyle = color;
    roundRect(ctx,x,y,state.w,state.h,9,true);
    ctx.fillStyle = isMe ? '#ffffff' : 'rgba(255,255,255,.82)';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(name || 'Player', x + state.w/2, y - 8);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(x+6,y+10,5,5);
    ctx.fillRect(x+state.w-11,y+10,5,5);
  }

  function drawSnow(){
    const t = performance.now()/1000;
    ctx.fillStyle = 'rgba(255,255,255,.38)';
    for(let i=0;i<70;i++){
      const x = (i*97 + Math.sin(t+i)*30) % W;
      const y = (i*61 + t*(20+i%6)) % H;
      ctx.beginPath(); ctx.arc(x,y,1.3+(i%3)*.45,0,Math.PI*2); ctx.fill();
    }
  }

  function updateLeaderboard(){
    const list = [
      {name: state.name, floor: state.floor, combo: state.combo},
      ...Array.from(others.values()).map(p => ({name:p.name, floor:p.floor||0, combo:p.combo||0}))
    ].sort((a,b)=>b.floor-a.floor).slice(0,8);

    leaderList.innerHTML = list.map(p => `<li><b>${escapeHtml(p.name || 'Player')}</b> — ${p.floor}</li>`).join('');
  }

  function loop(ts){
    if(!lastTime) lastTime = ts;
    const dt = Math.min(0.033, (ts-lastTime)/1000);
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
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  }

  addEventListener('keydown', e => {
    keys[e.code] = true;
    if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', e => keys[e.code] = false);

  joinBtn.addEventListener('click', async () => {
    state.name = (playerNameInput.value || 'Player').trim().slice(0,16);
    room = (roomNameInput.value || 'friends').trim().replace(/[^a-zA-Z0-9_-]/g,'').slice(0,24) || 'friends';
    localStorage.setItem('frostTowerName', state.name);
    menu.classList.add('hidden');
    hud.classList.remove('hidden');
    leaderboard.classList.remove('hidden');
    roomHud.textContent = room;
    resetGame();
    running = true;
    await connectSupabase();
  });

  configBtn.addEventListener('click', () => {
    menu.classList.add('hidden');
    configPanel.classList.remove('hidden');
  });

  backBtn.addEventListener('click', () => {
    configPanel.classList.add('hidden');
    menu.classList.remove('hidden');
  });

  saveConfigBtn.addEventListener('click', () => {
    localStorage.setItem('frostTowerConfig', JSON.stringify({
      SUPABASE_URL: supabaseUrlInput.value.trim(),
      SUPABASE_ANON_KEY: supabaseAnonInput.value.trim()
    }));
    statusEl.textContent = 'Configuration sauvegardée';
    configPanel.classList.add('hidden');
    menu.classList.remove('hidden');
  });

  requestAnimationFrame(loop);
})();

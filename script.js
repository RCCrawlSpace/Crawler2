/*
  CRAWLER COMMAND - EXPLICIT ADDRESSING
  Status: PRODUCTION
  Update: Removed 'Continue Magic'. Uses Explicit Addressing for every chunk.
*/

// ==========================================
// 1. SETUP
// ==========================================
let port, writer, reader, connected = false;
let originalSettings = null; 

const btnConnect = document.getElementById('btn-connect');
const btnSave = document.getElementById('btn-save');
const statusBadge = document.getElementById('status');
const btnBackup = document.getElementById('btn-backup');

const CMD = { Init: 0x30, Exit: 0x35, ReadEE: 0x04, WriteEE: 0x05, SetAddr: 0xFF };

const OFFSET = {
    DIR: 0x11, BI_DIR: 0x12, SINE: 0x13, COMP_PWM: 0x14, VAR_PWM: 0x15,
    STUCK: 0x16, TIMING: 0x17, PWM_FREQ: 0x18, START_POWER: 0x19,
    KV: 0x1A, POLES: 0x1B, BRAKE_STOP: 0x1C, STALL: 0x1D, BEEP: 0x1E,
    LVC: 0x24, SINE_RANGE: 0x28, BRAKE_STR: 0x29
};

btnConnect.addEventListener('click', handleConnection);
btnSave.addEventListener('click', handleSave);

['power','range','ramp','stop-power','timing','beep'].forEach(key => {
    const input = document.getElementById('input-'+key);
    if(input) input.addEventListener('input', e => updateDisplay('val-'+key, e.target.value, getSuffix(key)));
});

function crc16(data) {
    let crc = 0;
    for (let i = 0; i < data.length; i++) {
        let xb = data[i];
        for (let j = 0; j < 8; j++) {
            if (((xb & 0x01) ^ (crc & 0x0001)) !== 0) crc = (crc >> 1) ^ 0xA001;
            else crc = crc >> 1;
            xb = xb >> 1;
        }
    }
    return crc & 0xFFFF;
}

// ==========================================
// 2. SERIAL PROTOCOL
// ==========================================
async function sendPacket(cmd, params = [], expectedBytes = 0) {
    if (!writer) throw new Error("Stream Closed");
    
    const payload = [cmd, ...params];
    const crc = crc16(new Uint8Array(payload));
    const packet = new Uint8Array([...payload, (crc & 0xFF), (crc >> 8) & 0xFF]);
    
    // console.log(`>> CMD: 0x${cmd.toString(16)} Params: [${params}]`);
    await writer.write(packet);
    
    let buffer = [];
    const start = Date.now();
    const targetLength = expectedBytes > 0 ? (expectedBytes + 3) : 1; 
    
    while (Date.now() - start < 1000) { 
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
            for(let b of value) buffer.push(b);
            if (expectedBytes === 0 && buffer.includes(0x30)) return buffer; 
            if (buffer.length >= targetLength) return buffer;
        }
    }
    return buffer.length > 0 ? buffer : null;
}

// ==========================================
// 3. MAIN LOGIC
// ==========================================
async function handleConnection() {
    if (connected) { await disconnectSerial(); return; }
    if (!navigator.serial) { alert("Use Chrome."); return; }

    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 19200 }); 
        writer = port.writable.getWriter();
        reader = port.readable.getReader();
        connected = true;
        updateStatus("CONNECTED", true);

        console.log("Sending Init...");
        await sendPacket(CMD.Init, [0], 0);
        await new Promise(r => setTimeout(r, 100)); 

        console.log("Reading EEPROM (Explicit Chunking)...");
        let fullData = [];
        const chunkSize = 32; 
        const totalSize = 176;
        
        for(let i=0; i<totalSize; i+=chunkSize) {
            // EXPLICIT ADDRESS CALCULATION
            // Magic Base = 0x2000
            const currentAddr = 0x2000 + i;
            const addrHi = (currentAddr >> 8) & 0xFF; 
            const addrLo = currentAddr & 0xFF;        
            
            // console.log(`Reading offset ${i} at Addr 0x${currentAddr.toString(16)}`);
            
            // Send SetAddr (0xFF, 0x00, Hi, Lo)
            await sendPacket(CMD.SetAddr, [0x00, addrHi, addrLo], 0);
            
            // Send Read (0x04, Size)
            const chunk = await sendPacket(CMD.ReadEE, [chunkSize], chunkSize);
            
            if(!chunk) {
                console.warn(`Chunk ${i} failed.`);
                break; // Stop trying to read if one fails
            }
            
            // Clean chunk (remove ACK/CRC)
            let cleanChunk = chunk;
            if(chunk[0] === 0x30) cleanChunk = chunk.slice(1); 
            cleanChunk = cleanChunk.slice(0, chunkSize); 
            
            fullData = fullData.concat(Array.from(cleanChunk));
        }
        
        if (fullData.length >= 100) { // If we got most of it
            originalSettings = fullData;
            parseSettings(fullData);
            enableBackupBtn();
            showToast("Settings Loaded!");
        } else {
            console.warn("Incomplete Read.");
            alert("Connection OK, but Read Stopped.\nUnplug/Replug USB.");
            btnSave.style.display = 'none';
        }
        
    } catch (err) {
        console.error(err);
        alert("Error: " + err.message);
        await disconnectSerial();
    }
}

async function handleSave() {
    if (!connected || !originalSettings) return;
    btnSave.textContent = "Saving...";
    
    let newBytes = [...originalSettings]; 
    newBytes[OFFSET.START_POWER] = parseInt(document.getElementById('input-power').value);
    newBytes[OFFSET.SINE_RANGE] = parseInt(document.getElementById('input-range').value);
    newBytes[OFFSET.BRAKE_STR] = parseInt(document.getElementById('input-stop-power').value);
    newBytes[OFFSET.TIMING] = parseInt(document.getElementById('input-timing').value);
    newBytes[OFFSET.BEEP] = parseInt(document.getElementById('input-beep').value);
    newBytes[OFFSET.KV] = Math.max(0, (parseInt(document.getElementById('input-kv').value) - 20) / 40);
    newBytes[OFFSET.POLES] = parseInt(document.getElementById('input-poles').value);
    newBytes[OFFSET.BRAKE_STOP] = document.getElementById('input-brakeOnStop').checked ? 1 : 0;
    newBytes[OFFSET.DIR] = document.getElementById('input-reverse').checked ? 1 : 0;
    newBytes[OFFSET.COMP_PWM] = document.getElementById('input-comp-pwm').checked ? 1 : 0;
    newBytes[OFFSET.VAR_PWM] = document.getElementById('input-var-pwm').checked ? 1 : 0;
    newBytes[OFFSET.STALL] = document.getElementById('input-stall').checked ? 1 : 0;
    newBytes[OFFSET.STUCK] = document.getElementById('input-stuck').checked ? 1 : 0;

    try {
        const chunkSize = 32;
        for(let i=0; i<176; i+=chunkSize) {
            // Explicit Address Write
            const currentAddr = 0x2000 + i;
            const addrHi = (currentAddr >> 8) & 0xFF; 
            const addrLo = currentAddr & 0xFF;   
            await sendPacket(CMD.SetAddr, [0x00, addrHi, addrLo], 0);
            
            const chunk = newBytes.slice(i, i+chunkSize);
            const res = await sendPacket(CMD.WriteEE, chunk);
            if(!res) throw new Error("Write failed at " + i);
        }
        
        btnSave.textContent = "Saved ✓";
        originalSettings = newBytes; 
        setTimeout(() => { btnSave.textContent = "Save to ESC"; }, 1500);
    } catch(e) {
        alert("Write Failed: " + e.message);
        btnSave.textContent = "Save to ESC";
    }
}

async function disconnectSerial() {
    try {
        if (writer) await writer.close();
        if (reader) await reader.cancel();
        if (port) await port.close();
    } catch(e) { console.log(e); }
    connected = false;
    updateStatus("DISCONNECTED", false);
}

// ==========================================
// 4. UI HELPERS
// ==========================================
function updateStatus(text, isConnected) {
    statusBadge.textContent = text;
    statusBadge.classList.toggle("connected", isConnected);
    btnConnect.textContent = isConnected ? "Disconnect" : "Connect ESC";
    btnConnect.style.background = isConnected ? "#ff453a" : "#30d158";
    btnSave.style.display = isConnected ? "block" : "none";
}

function parseSettings(data) {
    setVal('input-power', data[OFFSET.START_POWER] || 5);
    setVal('input-range', data[OFFSET.SINE_RANGE] || 25);
    setVal('input-stop-power', data[OFFSET.BRAKE_STR] || 2);
    setVal('input-timing', data[OFFSET.TIMING] || 15);
    setVal('input-beep', data[OFFSET.BEEP] || 40);
    
    document.getElementById('input-kv').value = ((data[OFFSET.KV]||50) * 40) + 20;
    document.getElementById('input-poles').value = data[OFFSET.POLES] || 14;
    
    document.getElementById('input-brakeOnStop').checked = data[OFFSET.BRAKE_STOP] === 1;
    document.getElementById('input-reverse').checked = data[OFFSET.DIR] === 1;
    document.getElementById('input-comp-pwm').checked = data[OFFSET.COMP_PWM] === 1;
    document.getElementById('input-var-pwm').checked = data[OFFSET.VAR_PWM] === 1;
    document.getElementById('input-stall').checked = data[OFFSET.STALL] === 1;
    document.getElementById('input-stuck').checked = data[OFFSET.STUCK] === 1;
    
    updateAllDisplays();
}

function updateAllDisplays() {
    ['power','range','ramp','stop-power','timing','beep'].forEach(key => {
        const val = document.getElementById('input-'+key).value;
        updateDisplay('val-'+key, val, getSuffix(key));
    });
}

function setVal(id, val) { const el = document.getElementById(id); if(el) el.value = val; }
function updateDisplay(id, val, suffix='') { const el = document.getElementById(id); if(el) el.textContent = val + suffix; }
function getSuffix(key) { if(key.includes('timing')) return '°'; if(key.includes('stop')) return '%'; return ''; }
function showTab(tabName) { document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none'); document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active')); document.getElementById('tab-' + tabName).style.display = 'block'; event.target.classList.add('active'); }
function toggleTech(btn) { const el = btn.closest('.setting-group').querySelector('.desc-tech'); if(el) el.classList.toggle('show'); }
function enableBackupBtn() { btnBackup.style.opacity = '1'; btnBackup.style.pointerEvents = 'auto'; }
function showToast(text) { const msg = document.createElement('div'); msg.style.cssText = "position:fixed; top:80px; left:50%; transform:translateX(-50%); background:#333; color:white; padding:10px 20px; border-radius:10px; z-index:2000; box-shadow:0 4px 10px rgba(0,0,0,0.3); font-weight:600;"; msg.textContent = text; document.body.appendChild(msg); setTimeout(() => msg.remove(), 2500); }

// PRESETS
const presets = {
    crawl: { power: 2, range: 25, ramp: 1.1, stopPower: 5, timing: 10, beep: 40 },
    trail: { power: 5, range: 15, ramp: 10.0, stopPower: 0, timing: 15, beep: 60 },
    bounce: { power: 7, range: 10, ramp: 15.0, stopPower: 0, timing: 20, beep: 80 }
};

window.applyPreset = function(name) {
    if (name === 'original') { 
        if (!originalSettings) { alert("Connect first to enable backup!"); return; } 
        parseSettings(originalSettings); 
        showToast("Original Settings Restored");
        return; 
    }
    const p = presets[name];
    if(!p) return;
    setVal('input-power', p.power); 
    setVal('input-range', p.range);
    setVal('input-ramp', p.ramp);
    setVal('input-stop-power', p.stopPower);
    setVal('input-timing', p.timing);
    setVal('input-beep', p.beep);
    updateAllDisplays();
}

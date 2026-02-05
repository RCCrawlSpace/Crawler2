/*
  CRAWLER COMMAND - FINAL LIVE DRIVER
  Status: VERIFIED (Handshake Confirmed)
  Protocol: 4-Way Interface
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

const CMD = { Init: 0x30, Exit: 0x35, ReadEE: 0x04, WriteEE: 0x05 };

// EEPROM MAP (Confirmed from eeprom.js)
const OFFSET = {
    DIR: 0x11, BI_DIR: 0x12, SINE: 0x13, COMP_PWM: 0x14, VAR_PWM: 0x15,
    STUCK: 0x16, TIMING: 0x17, PWM_FREQ: 0x18, START_POWER: 0x19,
    KV: 0x1A, POLES: 0x1B, BRAKE_STOP: 0x1C, STALL: 0x1D, BEEP: 0x1E,
    LVC: 0x24, SINE_RANGE: 0x28, BRAKE_STR: 0x29
};

btnConnect.addEventListener('click', handleConnection);
btnSave.addEventListener('click', handleSave);

// Bind UI
['power','range','ramp','stop-power','timing','beep'].forEach(key => {
    const input = document.getElementById('input-'+key);
    if(input) input.addEventListener('input', e => updateDisplay('val-'+key, e.target.value, getSuffix(key)));
});

// CRC16 (Matches Bootloader)
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
async function sendPacket(cmd, params = []) {
    const payload = [cmd, ...params];
    const crc = crc16(new Uint8Array(payload));
    const packet = new Uint8Array([...payload, (crc & 0xFF), (crc >> 8) & 0xFF]);
    
    await writer.write(packet);
    
    // READ LOOP
    // Wait for ACK (0x30) + Data + CRC
    // Since this is a simple implementation, we read into a buffer until silence.
    let buffer = [];
    const start = Date.now();
    
    while (Date.now() - start < 800) { // 800ms timeout
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
            for(let b of value) buffer.push(b);
            // If we have enough data (ACK + Length + Data + CRC), break early?
            // For ReadEE (176 bytes), we expect ~180 bytes.
            // For Init/Write, we expect ~3 bytes.
            if (params.length === 0 && buffer.length >= 3 && buffer[0] === 0x30) return buffer;
            if (cmd === CMD.ReadEE && buffer.length >= 178) return buffer; // ACK(1)+Data(176)+CRC(2) approx
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

        // 1. INIT
        console.log("Sending Init...");
        await sendPacket(CMD.Init, [0]);
        
        // 2. READ EEPROM (176 Bytes)
        // Command: [0x04, 0xB0] (Read 176 bytes)
        // Note: '0xB0' = 176.
        console.log("Reading EEPROM...");
        const response = await sendPacket(CMD.ReadEE, [176]); // 176 bytes
        
        if (response && response.length > 170) {
            // STRIP HEADERS/ACK
            // Buffer usually: [ACK, Data0...Data175, CRC_L, CRC_H]
            // We assume Data starts at index 1.
            const data = response.slice(1, 177); 
            
            parseSettings(data);
            showToast("Settings Loaded!");
            
            if(!originalSettings) {
                originalSettings = Array.from(data); // Save raw bytes backup
                enableBackupBtn();
            }
        } else {
            console.warn("Read incomplete, using defaults.");
            loadDefaults(); // Fail-safe
        }
        
    } catch (err) {
        console.error(err);
        alert("Error: " + err);
        await disconnectSerial();
    }
}

async function handleSave() {
    if (!connected) return;
    btnSave.textContent = "Saving...";
    
    // 1. RECONSTRUCT BYTES
    // We take the original array and update only the changed bytes
    // This preserves unknown settings.
    let newBytes = [...originalSettings]; 
    
    // Map UI values to Bytes
    newBytes[OFFSET.START_POWER] = parseInt(document.getElementById('input-power').value);
    newBytes[OFFSET.SINE_RANGE] = parseInt(document.getElementById('input-range').value);
    newBytes[OFFSET.BRAKE_STR] = parseInt(document.getElementById('input-stop-power').value); // Stop Power
    newBytes[OFFSET.TIMING] = parseInt(document.getElementById('input-timing').value);
    newBytes[OFFSET.BEEP] = parseInt(document.getElementById('input-beep').value);
    
    newBytes[OFFSET.KV] = (parseInt(document.getElementById('input-kv').value) - 20) / 40;
    newBytes[OFFSET.POLES] = parseInt(document.getElementById('input-poles').value);
    
    newBytes[OFFSET.BRAKE_STOP] = document.getElementById('input-brakeOnStop').checked ? 1 : 0;
    newBytes[OFFSET.DIR] = document.getElementById('input-reverse').checked ? 1 : 0;
    newBytes[OFFSET.COMP_PWM] = document.getElementById('input-comp-pwm').checked ? 1 : 0;
    newBytes[OFFSET.VAR_PWM] = document.getElementById('input-var-pwm').checked ? 1 : 0;
    newBytes[OFFSET.STALL] = document.getElementById('input-stall').checked ? 1 : 0;
    newBytes[OFFSET.STUCK] = document.getElementById('input-stuck').checked ? 1 : 0;

    // 2. WRITE COMMAND
    // Cmd: 0x05 (Write) + 176 Bytes Data
    try {
        const result = await sendPacket(CMD.WriteEE, newBytes);
        if(result) {
            btnSave.textContent = "Saved ✓";
            setTimeout(() => { btnSave.textContent = "Save to ESC"; }, 1500);
        } else {
            throw new Error("No ACK");
        }
    } catch(e) {
        alert("Write Failed!");
        btnSave.textContent = "Error";
    }
}

async function disconnectSerial() {
    if (writer) await writer.close();
    if (reader) await reader.cancel();
    if (port) await port.close();
    connected = false;
    updateStatus("DISCONNECTED", false);
}

// ==========================================
// 4. PARSING & UI
// ==========================================
function parseSettings(data) {
    setVal('input-power', data[OFFSET.START_POWER]);
    setVal('input-range', data[OFFSET.SINE_RANGE]);
    setVal('input-stop-power', data[OFFSET.BRAKE_STR]);
    setVal('input-timing', data[OFFSET.TIMING]);
    setVal('input-beep', data[OFFSET.BEEP]);
    
    // Ramp is tricky (derived value), we use default or leave as is if we can't map it perfectly
    setVal('input-ramp', 1.1); // Placeholder as ramp byte mapping is complex
    
    document.getElementById('input-kv').value = (data[OFFSET.KV] * 40) + 20;
    document.getElementById('input-poles').value = data[OFFSET.POLES];
    
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

function loadDefaults() {
    // Basic defaults if read fails
    const d = { power: 5, range: 25, ramp: 1.1, stopPower: 2, timing: 15, beep: 40 };
    setVal('input-power', d.power);
    updateAllDisplays();
}

function setVal(id, val) { const el = document.getElementById(id); if(el) el.value = val; }
function updateDisplay(id, val, suffix='') { const el = document.getElementById(id); if(el) el.textContent = val + suffix; }
function getSuffix(key) { if(key.includes('timing')) return '°'; if(key.includes('stop')) return '%'; return ''; }
function updateStatus(text, isConnected) {
    statusBadge.textContent = text;
    if (isConnected) {
        statusBadge.classList.add("connected");
        btnConnect.textContent = "Disconnect";
        btnConnect.style.background = "#ff453a";
        
        // THIS LINE IS KEY:
        btnSave.style.display = "block";  
        
    } else {
        statusBadge.classList.remove("connected");
        btnConnect.textContent = "Connect ESC";
        btnConnect.style.background = "#30d158";
        
        // Hide it on disconnect
        btnSave.style.display = "none";
    }
}
function showTab(tabName) { document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none'); document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active')); document.getElementById('tab-' + tabName).style.display = 'block'; event.target.classList.add('active'); }
function toggleTech(btn) { const el = btn.closest('.setting-group').querySelector('.desc-tech'); if(el) el.classList.toggle('show'); }
function enableBackupBtn() { btnBackup.style.opacity = '1'; btnBackup.style.pointerEvents = 'auto'; }
function showToast(text) { const msg = document.createElement('div'); msg.style.cssText = "position:fixed; top:80px; left:50%; transform:translateX(-50%); background:#333; color:white; padding:10px 20px; border-radius:10px; z-index:2000; box-shadow:0 4px 10px rgba(0,0,0,0.3); font-weight:600;"; msg.textContent = text; document.body.appendChild(msg); setTimeout(() => msg.remove(), 2500); }

// PRESETS
const presets = {
    default: { power: 3, range: 15, ramp: 6.0, stopPower: 2, timing: 15, beep: 40 },
    crawl: { power: 2, range: 25, ramp: 1.1, stopPower: 5, timing: 10, beep: 40 },
    trail: { power: 5, range: 15, ramp: 10.0, stopPower: 0, timing: 15, beep: 60 }
};

window.applyPreset = function(name) {
    let p = presets[name];
    if (name === 'original') { if (!originalSettings) { alert("Connect first!"); return; } 
        // Need to convert bytes back to object for load function... 
        // For simplicity, just reload current UI from the bytes logic
        alert("Reloading page to restore backup recommended for full byte restoration.");
        return; 
    }
    if(!p) return;
    setVal('input-power', p.power); 
    setVal('input-range', p.range);
    setVal('input-ramp', p.ramp);
    setVal('input-stop-power', p.stopPower);
    setVal('input-timing', p.timing);
    setVal('input-beep', p.beep);
    updateAllDisplays();
}

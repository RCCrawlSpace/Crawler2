/*
  CRAWLER COMMAND - PROTOCOL V2 (AM32 NATIVE)
  Status: PRODUCTION
  Update: Matches Bootloader C Source (Cmd 0x03/0x01, Echo Handling)
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

// COMMANDS FROM BOOTLOADER SOURCE (main.c)
const CMD = { 
    Init: 0xFD,    // CMD_KEEP_ALIVE (Safe Ping)
    ReadEE: 0x03,  // CMD_READ_FLASH_SIL (Reads Flash/EEPROM)
    WriteEE: 0x01, // CMD_PROG_FLASH (Writes Flash/EEPROM)
    SetAddr: 0xFF  // CMD_SET_ADDRESS
};

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
// 2. SERIAL PROTOCOL (ECHO AWARE)
// ==========================================
async function sendPacket(cmd, params = [], expectedDataBytes = 0) {
    const payload = [cmd, ...params];
    const crc = crc16(new Uint8Array(payload));
    const packet = new Uint8Array([...payload, (crc & 0xFF), (crc >> 8) & 0xFF]); // LSB First CRC
    
    await writer.write(packet);
    
    // READ LOOP
    // We expect: [ECHO_BYTES..., DATA_BYTES..., CRC_L, CRC_H, ACK]
    // The Echo is exactly length of 'packet'.
    // The Data is 'expectedDataBytes'.
    // The Tail is CRC(2) + ACK(1) = 3.
    // Total Expected = packet.length + expectedDataBytes + 3
    
    // For Simple Commands (Init, SetAddr):
    // Expect: [ECHO..., ACK] -> packet.length + 1
    
    const targetLength = packet.length + expectedDataBytes + (expectedDataBytes > 0 ? 3 : 1);
    
    let buffer = [];
    const start = Date.now();
    
    while (Date.now() - start < 1000) { 
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
            for(let b of value) buffer.push(b);
            
            // Check for ACK (0x30) at end
            if (buffer.length >= targetLength && buffer[buffer.length-1] === 0x30) return buffer;
            
            // Fail Fast on NACK (0xC1 or 0xC2)
            if (buffer.includes(0xC1) || buffer.includes(0xC2)) {
                console.warn(`NACK Received: ${buffer}`);
                return null;
            }
        }
    }
    // console.warn(`Timeout: Got ${buffer.length}/${targetLength}`);
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

        // 1. INIT (Keep Alive)
        console.log("Sending Init...");
        await sendPacket(CMD.Init, [0], 0);
        await new Promise(r => setTimeout(r, 100)); 

        // 2. READ LOOP (Chunked)
        console.log("Reading EEPROM...");
        let fullData = [];
        const chunkSize = 32; 
        const totalSize = 176;
        
        for(let i=0; i<totalSize; i+=chunkSize) {
            // Set Address to 0x2000 + i
            const currentAddr = 0x2000 + i;
            const addrHi = (currentAddr >> 8) & 0xFF; 
            const addrLo = currentAddr & 0xFF;        
            
            // CMD_SET_ADDRESS (0xFF)
            await sendPacket(CMD.SetAddr, [0x00, addrHi, addrLo], 0);
            await new Promise(r => setTimeout(r, 20));
            
            // CMD_READ_FLASH_SIL (0x03)
            // Packet sent: [0x03, Size, CRC]
            // Response: [0x03, Size, CRC, DATA..., CRC, ACK]
            const rawResp = await sendPacket(CMD.ReadEE, [chunkSize], chunkSize);
            
            if(!rawResp) {
                console.warn(`Chunk ${i} failed.`);
                break; 
            }
            
            // PARSE RESPONSE (Strip Echo)
            // Echo length = 4 bytes (Cmd, Size, CrcL, CrcH)
            // Data starts at index 4.
            // Data ends at length - 3 (CrcL, CrcH, Ack)
            
            const echoLen = 4;
            const dataLen = chunkSize;
            const chunkData = rawResp.slice(echoLen, echoLen + dataLen);
            
            fullData = fullData.concat(Array.from(chunkData));
            await new Promise(r => setTimeout(r, 20));
        }
        
        if (fullData.length >= 100) { 
            originalSettings = fullData;
            parseSettings(fullData);
            enableBackupBtn();
            showToast("Settings Loaded!");
        } else {
            alert("Read Incomplete. Check connection.");
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
            // Set Address
            const currentAddr = 0x2000 + i;
            const addrHi = (currentAddr >> 8) & 0xFF; 
            const addrLo = currentAddr & 0xFF;   
            await sendPacket(CMD.SetAddr, [0x00, addrHi, addrLo], 0);
            
            // Write Chunk (CMD_PROG_FLASH 0x01)
            const chunk = newBytes.slice(i, i+chunkSize);
            const res = await sendPacket(CMD.WriteEE, chunk, 0); // Write returns only ACK
            
            if(!res) throw new Error("Write failed at " + i);
            await new Promise(r => setTimeout(r, 50)); // Longer wait for Flash Write
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
        if (reader) { await reader.cancel(); reader.releaseLock(); }
        if (writer) { await writer.close(); writer.releaseLock(); }
        if (port) { await port.close(); }
    } catch(e) { console.log(e); }
    connected = false;
    updateStatus("DISCONNECTED", false);
}

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

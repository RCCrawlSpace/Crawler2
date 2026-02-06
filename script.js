/*
  CRAWLER COMMAND - TINY READER
  Status: DIAGNOSTIC
  Goal: Read just 1 byte to verify protocol integrity.
*/

let port, writer, reader, connected = false;
let originalSettings = null; 

const btnConnect = document.getElementById('btn-connect');
const btnSave = document.getElementById('btn-save');
const statusBadge = document.getElementById('status');
const btnBackup = document.getElementById('btn-backup');

const CMD = { Init: 0x30, ReadEE: 0x04, SetAddr: 0xFF };

btnConnect.addEventListener('click', handleConnection);
btnSave.addEventListener('click', () => alert("Disabled in test mode"));

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

async function sendPacket(cmd, params = []) {
    const payload = [cmd, ...params];
    const crc = crc16(new Uint8Array(payload));
    const packet = new Uint8Array([...payload, (crc & 0xFF), (crc >> 8) & 0xFF]);
    
    console.log(`>> TX: [${packet.map(b=>'0x'+b.toString(16)).join(', ')}]`);
    await writer.write(packet);
    
    // READ (Timeout 500ms)
    let buffer = [];
    const start = Date.now();
    while (Date.now() - start < 500) { 
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
            for(let b of value) buffer.push(b);
            // If we get an ACK (0x30) or any data, return it
            if (buffer.length > 0) return buffer; 
        }
    }
    return buffer.length > 0 ? buffer : null;
}

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
        console.log("--- TEST START ---");
        
        // Try simple Init
        const init = await sendPacket(CMD.Init, [0]);
        console.log("Init RX:", init ? bytesToHex(init) : "None");
        
        if (!init || init[0] !== 0x30) {
            console.warn("Init failed. Trying to proceed anyway...");
        }
        
        await new Promise(r => setTimeout(r, 100));

        // 2. SET ADDR (EEPROM Magic)
        // [CMD, 00, Hi, Lo]
        console.log("Setting Address 0x2000...");
        const addrAck = await sendPacket(CMD.SetAddr, [0x00, 0x20, 0x00]);
        console.log("Addr RX:", addrAck ? bytesToHex(addrAck) : "None");

        await new Promise(r => setTimeout(r, 100));

        // 3. READ 1 BYTE
        console.log("Reading 1 Byte...");
        const readRx = await sendPacket(CMD.ReadEE, [1]);
        console.log("Read RX:", readRx ? bytesToHex(readRx) : "None");
        
        if (readRx && readRx.length > 0) {
            alert("SUCCESS! Received: " + bytesToHex(readRx));
            // Load dummy UI so it looks nice
            loadDefaults();
        } else {
            alert("Read Timed Out.");
        }
        
    } catch (err) {
        console.error(err);
        alert("Error: " + err.message);
        await disconnectSerial();
    }
}

function bytesToHex(bytes) {
    return "[" + Array.from(bytes).map(b => '0x' + b.toString(16).toUpperCase()).join(', ') + "]";
}

async function disconnectSerial() {
    try {
        if (reader) { await reader.cancel(); reader.releaseLock(); }
        if (writer) { await writer.close(); writer.releaseLock(); }
        if (port) { await port.close(); }
    } catch(e) {}
    connected = false;
    updateStatus("DISCONNECTED", false);
}

function updateStatus(text, isConnected) {
    statusBadge.textContent = text;
    statusBadge.classList.toggle("connected", isConnected);
    btnConnect.textContent = isConnected ? "Disconnect" : "Connect ESC";
    btnConnect.style.background = isConnected ? "#ff453a" : "#30d158";
}

function loadDefaults() {
    ['power','range','ramp','stop-power','timing','beep'].forEach(key => {
        const input = document.getElementById('input-'+key);
        if(input) input.value = 5;
    });
}

function setVal(id, val) { const el = document.getElementById(id); if(el) el.value = val; }
function updateDisplay(id, val, suffix='') { const el = document.getElementById(id); if(el) el.textContent = val + suffix; }
function getSuffix(key) { if(key.includes('timing')) return '°'; if(key.includes('stop')) return '%'; return ''; }
function showTab(tabName) { document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none'); document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active')); document.getElementById('tab-' + tabName).style.display = 'block'; event.target.classList.add('active'); }
function toggleTech(btn) { const el = btn.closest('.setting-group').querySelector('.desc-tech'); if(el) el.classList.toggle('show'); }
function enableBackupBtn() { btnBackup.style.opacity = '1'; btnBackup.style.pointerEvents = 'auto'; }

window.applyPreset = function() { alert("Disabled in test mode"); }

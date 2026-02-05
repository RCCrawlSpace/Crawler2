// ==========================================
// CRAWLER COMMAND - DIAGNOSTIC DRIVER
// Version: 1.0 (Test Mode)
// ==========================================

let port, writer, reader, connected = false;
let originalSettings = null;

const btnConnect = document.getElementById('btn-connect');
const btnSave = document.getElementById('btn-save');
const statusBadge = document.getElementById('status');
const btnBackup = document.getElementById('btn-backup');

const CMD = { Init: 0x30, Exit: 0x35, ReadEE: 0x04, WriteEE: 0x05 };

// CRC16-XModem (LSB First - Matches Bootloader)
function crc16(data) {
    let crc = 0;
    for (let i = 0; i < data.length; i++) {
        let xb = data[i];
        for (let j = 0; j < 8; j++) {
            if (((xb & 0x01) ^ (crc & 0x0001)) !== 0) {
                crc = (crc >> 1) ^ 0xA001;
            } else {
                crc = crc >> 1;
            }
            xb = xb >> 1;
        }
    }
    return crc & 0xFFFF;
}

// ==========================================
// 1. SERIAL LOGIC
// ==========================================
async function sendPacket(cmd, params = []) {
    try {
        const payload = [cmd, ...params];
        const crc = crc16(new Uint8Array(payload));
        const packet = new Uint8Array([...payload, (crc & 0xFF), (crc >> 8) & 0xFF]);
        
        console.log(`>> Sending: [${packet.join(', ')}]`);
        await writer.write(packet);
        
        // READ LOOP (Wait for ACK/Data)
        // We read byte-by-byte to catch the response
        // Bootloader should reply with ACK (0x30) + CRC (2 bytes) = 3 bytes total for Init
        const responseBuffer = [];
        const readStart = Date.now();
        
        while (Date.now() - readStart < 500) { // 500ms timeout
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
                for(let byte of value) responseBuffer.push(byte);
                // If we get an ACK (0x30), we are good
                if (responseBuffer.includes(0x30)) {
                    console.log(`<< Received: [${responseBuffer.join(', ')}]`);
                    return true;
                }
            }
        }
        console.warn(`<< Timeout/No ACK: [${responseBuffer.join(', ')}]`);
        return false;
    } catch(e) {
        console.error("Write Error:", e);
        return false;
    }
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

        // --- DIAGNOSTIC PROBE ---
        console.log("--- STARTING HANDSHAKE ---");
        const success = await sendPacket(CMD.Init, [0]); // Send 0x30 Init
        
        if (success) {
            console.log("✅ SUCCESS: Chip Responded!");
            alert("Connection Successful! Check Console logs.");
        } else {
            console.log("❌ FAILED: No ACK received.");
            alert("Connected, but no ACK. Check Console.");
        }
        // ------------------------

        // Load Defaults so UI isn't blank
        loadSettings(presets.default);
        
    } catch (err) {
        alert("Connect Error: " + err);
        await disconnectSerial();
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

// ==========================================
// UI BINDINGS
// ==========================================
btnConnect.addEventListener('click', handleConnection);
btnSave.addEventListener('click', () => alert("Save disabled in Test Mode"));

function updateStatus(text, isConnected) {
    statusBadge.textContent = text;
    statusBadge.classList.toggle("connected", isConnected);
    btnConnect.textContent = isConnected ? "Disconnect" : "Connect ESC";
    btnConnect.style.background = isConnected ? "#ff453a" : "#30d158";
}

function loadSettings(settings) {
    // Basic loader to keep UI alive
    ['power','range','ramp','stop-power','timing','beep'].forEach(key => {
        const el = document.getElementById('input-'+key);
        if(el) el.value = settings[key.replace('-power','StopPower')] || 5; 
        // Note: Logic simplified for diagnostic file
    });
}

const presets = { default: { power: 5, range: 25, ramp: 1.1, stopPower: 2, timing: 15, beep: 40 } };

['power','range','ramp','stop-power','timing','beep'].forEach(key => {
    const input = document.getElementById('input-'+key);
    if(input) input.addEventListener('input', e => {
        const disp = document.getElementById('val-'+key);
        if(disp) disp.textContent = e.target.value;
    });
});

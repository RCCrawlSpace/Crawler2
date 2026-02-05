// === VARIABLES ===
let port;
let writer;
let reader;
let connected = false;
let originalSettings = null;

const btnConnect = document.getElementById('btn-connect');
const btnSave = document.getElementById('btn-save');
const statusBadge = document.getElementById('status');
const btnBackup = document.getElementById('btn-backup');

// === MOCK DATA FOR DEMO ===
const mockESCSettings = {
    power: 5, range: 25, ramp: 1.1, stopPower: 2, timing: 15, beep: 40,
    kv: 2000, poles: 14, brakeOnStop: true, reverse: false,
    compPwm: true, varPwm: false, stallProt: true, stuckProt: true
};

// === EVENT LISTENERS ===
btnConnect.addEventListener('click', handleConnection);
btnSave.addEventListener('click', handleSave);

['power','range','ramp','stop-power','timing','beep'].forEach(key => {
    const input = document.getElementById('input-'+key);
    if(input) input.addEventListener('input', e => {
        updateDisplay('val-'+key, e.target.value, getSuffix(key));
    });
});

// === FUNCTIONS ===
async function handleConnection() {
    if (connected) {
        // DISCONNECT LOGIC
        if (reader) try { await reader.cancel(); } catch(e){}
        if (writer) try { await writer.close(); } catch(e){}
        if (port) try { await port.close(); } catch(e){}
        connected = false;
        updateStatus("DISCONNECTED", false);
        return;
    }

    // CONNECT LOGIC
    if ("serial" in navigator) {
        try {
            port = await navigator.serial.requestPort();
            await port.open({ baudRate: 115200 });
            
            connected = true;
            updateStatus("CONNECTED", true);

            // SIMULATED READ (Replace with real MSP calls)
            loadSettings(mockESCSettings);
            
            // Show Backup Toast
            if(!originalSettings) {
                originalSettings = JSON.parse(JSON.stringify(mockESCSettings));
                enableBackupBtn();
                showToast("Backup Created!");
            }
            
        } catch (err) {
            console.error(err);
            alert("Connection Error: " + err.message);
        }
    } else {
        alert("Browser not supported. Use Chrome.");
    }
}

function handleSave() {
    const originalText = btnSave.textContent;
    btnSave.textContent = "Saving...";
    setTimeout(() => {
        btnSave.textContent = "Saved ✓";
        setTimeout(() => { btnSave.textContent = originalText; }, 1500);
    }, 800);
}

function updateStatus(text, isConnected) {
    statusBadge.textContent = text;
    if (isConnected) {
        statusBadge.classList.add("connected");
        btnConnect.textContent = "Disconnect";
        btnConnect.style.background = "#ff453a";
        btnSave.style.display = "block";
    } else {
        statusBadge.classList.remove("connected");
        btnConnect.textContent = "Connect ESC";
        btnConnect.style.background = "#30d158";
        btnSave.style.display = "none";
    }
}

function loadSettings(settings) {
    setVal('input-power', settings.power);
    setVal('input-range', settings.range);
    setVal('input-ramp', settings.ramp);
    setVal('input-stop-power', settings.stopPower);
    setVal('input-timing', settings.timing);
    setVal('input-beep', settings.beep);
    document.getElementById('input-kv').value = settings.kv;
    document.getElementById('input-poles').value = settings.poles;
    document.getElementById('input-brakeOnStop').checked = settings.brakeOnStop;
    document.getElementById('input-reverse').checked = settings.reverse;
    document.getElementById('input-comp-pwm').checked = settings.compPwm;
    document.getElementById('input-var-pwm').checked = settings.varPwm;
    document.getElementById('input-stall').checked = settings.stallProt;
    document.getElementById('input-stuck').checked = settings.stuckProt;
    
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
    default: { power: 3, range: 15, ramp: 6.0, stopPower: 2, timing: 15, beep: 40 },
    crawl: { power: 2, range: 25, ramp: 1.1, stopPower: 5, timing: 10, beep: 40 },
    trail: { power: 5, range: 15, ramp: 10.0, stopPower: 0, timing: 15, beep: 60 }
};

window.applyPreset = function(name) {
    let p = presets[name];
    if (name === 'original') { if (!originalSettings) { alert("Connect first!"); return; } p = originalSettings; }
    if(!p) return;
    setVal('input-power', p.power); updateDisplay('val-power', p.power);
    setVal('input-range', p.range); updateDisplay('val-range', p.range);
    setVal('input-ramp', p.ramp); updateDisplay('val-ramp', p.ramp);
    setVal('input-stop-power', p.stopPower); updateDisplay('val-stop-power', p.stopPower, '%');
    setVal('input-timing', p.timing); updateDisplay('val-timing', p.timing, '°');
    setVal('input-beep', p.beep); updateDisplay('val-beep', p.beep);
    const btn = event.currentTarget; const oldBorder = btn.style.borderColor; btn.style.borderColor = 'var(--accent-color)'; setTimeout(() => { btn.style.borderColor = oldBorder; }, 500);
}
// --- 变量与配置初始化 ---
let serverList = [];
const DEFAULT_URLS = [{ url: '', pass: '', remaining: null, lastUpdated: 0 }];
// 已删除 CACHE_TIMEOUT，改为日期比对逻辑
const MAX_RETRIES = 8;               
let isUserSelecting = false;         

const elements = {
    urlSelect: document.getElementById('url-select'),
    pasteArea: document.getElementById('paste-area'),
    newUrlInput: document.getElementById('new-url'),
    newPassInput: document.getElementById('new-pass'),
    addBtn: document.getElementById('add-btn'),
    delBtn: document.getElementById('del-btn'),
    exportBtn: document.getElementById('export-btn'),
    importBtn: document.getElementById('import-btn'),
    importFile: document.getElementById('import-file'),
    resultDiv: document.getElementById('result'),
    manageBox: document.getElementById('manage-box'),
    toggleManage: document.getElementById('toggle-manage'),
    fileInput: document.getElementById('file-input'),
    capInfo: document.getElementById('cap-info')
};

// --- 工具函数 ---

/**
 * 判断两个时间戳是否在同一个自然日
 */
function isSameDay(t1, t2) {
    if (!t1 || !t2) return false;
    const d1 = new Date(t1);
    const d2 = new Date(t2);
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}

function getTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function refreshUI(forceShowCapacity = null) {
    const currentUrl = elements.urlSelect.value;
    const showCap = forceShowCapacity !== null ? forceShowCapacity : isUserSelecting;
    
    elements.urlSelect.innerHTML = '';
    serverList.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.url;
        let label = item.url.replace(/^https?:\/\//, '');
        if (showCap && item.remaining && item.remaining !== "Err") {
            label += ` (${item.remaining}MB)`;
        }
        opt.innerText = label;
        if (item.url === currentUrl) opt.selected = true;
        elements.urlSelect.appendChild(opt);
    });

    const currentItem = serverList.find(s => s.url === currentUrl);
    if (currentItem && currentItem.remaining !== null) {
        elements.capInfo.innerText = currentItem.remaining + (currentItem.remaining === "Err" ? "" : " MB");
        elements.capInfo.style.color = parseFloat(currentItem.remaining) < 5 ? "#e74c3c" : "#27ae60";
    } else {
        elements.capInfo.innerText = "-- MB";
        elements.capInfo.style.color = "#666";
    }
}

function saveData() {
    chrome.storage.sync.set({ 
        serverList: serverList.map(s => ({
            url: s.url, pass: s.pass, remaining: s.remaining, lastUpdated: s.lastUpdated
        })),
        lastUsedUrl: elements.urlSelect.value
    });
}

// --- 上传核心逻辑 ---

async function uploadWithRetry(file, config, fileName, attempt = 1) {
    const formData = new FormData();
    formData.append('f', file, fileName);
    formData.append('up', '1');
    formData.append('api', '1');
    if (config?.pass) formData.append('mypass', config.pass);

    try {
        elements.pasteArea.innerText = `上传中 (尝试 ${attempt}/${MAX_RETRIES})...`;
        const resp = await fetch(config.url, { method: 'POST', body: formData, credentials: 'include' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch (e) {
        if (attempt < MAX_RETRIES) return await uploadWithRetry(file, config, fileName, attempt + 1);
        throw e;
    }
}

async function processUpload(file, isClipboard = false) {
    if (!file) return;
    const currentUrl = elements.urlSelect.value;
    const config = serverList.find(s => s.url === currentUrl);
    
    const finalFileName = isClipboard ? `clip_${getTimestamp()}.png` : (file.name || `file_${getTimestamp()}.png`);

    elements.resultDiv.style.display = 'none';

    try {
        const data = await uploadWithRetry(file, config, finalFileName);
        if (data.status === 'success') {
            elements.pasteArea.innerText = "上传成功！";
            navigator.clipboard.writeText(data.url);
            
            elements.resultDiv.style.display = 'block';
            elements.resultDiv.innerHTML = `
                <div style="margin-bottom:5px; color:#27ae60; font-weight:bold;">已复制地址：</div>
                <input type="text" readonly value="${data.url}" 
                       style="width:100%; padding:6px; border:1px solid #91d5ff; border-radius:4px; background:#fff; font-size:12px;"
                       onclick="this.select()">
                <div style="margin-top:6px; text-align:right;">
                    <a href="${data.url}" target="_blank" style="color:#1890ff; text-decoration:none; font-size:11px;">在新窗口打开 &raquo;</a>
                </div>
            `;
            
            if (data.remaining !== undefined) {
                config.remaining = data.remaining;
                config.lastUpdated = Date.now();
                refreshUI();
                saveData();
            }
        } else {
            throw new Error(data.message || "未知错误");
        }
    } catch (e) {
        alert(`上传失败: ` + e.message);
        elements.pasteArea.innerText = "点击或粘贴图片重试";
    }
}

// --- 备份与导入逻辑 ---

function exportConfigs() {
    const dataStr = JSON.stringify(serverList, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `uploader_config_${getTimestamp()}.json`;
    link.click();
    URL.revokeObjectURL(url);
}

function importConfigs(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const imported = JSON.parse(event.target.result);
            if (Array.isArray(imported)) {
                serverList = imported;
                saveData();
                refreshUI();
                alert("导入成功！已更新服务器列表。");
            }
        } catch (err) {
            alert("导入失败，请检查文件格式。");
        }
    };
    reader.readAsText(file);
}

// --- 网络请求与重试逻辑 ---

async function fetchStatusWithRetry(item, index, attempt = 1) {
    try {
        const apiUri = `${item.url}${item.url.includes('?') ? '&' : '?'}status=1&api=1&mypass=${encodeURIComponent(item.pass)}`;
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 5000); 
        
        const resp = await fetch(apiUri, { signal: controller.signal, credentials: 'include' });
        clearTimeout(id);
        
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        
        const data = await resp.json();
        if (data.status === 'success') {
            serverList[index].remaining = data.remaining;
            serverList[index].lastUpdated = Date.now();
        } else {
            throw new Error(data.message || "API返回异常");
        }
    } catch (e) {
        if (attempt < MAX_RETRIES) {
            return await fetchStatusWithRetry(item, index, attempt + 1);
        }
        serverList[index].remaining = "Err";
    }
}

async function fetchAllStatuses() {
    const promises = serverList.map((item, index) => fetchStatusWithRetry(item, index));
    await Promise.allSettled(promises);
    refreshUI();
    saveData();
}

async function init() {
    const data = await chrome.storage.sync.get(['serverList', 'lastUsedUrl']);
    serverList = data.serverList || DEFAULT_URLS;
    if (data.lastUsedUrl) {
        const tempOpt = document.createElement('option');
        tempOpt.value = data.lastUsedUrl;
        elements.urlSelect.appendChild(tempOpt);
        elements.urlSelect.value = data.lastUsedUrl;
    }
    refreshUI(false); 
    
    // 修改处：检测当天日期
    const now = Date.now();
    // 如果任何一个服务器从未更新过，或者更新日期不是今天，则触发全局刷新
    if (serverList.some(s => !s.lastUpdated || !isSameDay(s.lastUpdated, now))) {
        fetchAllStatuses();
    }
    
    elements.pasteArea.focus();
}

// --- 事件绑定 ---

elements.urlSelect.addEventListener('mousedown', () => { isUserSelecting = true; refreshUI(true); });
elements.urlSelect.addEventListener('change', () => { isUserSelecting = false; refreshUI(false); saveData(); });
elements.urlSelect.addEventListener('blur', () => { isUserSelecting = false; refreshUI(false); });

elements.toggleManage.addEventListener('click', () => {
    elements.manageBox.style.display = elements.manageBox.style.display === 'block' ? 'none' : 'block';
});

elements.addBtn.addEventListener('click', () => {
    const url = elements.newUrlInput.value.trim();
    if (!url) return;
    const idx = serverList.findIndex(s => s.url === url);
    const pass = elements.newPassInput.value.trim();
    if (idx !== -1) {
        serverList[idx].pass = pass;
        serverList[idx].lastUpdated = 0;
    } else {
        serverList.push({ url, pass, remaining: null, lastUpdated: 0 });
    }
    elements.urlSelect.value = url;
    saveData();
    refreshUI(false);
    fetchAllStatuses();
});

elements.delBtn.addEventListener('click', () => {
    if (serverList.length <= 1) return alert("请保留至少一个配置");
    serverList = serverList.filter(s => s.url !== elements.urlSelect.value);
    saveData();
    init();
});

elements.exportBtn.addEventListener('click', exportConfigs);
elements.importBtn.addEventListener('click', () => elements.importFile.click());
elements.importFile.addEventListener('change', importConfigs);

elements.pasteArea.addEventListener('paste', e => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let i of items) if (i.type.indexOf('image') !== -1) processUpload(i.getAsFile(), true);
});

elements.pasteArea.addEventListener('click', () => elements.fileInput.click());
elements.fileInput.addEventListener('change', () => {
    if (elements.fileInput.files[0]) processUpload(elements.fileInput.files[0], false);
});

init();
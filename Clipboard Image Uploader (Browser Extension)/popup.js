let serverList = [];
const DEFAULT_URLS = [{ url: '', pass: '', remaining: null }];
const MAX_RETRIES = 5;               
let isUserSelecting = false;         

const elements = {
    urlSelect: document.getElementById('url-select'),
    visitLink: document.getElementById('visit-link'),
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

// 通用复制函数：解决异步后 navigator.clipboard 可能失效的问题
async function copyToClipboard(text) {
    try {
        // 尝试现代 API
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        // 降级方案：使用 textarea 复制
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            document.body.removeChild(textArea);
            return true;
        } catch (e) {
            document.body.removeChild(textArea);
            return false;
        }
    }
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
        serverList: serverList.map(s => ({ url: s.url, pass: s.pass, remaining: s.remaining })),
        lastUsedUrl: elements.urlSelect.value
    });
}

// --- 核心逻辑 ---

async function processUpload(file, isClipboard = false) {
    if (!file) return;
    const config = serverList.find(s => s.url === elements.urlSelect.value);
    if (!config || !config.url) return alert("请先配置服务器 URL");

    const finalFileName = isClipboard ? `clip_${getTimestamp()}.png` : (file.name || `file_${getTimestamp()}.png`);
    elements.resultDiv.style.display = 'none';

    async function upload(attempt = 1) {
        const formData = new FormData();
        formData.append('f', file, finalFileName);
        formData.append('up', '1');
        formData.append('api', '1');
        if (config?.pass) formData.append('mypass', config.pass);

        try {
            elements.pasteArea.innerText = `上传中 (${attempt}/${MAX_RETRIES})...`;
            const resp = await fetch(config.url, { method: 'POST', body: formData, credentials: 'include' });
            const data = await resp.json();
            
            if (data.status === 'success') {
                elements.pasteArea.innerText = "上传成功！点击或粘贴继续";
                
                // 自动复制到剪切板
                await copyToClipboard(data.url);

                elements.resultDiv.style.display = 'block';
                elements.resultDiv.innerHTML = `
                    <div style="color:#27ae60;font-weight:bold;">上传完成（已自动复制）：</div>
                    <div id="url-text" style="word-break:break-all; background:#fff; padding:5px; border:1px solid #eee; margin-top:5px;">${data.url}</div>
                `;
                
                // 给结果框绑定点击即复制
                elements.resultDiv.onclick = async () => {
                    if(await copyToClipboard(data.url)) {
                        const originalText = elements.resultDiv.innerHTML;
                        elements.resultDiv.innerText = "已再次复制到剪切板！";
                        setTimeout(() => elements.resultDiv.innerHTML = originalText, 1000);
                    }
                };

                if (data.remaining !== undefined) {
                    config.remaining = data.remaining;
                    chrome.storage.sync.set({ lastRefreshDate: Date.now() });
                    refreshUI();
                    saveData();
                }
            } else throw new Error(data.message);
        } catch (e) {
            if (attempt < MAX_RETRIES) return upload(attempt + 1);
            alert("上传失败: " + e.message);
            elements.pasteArea.innerText = "点击或粘贴重试";
        }
    }
    upload();
}

// --- 初始化与事件 ---

async function init() {
    const data = await chrome.storage.sync.get(['serverList', 'lastUsedUrl', 'lastRefreshDate']);
    serverList = data.serverList || DEFAULT_URLS;
    if (data.lastUsedUrl) {
        const tempOpt = document.createElement('option');
        tempOpt.value = data.lastUsedUrl;
        elements.urlSelect.appendChild(tempOpt);
        elements.urlSelect.value = data.lastUsedUrl;
    }
    refreshUI(false); 
    elements.pasteArea.focus();
}

// 监听粘贴事件：改为监听 document 确保随时可用
document.addEventListener('paste', e => {
    // 防止 contenteditable 真的填入文字
    setTimeout(() => { elements.pasteArea.innerHTML = "点击此处或粘贴图片"; }, 10);
    
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let i of items) {
        if (i.type.indexOf('image') !== -1) {
            processUpload(i.getAsFile(), true);
            return;
        }
    }
});

// 点击粘贴区域触发文件选择
elements.pasteArea.addEventListener('click', (e) => {
    // 如果是因为 contenteditable 聚焦，不触发文件选择，除非是明确的鼠标点击
    if (e.detail > 0) elements.fileInput.click();
});

elements.fileInput.addEventListener('change', () => {
    if (elements.fileInput.files[0]) {
        processUpload(elements.fileInput.files[0], false);
        // 清空选择，方便下次选同一个文件
        elements.fileInput.value = '';
    }
});

elements.visitLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (elements.urlSelect.value) window.open(elements.urlSelect.value, '_blank');
});

elements.addBtn.addEventListener('click', async () => {
    const url = elements.newUrlInput.value.trim();
    const pass = elements.newPassInput.value.trim();
    if (!url) return;
    const idx = serverList.findIndex(s => s.url === url);
    if (idx !== -1) {
        serverList[idx].pass = pass;
        alert("配置已更新");
    } else {
        serverList.push({ url, pass, remaining: null });
        alert("服务器已添加");
    }
    elements.urlSelect.value = url;
    saveData();
    refreshUI(false);
});

elements.urlSelect.addEventListener('mousedown', () => { isUserSelecting = true; refreshUI(true); });
elements.urlSelect.addEventListener('change', () => { isUserSelecting = false; refreshUI(false); saveData(); });
elements.urlSelect.addEventListener('blur', () => { isUserSelecting = false; refreshUI(false); });
elements.toggleManage.addEventListener('click', () => elements.manageBox.style.display = elements.manageBox.style.display === 'block' ? 'none' : 'block');
elements.delBtn.addEventListener('click', () => {
    if (serverList.length <= 1) return alert("请保留至少一个配置");
    serverList = serverList.filter(s => s.url !== elements.urlSelect.value);
    saveData();
    init();
});

init();
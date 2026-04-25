// ==UserScript==
// @name         图床上传助手 (增强容量显示版)
// @namespace    https://image.demo.xyz/
// @version      2.7.1
// @description  解决下拉闪退问题。左键选择，右键新窗口访问。支持列表内实时容量显示。
// @author       Gemini
// @match        *://www.nodeseek.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      *
// @license      MIT
// ==/UserScript==

(() => {
    'use strict';

    const STORAGE_KEY = 'imgbed_configs';
    const ACTIVE_INDEX_KEY = 'imgbed_active_idx';
    const COUNTER_KEY = 'imgbed_refresh_counter';
    const CONTAINER_ID = 'imgbed-upload-toolbar-container';

    const MAX_RETRIES = 8;
    const REFRESH_THRESHOLD = 25;

    let rawConfigs = GM_getValue(STORAGE_KEY, []);
    if (!Array.isArray(rawConfigs)) rawConfigs = [];

    const STATE = {
        configs: rawConfigs,
        activeIndex: GM_getValue(ACTIVE_INDEX_KEY, 0),
        refreshCounter: GM_getValue(COUNTER_KEY, 0)
    };

    const SELECTORS = {
        editor: '.CodeMirror',
        toolbar: '.mde-toolbar',
        imgBtn: '.toolbar-item.i-icon.i-icon-pic[title="图片"]',
    };

    GM_addStyle(`
        #imgbed-upload-status { margin-left: 5px; font-size: 13px; height: 28px; line-height: 28px; cursor: pointer; display: inline-block; color: #42d392; font-weight: bold; }
        #imgbed-capacity { font-size: 11px; color: #888; margin: 0 5px; min-width: 50px; text-align: center; font-family: monospace; cursor: help; }
        .imgbed-config-area { margin-left: 10px; display: inline-flex; align-items: center; gap: 2px; vertical-align: middle; }
        .imgbed-select { font-size: 12px; padding: 2px 5px; border-radius: 4px; border: 1px solid #ddd; background: #fff; max-width: 180px; height: 24px; outline: none; cursor: pointer; position: relative; z-index: 100; }
        .imgbed-select:hover { border-color: #42d392; }
        #imgbed-config-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border: 1px solid #ccc; padding: 25px; z-index: 10001; border-radius: 12px; box-shadow: 0 15px 40px rgba(0,0,0,0.3); width: 420px; display: none; }
        .cfg-section { margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 15px; }
        .cfg-title { font-weight: bold; margin-bottom: 10px; color: #333; font-size: 14px; }
        .cfg-input-group { display: flex; flex-direction: column; gap: 8px; }
        .cfg-input { padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; outline:none; }
        .cfg-btn-row { display: flex; gap: 10px; margin-top: 10px; }
        .primary-btn { background: #2c3e50; color: #fff; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer; font-size: 13px; flex: 1; }
        .secondary-btn { background: #f8f9fa; border: 1px solid #ddd; padding: 8px 15px; border-radius: 4px; cursor: pointer; font-size: 13px; flex: 1; }
        .danger-btn { color: #e74c3c; border: none; background: none; cursor: pointer; font-size: 12px; margin-top: 10px; width: 100%; text-align: left; }
    `);

    const Utils = {
        saveAll: () => {
            GM_setValue(STORAGE_KEY, STATE.configs);
            GM_setValue(ACTIVE_INDEX_KEY, STATE.activeIndex);
            GM_setValue(COUNTER_KEY, STATE.refreshCounter);
        },
        fetchWithRetry: (options, retries = MAX_RETRIES) => {
            return new Promise((resolve, reject) => {
                const attempt = (n) => {
                    GM_xmlhttpRequest({
                        ...options,
                        onload: (res) => {
                            if (res.status === 200 && res.response?.status === 'success') {
                                resolve(res.response);
                            } else {
                                if (n > 1) attempt(n - 1);
                                else reject(res.response?.message || `失败(HTTP:${res.status})`);
                            }
                        },
                        onerror: () => {
                            if (n > 1) attempt(n - 1);
                            else reject("网络错误");
                        }
                    });
                };
                attempt(retries);
            });
        },
        getDomain: (url) => url.replace(/^https?:\/\//, '').split('/')[0]
    };

    const UI = {
        // 更新下拉列表里特定索引的文字显示
        updateOptionText: (index) => {
            const select = document.querySelector('.imgbed-select');
            if (!select || !select.options[index]) return;
            const cfg = STATE.configs[index];
            const domain = Utils.getDomain(cfg.url);
            const capText = cfg.remaining ? ` (${cfg.remaining}MB)` : ' (...)';
            select.options[index].text = `${domain}${capText}`;
        },

        refreshCapacity: async (force = false) => {
            const capEl = document.getElementById('imgbed-capacity');
            if (!capEl || STATE.configs.length === 0) return;

            const cfg = STATE.configs[STATE.activeIndex];
            if (!cfg) return;

            STATE.refreshCounter++;
            const shouldFetch = force || STATE.refreshCounter >= REFRESH_THRESHOLD || !cfg.remaining;

            if (!shouldFetch) {
                capEl.textContent = `${cfg.remaining || '--'} MB`;
                UI.updateOptionText(STATE.activeIndex); // 同步更新列表文字
                Utils.saveAll();
                return;
            }

            capEl.textContent = '...';
            try {
                const res = await Utils.fetchWithRetry({
                    method: 'GET',
                    url: `${cfg.url}?api=1&status=1&mypass=${cfg.pass}`,
                    responseType: 'json'
                });
                cfg.remaining = res.remaining;
                STATE.refreshCounter = 0;
                Utils.saveAll();
                capEl.textContent = `${res.remaining} MB`;
                UI.updateOptionText(STATE.activeIndex); // 成功后更新列表文字
            } catch (err) {
                capEl.textContent = 'ERR';
            }
        },

        setupToolbar: () => {
            const toolbar = document.querySelector(SELECTORS.toolbar);
            if (!toolbar || document.getElementById(CONTAINER_ID)) return;

            const container = document.createElement('div');
            container.id = CONTAINER_ID;
            container.className = 'imgbed-config-area';

            const select = document.createElement('select');
            select.className = 'imgbed-select';

            const stopPropagation = (e) => e.stopPropagation();
            select.addEventListener('mousedown', stopPropagation);
            select.addEventListener('click', stopPropagation);
            select.addEventListener('mouseup', stopPropagation);

            if (STATE.configs.length === 0) {
                select.add(new Option("请先配置", 0));
            } else {
                STATE.configs.forEach((cfg, i) => {
                    const domain = Utils.getDomain(cfg.url);
                    // 初始化时就带上容量信息（如果有缓存）
                    const capSuffix = cfg.remaining ? ` (${cfg.remaining}MB)` : '';
                    const opt = new Option(`${domain || `线路${i+1}`}${capSuffix}`, i);
                    if (i === STATE.activeIndex) opt.selected = true;
                    select.add(opt);
                });
            }

            select.onchange = (e) => {
                STATE.activeIndex = parseInt(e.target.value);
                Utils.saveAll();
                UI.refreshCapacity(false);
            };

            select.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const cfg = STATE.configs[STATE.activeIndex];
                if (cfg && cfg.url) window.open(cfg.url.split('?')[0], '_blank');
            };

            const capacityEl = document.createElement('span');
            capacityEl.id = 'imgbed-capacity';
            capacityEl.textContent = '-- MB';

            const statusEl = document.createElement('div');
            statusEl.id = 'imgbed-upload-status';
            statusEl.textContent = '图床配置';
            statusEl.onclick = e => {
                e.stopPropagation();
                document.getElementById('imgbed-config-modal').style.display = 'block';
            };

            container.appendChild(select);
            container.appendChild(capacityEl);
            container.appendChild(statusEl);
            toolbar.appendChild(container);

            UI.refreshCapacity(false);

            const imgBtn = toolbar.querySelector(SELECTORS.imgBtn);
            if (imgBtn && !imgBtn.dataset.hooked) {
                const newBtn = imgBtn.cloneNode(true);
                newBtn.dataset.hooked = "true";
                imgBtn.parentNode.replaceChild(newBtn, imgBtn);
                newBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: 'image/*' });
                    input.onchange = ev => ImageHandler.handleFiles([...ev.target.files]);
                    input.click();
                });
            }
        },

        initModal: () => {
            if (document.getElementById('imgbed-config-modal')) return;
            const html = `
                <div id="imgbed-config-modal">
                    <div class="cfg-section">
                        <div class="cfg-title">添加服务器</div>
                        <div class="cfg-input-group">
                            <input type="text" id="cfg-new-url" class="cfg-input" placeholder="index.php 完整 URL">
                            <input type="password" id="cfg-new-pass" class="cfg-input" placeholder="访问密码">
                            <button id="btn-add-single" class="primary-btn">保存并强制刷新</button>
                        </div>
                    </div>
                    <div class="cfg-section">
                        <div class="cfg-title">备份与恢复</div>
                        <div class="cfg-btn-row">
                            <button id="btn-export" class="secondary-btn">导出 JSON</button>
                            <button id="btn-import-trigger" class="secondary-btn">导入 JSON</button>
                            <input type="file" id="cfg-file-input" style="display:none" accept=".json">
                        </div>
                        <button id="btn-clear-all" class="danger-btn">⚠ 清空所有数据</button>
                    </div>
                    <div style="text-align:right">
                        <button id="btn-close-modal" style="cursor:pointer; border:none; background:none; color:#666;">[ 关闭 ]</button>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', html);
            document.getElementById('btn-close-modal').onclick = () => document.getElementById('imgbed-config-modal').style.display = 'none';

            document.getElementById('btn-add-single').onclick = async () => {
                const url = document.getElementById('cfg-new-url').value.trim();
                const pass = document.getElementById('cfg-new-pass').value.trim();
                if (!url) return alert("URL 不能为空");
                const existIdx = STATE.configs.findIndex(c => c.url === url);
                if (existIdx > -1) STATE.configs[existIdx].pass = pass;
                else STATE.configs.push({ url, pass, remaining: null });
                Utils.saveAll();
                await UI.refreshCapacity(true);
                location.reload();
            };

            document.getElementById('btn-export').onclick = () => {
                const blob = new Blob([JSON.stringify(STATE.configs, null, 2)], { type: 'application/json' });
                const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `imgbed_configs.json` });
                a.click();
            };

            document.getElementById('btn-import-trigger').onclick = () => document.getElementById('cfg-file-input').click();
            document.getElementById('cfg-file-input').onchange = (e) => {
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    try {
                        const imported = JSON.parse(ev.target.result);
                        if (Array.isArray(imported)) {
                            STATE.configs = imported;
                            Utils.saveAll();
                            await UI.refreshCapacity(true);
                            location.reload();
                        }
                    } catch (err) { alert("导入失败"); }
                };
                reader.readAsText(e.target.files[0]);
            };

            document.getElementById('btn-clear-all').onclick = () => {
                if (confirm("确定要清空吗？")) {
                    GM_setValue(STORAGE_KEY, []);
                    GM_setValue(COUNTER_KEY, 0);
                    location.reload();
                }
            };
        }
    };

    const ImageHandler = {
        uploadImage: async (file) => {
            if (STATE.configs.length === 0) throw "请先配置图床";
            const cfg = STATE.configs[STATE.activeIndex] || STATE.configs[0];
            const formData = new FormData();
            formData.append('f', file);
            formData.append('up', '1');

            const res = await Utils.fetchWithRetry({
                method: 'POST',
                url: `${cfg.url}?api=1&mypass=${cfg.pass}`,
                data: formData,
                responseType: 'json'
            });

            await UI.refreshCapacity(true);
            return `![${file.name.replace(/\.[^.]+$/, '')}](${res.url})`;
        },

        handleFiles: files => {
            files.filter(f => f.type.startsWith('image/')).forEach(async file => {
                const status = document.getElementById('imgbed-upload-status');
                if (status) status.textContent = "上传中(重试中)...";
                try {
                    const md = await ImageHandler.uploadImage(file);
                    const cm = document.querySelector(SELECTORS.editor)?.CodeMirror;
                    if (cm) cm.replaceRange(`\n${md}\n`, cm.getCursor());
                    if (status) status.textContent = "上传成功";
                    setTimeout(() => { if(status) status.textContent = "图床配置"; }, 2000);
                } catch (err) {
                    alert("最终失败: " + err);
                    if (status) status.textContent = "图床配置";
                }
            });
        }
    };

    const init = () => {
        UI.initModal();
        document.addEventListener('paste', e => {
            if (document.activeElement?.closest('.CodeMirror')) {
                const files = Array.from(e.clipboardData.files);
                if (files.length) { e.preventDefault(); ImageHandler.handleFiles(files); }
            }
        });

        const observer = new MutationObserver(() => {
            if (!document.getElementById(CONTAINER_ID)) {
                UI.setupToolbar();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        UI.setupToolbar();
    };

    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
})();
// MV3 service worker 改造 (2026-06-14):
// 1. service worker 没有 window，不能用 window.localStorage，改用 chrome.storage.local
// 2. service worker 会被随时终止，sharedData 不能放内存里，必须用 storage API
// 3. service worker onMessage 改用 async/await + sendResponse 异步
// 4. 文件名仍是 background.js（manifest 里 service_worker 配置项）

// 版本标识 (2026-06-15): 启动时 log, 方便确认 Chrome 是否加载了新版本
const EXT_VERSION = '3.1.0-mv3';
console.log('[background] ' + EXT_VERSION + ' service worker started');

// 初始化默认配置
const DEFAULT_CONFIG = {
    num: '10',
    folderPort: '',
    filePath: '',
    destination: ''
};

// 从 chrome.storage 读取 sharedData
async function getSharedData() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['num', 'folderPort', 'filePath', 'destination'], (data) => {
            resolve({
                num: data.num || DEFAULT_CONFIG.num,
                folderPort: data.folderPort || DEFAULT_CONFIG.folderPort,
                filePath: data.filePath || DEFAULT_CONFIG.filePath,
                destination: data.destination || DEFAULT_CONFIG.destination
            });
        });
    });
}

// 保存 sharedData
async function setSharedData(data) {
    return new Promise((resolve) => {
        chrome.storage.local.set({
            num: data.num,
            folderPort: data.folderPort,
            filePath: data.filePath,
            destination: data.destination
        }, () => resolve());
    });
}

// 监听来自 content_scripts (autoDownload.js) 和 popup (popup.js) 的消息
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    // 处理 async 流程
    handleMessage(request, sender).then(sendResponse).catch((e) => {
        console.error('[background] message handler error:', e);
        sendResponse({success: false, error: e.message});
    });
    // 返回 true 表示 sendResponse 会异步调用
    return true;
});

async function handleMessage(request, sender) {
    if (request.action === "pageDatas") {
        // popup 推送新配置
        const {num, folderPort, filePath} = request.value;
        const destination = (filePath || '') + (folderPort || '');
        await setSharedData({num, folderPort, filePath, destination});
        console.log('[background] 保存 popup 配置:', destination, num);
        // 通知所有 YouTube tabs
        const tabs = await chrome.tabs.query({url: 'https://www.youtube.com/*'});
        for (const tab of tabs) {
            try {
                await chrome.tabs.sendMessage(tab.id, {
                    action: 'updateDestination',
                    sharedData: {num, folderPort, destination}
                });
            } catch (e) {
                // tab 可能已关闭，忽略
            }
        }
        return {success: true};
    }
    if (request.action === "getSharedData") {
        const data = await getSharedData();
        console.log('[background] 返回 sharedData:', data);
        return data;
    }
    if (request.action === "openDownieUrl") {
        // E5-D 改造 (2026-06-16): 主路径也走 fetch 9090, 不走 chrome.tabs.create
        //
        // 背景: E5-C 只改了 autoDownload.js 兑底路径, 主路径 (本 handler) 仍调
        //   chrome.tabs.create({url: downie://XUOpenLink?url=...}), 跳 Chromium External
        //   Protocol Dialog (浏览器内部弹窗, 不是 macOS 弹窗). 修 LaunchServices / user
        //   prefs policy 都无效. 验证: 用户点 YouTube 下载还是弹窗.
        //
        // 修法 (E5-D): 本 handler 改为 fetch 9090 /api/downie/download, 9090 内部调
        //   osascript 'open location downie://XUOpenLink?...', 走 macOS LaunchServices
        //   不弹 Chrome protocol dialog. 同时保留 background 主路径, 限速 1.2s 给
        //   LaunchServices cache 留时间.
        //
        // 优点:
        //   - 1.2s sleep 仍保留 (chrome MV3 tabs.create 限速, 现在改成 fetch 也避免掉)
        //   - 完全不走 chrome.tabs.create → 100% 不弹 External Protocol Dialog
        //   - fetch 失败 → 返回 success:false, content script 还会走兑底 E5-C
        const downieUrl = request.url;
        const index = request.index;
        if (!downieUrl) {
            return {success: false, error: 'url is empty'};
        }
        // 从 downie://XUOpenLink?url=...&destination=... 拆出原始 url 和 destination
        // fetch 9090 端点接收 url (youtube url) 和 dest (本地目录)
        let m = downieUrl.match(/url=([^&]+)&destination=(.+)$/);
        if (!m) {
            console.error('[background] E5-D downieUrl 解析失败:', downieUrl.substring(0, 100));
            return {success: false, error: 'downieUrl 解析失败'};
        }
        let originalUrl = decodeURIComponent(m[1]);
        let originalDest = decodeURIComponent(m[2]);
        let fetchUrl = 'http://localhost:9090/api/downie/download'
            + '?url=' + encodeURIComponent(originalUrl)
            + '&dest=' + encodeURIComponent(originalDest);
        try {
            // fetch (3s 超时)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            let resp;
            try {
                resp = await fetch(fetchUrl, {signal: controller.signal});
            } finally {
                clearTimeout(timeoutId);
            }
            if (resp.ok) {
                const data = await resp.json();
                if (data && data.success) {
                    console.log('[background] E5-D openDownieUrl fetch 9090 成功 index=' + index
                        + ' downieUrl=' + (data.downieUrl ? data.downieUrl.substring(0, 60) : '?'));
                } else {
                    console.error('[background] E5-D openDownieUrl fetch 9090 但 downie 失败 index=' + index,
                        data && data.error);
                    return {success: false, error: data && data.error};
                }
            } else {
                console.error('[background] E5-D openDownieUrl fetch 9090 HTTP ' + resp.status + ' index=' + index);
                return {success: false, error: 'HTTP ' + resp.status};
            }
        } catch (e) {
            console.error('[background] E5-D openDownieUrl fetch 9090 异常 index=' + index,
                e && e.message);
            return {success: false, error: e.message};
        }
        // 限速: 给 LaunchServices cache + Downie 协议注册留时间, 避免并发太多被 downie 丢包
        await new Promise(r => setTimeout(r, 1200));
        return {success: true};
    }
    if (request.action === "clearTimes1") {
        // content_scripts 让 service worker 帮忙清 localStorage（content 那边自己有 localStorage）
        // 这个 action 实际上不需要 service worker 处理，content_scripts 自己调 clearTimes1()
        // 保留兼容：什么都不做
        return {success: true};
    }
    return {success: false, error: 'unknown action: ' + request.action};
}

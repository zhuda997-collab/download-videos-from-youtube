// MV3 service worker 改造 (2026-06-14):
// 1. service worker 没有 window，不能用 window.localStorage，改用 chrome.storage.local
// 2. service worker 会被随时终止，sharedData 不能放内存里，必须用 storage API
// 3. service worker onMessage 改用 async/await + sendResponse 异步
// 4. 文件名仍是 background.js（manifest 里 service_worker 配置项）

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
        // (2026-06-15) 修复: 连续 window.open 触发 downie:// 被 Chrome MV3 限速
        // 原因: content_scripts 里连续 10 次 window.open(downie://, '_blank') 在 MV3 service worker 下会被静默丢包，
        //       只剩第 1 个能注册协议, 后面 9 个都开成空白 tab
        // 修复: 走 service worker 的 chrome.tabs.create, 每次创建之间 sleep 1.2s 给 Downie 协议注册留时间
        const url = request.url;
        const index = request.index;
        if (!url) {
            return {success: false, error: 'url is empty'};
        }
        try {
            await chrome.tabs.create({url: url, active: false});
            console.log('[background] openDownieUrl 发起 tab index=' + index);
        } catch (e) {
            console.error('[background] openDownieUrl 失败 index=' + index, e);
            return {success: false, error: e.message};
        }
        // 限速: Chrome MV3 对 chrome.tabs.create 1s 限速 1 次, 给 Downie 协议注册留 200ms 余量
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
